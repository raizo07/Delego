/**
 * @delego/orchestrator — Workflow coordination
 */
import { createLogger, generateId, json, route, startHttpServer } from "@delego/utils";
import { purchaseWorkflow } from "../workflows/purchase/index.js";
import {
  checkoutWorkflow,
  createCheckoutSagaCoordinator,
  type CheckoutWorkflowInput,
} from "../workflows/checkout/index.js";
import { connectSagaDb, PostgresSagaStore } from "./saga/index.js";

const SERVICE_NAME = "orchestrator";
const DEFAULT_PORT = 3010;

const logLevel = process.env.LOG_LEVEL ?? "info";
const log = createLogger(SERVICE_NAME, logLevel);
const port = Number(process.env.ORCHESTRATOR_PORT ?? DEFAULT_PORT);

const sagaStore = new PostgresSagaStore();
const checkoutSagaCoordinator = createCheckoutSagaCoordinator(sagaStore);

log.info("Starting orchestrator", { port });

startHttpServer({
  port,
  serviceName: SERVICE_NAME,
  routes: [
    route("POST", "/checkout", async (req, res) => {
      const body = await readJsonBody(req);
      const input = body as Partial<CheckoutWorkflowInput>;
      if (!input.orderId || !input.sourceAddress || !input.buyerAddress || !input.sellerAddress) {
        json(res, 400, {
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: "orderId, sourceAddress, buyerAddress and sellerAddress are required",
          },
        });
        return;
      }

      try {
        const sagaId = generateId();
        const result = await checkoutWorkflow(input as CheckoutWorkflowInput, checkoutSagaCoordinator, sagaId);
        json(res, result.status === "completed" ? 200 : 502, {
          data: {
            sagaId: result.sagaId,
            orderId: result.orderId,
            status: result.status,
            completedSteps: result.completedSteps,
          },
          error:
            result.status === "completed"
              ? null
              : { code: "CHECKOUT_SAGA_FAILED", message: result.error ?? "Checkout saga failed" },
        });
      } catch (err) {
        json(res, 502, {
          data: null,
          error: {
            code: "CHECKOUT_SAGA_FAILED",
            message: err instanceof Error ? err.message : "Checkout saga failed",
          },
        });
      }
    }),

    route("GET", "/sagas/:sagaId", async (_req, res, params) => {
      const record = await sagaStore.get(params.sagaId);
      if (!record) {
        json(res, 404, {
          data: null,
          error: { code: "NOT_FOUND", message: `Saga not found: ${params.sagaId}` },
        });
        return;
      }
      json(res, 200, {
        data: {
          sagaId: record.sagaId,
          orderId: record.orderId,
          status: record.status,
          completedSteps: record.completedSteps,
        },
        error: null,
      });
    }),

    route("POST", "/sagas/:sagaId/resume", async (_req, res, params) => {
      try {
        const result = await checkoutSagaCoordinator.resume(params.sagaId);
        json(res, 200, {
          data: {
            sagaId: result.sagaId,
            orderId: result.orderId,
            status: result.status,
            completedSteps: result.completedSteps,
          },
          error: null,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to resume saga";
        const status = message.startsWith("Saga not found") ? 404 : 502;
        json(res, status, {
          data: null,
          error: { code: status === 404 ? "NOT_FOUND" : "SAGA_RESUME_FAILED", message },
        });
      }
    }),
  ],
});

async function readJsonBody(req: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? (JSON.parse(body) as Record<string, unknown>) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

connectSagaDb()
  .then(() => checkoutSagaCoordinator.recoverAll())
  .catch((err) => {
    log.error("Saga recovery failed at startup", {
      error: err instanceof Error ? err.message : String(err),
    });
  });

// Export workflows for internal use
export { purchaseWorkflow, checkoutWorkflow };
