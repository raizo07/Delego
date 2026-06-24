import type { SagaRecord, SagaStore } from "./types.js";

function clone(record: SagaRecord): SagaRecord {
  return { ...record, completedSteps: [...record.completedSteps] };
}

/** Non-durable SagaStore — used in unit tests and local development without Postgres. */
export class InMemorySagaStore implements SagaStore {
  private readonly records = new Map<string, SagaRecord>();

  async createIfNotExists(record: SagaRecord): Promise<SagaRecord> {
    const existing = this.records.get(record.sagaId);
    if (existing) return clone(existing);
    this.records.set(record.sagaId, clone(record));
    return clone(record);
  }

  async get(sagaId: string): Promise<SagaRecord | null> {
    const record = this.records.get(sagaId);
    return record ? clone(record) : null;
  }

  async save(record: SagaRecord): Promise<void> {
    this.records.set(record.sagaId, clone(record));
  }

  async listIncomplete(): Promise<SagaRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.status === "running" || record.status === "compensating")
      .map(clone);
  }
}
