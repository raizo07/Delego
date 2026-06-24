import { createLogger, type Logger } from "@delego/utils";
import type { SagaRecord, SagaStep, SagaStore } from "./types.js";

export interface SagaCoordinatorOptions<TContext> {
  /** Saga steps in the order they should execute. Compensations run in reverse order. */
  steps: Array<SagaStep<TContext>>;
  store: SagaStore;
  log?: Logger;
}

/**
 * Runs an ordered set of saga steps against a durable store, compensating completed
 * steps in reverse order if any step fails. Safe to call run()/resume() repeatedly for
 * the same sagaId — already-completed steps are skipped, which makes retries idempotent
 * and lets execution resume cleanly after an orchestrator crash.
 */
export class SagaCoordinator<TContext extends Record<string, unknown>> {
  private readonly steps: Map<string, SagaStep<TContext>>;
  private readonly stepOrder: string[];
  private readonly store: SagaStore;
  private readonly log: Logger;

  constructor(options: SagaCoordinatorOptions<TContext>) {
    if (options.steps.length === 0) {
      throw new Error("SagaCoordinator requires at least one step");
    }
    const seen = new Set<string>();
    for (const step of options.steps) {
      if (seen.has(step.name)) {
        throw new Error(`Duplicate saga step name: ${step.name}`);
      }
      seen.add(step.name);
    }
    this.steps = new Map(options.steps.map((step) => [step.name, step]));
    this.stepOrder = options.steps.map((step) => step.name);
    this.store = options.store;
    this.log = options.log ?? createLogger("orchestrator:saga");
  }

  /** Starts a new saga, or resumes it if sagaId was already started (idempotent). */
  async run(sagaId: string, orderId: string, initialContext: TContext): Promise<SagaRecord<TContext>> {
    const now = new Date();
    const record = await this.store.createIfNotExists({
      sagaId,
      orderId,
      status: "running",
      completedSteps: [],
      context: initialContext,
      currentStep: this.stepOrder[0] ?? null,
      error: null,
      createdAt: now,
      updatedAt: now,
    });
    return this.advance(record as SagaRecord<TContext>);
  }

  /** Continues a previously started saga from its persisted state — used for crash recovery and manual retries. */
  async resume(sagaId: string): Promise<SagaRecord<TContext>> {
    const record = await this.store.get(sagaId);
    if (!record) {
      throw new Error(`Saga not found: ${sagaId}`);
    }
    if (record.status === "completed" || record.status === "failed") {
      return record as SagaRecord<TContext>;
    }
    return this.advance(record as SagaRecord<TContext>);
  }

  /** Resumes every saga left in "running" or "compensating" — call once at startup. */
  async recoverAll(): Promise<void> {
    const incomplete = await this.store.listIncomplete();
    for (const record of incomplete) {
      this.log.warn("Recovering incomplete saga after restart", {
        sagaId: record.sagaId,
        status: record.status,
      });
      try {
        await this.resume(record.sagaId);
      } catch (err) {
        this.log.error("Saga recovery failed", {
          sagaId: record.sagaId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private async advance(record: SagaRecord<TContext>): Promise<SagaRecord<TContext>> {
    if (record.status === "compensating") {
      return this.compensate(record, new Error(record.error ?? "Saga failed"));
    }

    const remaining = this.stepOrder.filter((name) => !record.completedSteps.includes(name));

    for (const stepName of remaining) {
      const step = this.steps.get(stepName);
      if (!step) {
        throw new Error(`Unknown saga step: ${stepName}`);
      }
      record.currentStep = stepName;
      try {
        record.context = await step.action(record.context);
        record.completedSteps = [...record.completedSteps, stepName];
        record.updatedAt = new Date();
        await this.store.save(record);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.log.error("Saga step failed, starting compensation", {
          sagaId: record.sagaId,
          step: stepName,
          error: error.message,
        });
        record.status = "compensating";
        record.error = error.message;
        record.updatedAt = new Date();
        await this.store.save(record);
        return this.compensate(record, error);
      }
    }

    record.status = "completed";
    record.currentStep = null;
    record.updatedAt = new Date();
    await this.store.save(record);
    return record;
  }

  private async compensate(record: SagaRecord<TContext>, error: Error): Promise<SagaRecord<TContext>> {
    const toCompensate = [...record.completedSteps].reverse();

    for (const stepName of toCompensate) {
      const step = this.steps.get(stepName);
      if (!step) continue;
      record.currentStep = stepName;
      try {
        record.context = await step.compensation(record.context, error);
        record.completedSteps = record.completedSteps.filter((name) => name !== stepName);
        record.updatedAt = new Date();
        await this.store.save(record);
      } catch (compErr) {
        const compensationError = compErr instanceof Error ? compErr : new Error(String(compErr));
        this.log.error("Compensation step failed — saga left in compensating state for retry", {
          sagaId: record.sagaId,
          step: stepName,
          error: compensationError.message,
        });
        record.updatedAt = new Date();
        await this.store.save(record);
        throw compensationError;
      }
    }

    record.status = "failed";
    record.currentStep = null;
    record.updatedAt = new Date();
    await this.store.save(record);
    return record;
  }
}
