/**
 * @delego/wallet — Entry point
 * TODO: Implement service logic
 */
import { createLogger } from "@delego/utils";
import { startHttpServer } from "@delego/utils";
import { SorobanTransactionSimulator } from "./sorobanSimulator.js";

const SERVICE_NAME = "wallet";
const DEFAULT_PORT = 3012;
const SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";

const nodeEnv = process.env.NODE_ENV ?? "development";
const logLevel = process.env.LOG_LEVEL ?? "info";
const log = createLogger(SERVICE_NAME, logLevel);
const port = Number(process.env.WALLET_PORT ?? DEFAULT_PORT);

log.info("Starting service", { port, nodeEnv });

export const sorobanSimulator = new SorobanTransactionSimulator(SOROBAN_RPC_URL);

import { registerRoutes } from "./routes.js";

startHttpServer({
  port,
  serviceName: SERVICE_NAME,
  routes: registerRoutes(),
});

// TODO: Wire routes, database, and domain logic
