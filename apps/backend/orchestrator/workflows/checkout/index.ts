/** Checkout workflow — payment confirmation via the saga coordinator */
import { createLogger } from "@delego/utils";
import type { ApiResponse } from "@delego/types";
import { SagaCoordinator, type SagaStep } from "../../src/saga/index.js";
import type { SagaRecord, SagaStore } from "../../src/saga/index.js";

const log = createLogger("orchestrator:checkout", process.env.LOG_LEVEL ?? "info");

export interface CheckoutWorkflowInput {
  orderId: string;
  sourceAddress: string;
  buyerAddress: string;
  sellerAddress: string;
}

export interface CheckoutContext extends Record<string, unknown> {
  orderId: string;
  sourceAddress: string;
  buyerAddress: string;
  sellerAddress: string;
  escrowId: string | null;
  confirmed: boolean;
}

function getPaymentsUrl(): string {
  return process.env.PAYMENTS_URL ?? "http://localhost:3014";
}

interface EscrowOperationResult {
  txHash: string;
  ledger: number;
  success: boolean;
  escrowId?: string;
}

async function callPaymentsService<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const url = `${getPaymentsUrl()}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to reach payments service";
    throw new Error(`Payments service unavailable: ${message}`);
  }

  const json = (await response.json()) as ApiResponse<T>;
  if (!response.ok || json.error) {
    throw new Error(json.error?.message ?? `Payments service returned status ${response.status}`);
  }
  if (!json.data) {
    throw new Error("Payments service returned an empty response");
  }
  return json.data;
}

/**
 * Deposits the order total into escrow. Compensation refunds the same escrow ID, which is
 * idempotent on the contract side — refunding an already-refunded or never-funded escrow
 * is a no-op rather than a double-spend.
 */
const depositEscrowStep: SagaStep<CheckoutContext> = {
  name: "deposit-escrow",
  async action(context) {
    const result = await callPaymentsService<EscrowOperationResult>("/escrow/deposit", {
      sourceAddress: context.sourceAddress,
      buyerAddress: context.buyerAddress,
      sellerAddress: context.sellerAddress,
      orderId: context.orderId,
    });
    log.info("Escrow deposit confirmed", { orderId: context.orderId, txHash: result.txHash });
    return { ...context, escrowId: result.escrowId ?? context.orderId };
  },
  async compensation(context, error) {
    if (!context.escrowId) return context;
    log.warn("Refunding escrow deposit after downstream failure", {
      orderId: context.orderId,
      escrowId: context.escrowId,
      reason: error.message,
    });
    await callPaymentsService<EscrowOperationResult>(`/escrow/${context.escrowId}/refund`, {
      sourceAddress: context.sourceAddress,
    });
    return { ...context, escrowId: null };
  },
};

/**
 * Marks the checkout as confirmed once escrow funds are secured. This is a context-only
 * transition today; once the gateway exposes an order-status endpoint, this step should
 * call it instead so order state stays in sync across services.
 */
const confirmCheckoutStep: SagaStep<CheckoutContext> = {
  name: "confirm-checkout",
  async action(context) {
    return { ...context, confirmed: true };
  },
  async compensation(context) {
    return { ...context, confirmed: false };
  },
};

export function createCheckoutSagaCoordinator(store: SagaStore): SagaCoordinator<CheckoutContext> {
  return new SagaCoordinator<CheckoutContext>({
    steps: [depositEscrowStep, confirmCheckoutStep],
    store,
  });
}

export async function checkoutWorkflow(
  input: CheckoutWorkflowInput,
  coordinator: SagaCoordinator<CheckoutContext>,
  sagaId: string
): Promise<SagaRecord<CheckoutContext>> {
  return coordinator.run(sagaId, input.orderId, {
    orderId: input.orderId,
    sourceAddress: input.sourceAddress,
    buyerAddress: input.buyerAddress,
    sellerAddress: input.sellerAddress,
    escrowId: null,
    confirmed: false,
  });
}
