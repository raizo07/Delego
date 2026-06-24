import { DataTypes, Model, Op, Sequelize } from "sequelize";
import { createLogger } from "@delego/utils";
import type { SagaRecord, SagaStatus, SagaStore } from "./types.js";

const log = createLogger("orchestrator:saga:store", process.env.LOG_LEVEL ?? "info");

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://delego:delego@localhost:5432/delego";

export const sequelize = new Sequelize(databaseUrl, {
  dialect: "postgres",
  logging: (msg) => log.debug(msg),
  pool: {
    min: Number(process.env.DATABASE_POOL_MIN ?? 2),
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    acquire: 30000,
    idle: 10000,
  },
  define: {
    underscored: true,
    timestamps: true,
  },
});

interface SagaExecutionAttributes {
  sagaId: string;
  orderId: string;
  status: SagaStatus;
  completedSteps: string[];
  context: Record<string, unknown>;
  currentStep: string | null;
  error: string | null;
}

class SagaExecutionModel extends Model<SagaExecutionAttributes> implements SagaExecutionAttributes {
  declare sagaId: string;
  declare orderId: string;
  declare status: SagaStatus;
  declare completedSteps: string[];
  declare context: Record<string, unknown>;
  declare currentStep: string | null;
  declare error: string | null;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

SagaExecutionModel.init(
  {
    sagaId: { type: DataTypes.STRING(128), primaryKey: true, field: "saga_id" },
    orderId: { type: DataTypes.STRING(128), allowNull: false, field: "order_id" },
    status: { type: DataTypes.STRING(32), allowNull: false },
    completedSteps: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
      field: "completed_steps",
    },
    context: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    currentStep: { type: DataTypes.STRING(128), allowNull: true, field: "current_step" },
    error: { type: DataTypes.TEXT, allowNull: true },
  },
  {
    sequelize,
    modelName: "SagaExecution",
    tableName: "saga_executions",
  }
);

function toRecord(row: SagaExecutionModel): SagaRecord {
  return {
    sagaId: row.sagaId,
    orderId: row.orderId,
    status: row.status,
    completedSteps: [...row.completedSteps],
    context: row.context,
    currentStep: row.currentStep,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function connectSagaDb(): Promise<void> {
  try {
    await sequelize.authenticate();
    log.info("Saga store database connection established");
  } catch (err) {
    log.error("Unable to connect to saga store database", {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/** Durable SagaStore backed by PostgreSQL — required so compensation can resume after a crash. */
export class PostgresSagaStore implements SagaStore {
  async createIfNotExists(record: SagaRecord): Promise<SagaRecord> {
    const [row] = await SagaExecutionModel.findOrCreate({
      where: { sagaId: record.sagaId },
      defaults: {
        sagaId: record.sagaId,
        orderId: record.orderId,
        status: record.status,
        completedSteps: record.completedSteps,
        context: record.context,
        currentStep: record.currentStep,
        error: record.error,
      },
    });
    return toRecord(row);
  }

  async get(sagaId: string): Promise<SagaRecord | null> {
    const row = await SagaExecutionModel.findByPk(sagaId);
    return row ? toRecord(row) : null;
  }

  async save(record: SagaRecord): Promise<void> {
    await SagaExecutionModel.upsert({
      sagaId: record.sagaId,
      orderId: record.orderId,
      status: record.status,
      completedSteps: record.completedSteps,
      context: record.context,
      currentStep: record.currentStep,
      error: record.error,
    });
  }

  async listIncomplete(): Promise<SagaRecord[]> {
    const rows = await SagaExecutionModel.findAll({
      where: { status: { [Op.in]: ["running", "compensating"] } },
    });
    return rows.map(toRecord);
  }
}
