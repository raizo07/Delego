/** Saga coordinator pattern — core types shared by all saga implementations */

export type SagaStatus = "running" | "compensating" | "completed" | "failed";

export interface SagaStep<TContext = Record<string, unknown>> {
  name: string;
  action: (context: TContext) => Promise<TContext>;
  compensation: (context: TContext, error: Error) => Promise<TContext>;
}

export interface SagaExecution {
  sagaId: string;
  orderId: string;
  status: SagaStatus;
  completedSteps: string[];
}

/** Durable representation of a SagaExecution, including the data needed to resume it. */
export interface SagaRecord<TContext = Record<string, unknown>> extends SagaExecution {
  context: TContext;
  currentStep: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Persistence boundary for saga progress. Implementations must make save() safe to call
 * repeatedly with the same record (upsert), since a crash can interrupt execution between
 * a step completing and the saga advancing to the next one.
 */
export interface SagaStore {
  /** Inserts a new saga record. Returns the existing record if sagaId already exists (idempotent start). */
  createIfNotExists(record: SagaRecord): Promise<SagaRecord>;
  get(sagaId: string): Promise<SagaRecord | null>;
  save(record: SagaRecord): Promise<void>;
  /** Sagas left in "running" or "compensating" — used to resume after an orchestrator crash. */
  listIncomplete(): Promise<SagaRecord[]>;
}
