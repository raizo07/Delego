import type { IncomingMessage } from "node:http";
import { route, json, type Route } from "@delego/utils";
import { accountService } from "../stellar/account.js";
import { transactionService } from "../transactions/index.js";
import { vaultService } from "./vault.js";
import type { StellarNetwork } from "@delego/types";

// Helper to parse JSON body from incoming Node.js request
async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) as T : {} as T);
      } catch (err) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", (err) => {
      reject(err);
    });
  });
}

export function registerRoutes(): Route[] {
  return [
    // Create new Stellar wallet (Master or Delegate keypair)
    route("POST", "/wallets/create", async (req, res) => {
      try {
        const body = await readJsonBody<{ network?: StellarNetwork }>(req);
        const network = body.network ?? "testnet";

        const account = await accountService.createAccount(network);
        json(res, 201, { data: account, error: null });
      } catch (err: any) {
        json(res, 400, {
          data: null,
          error: { code: "CREATE_WALLET_FAILED", message: err.message },
        });
      }
    }),

    // Retrieve details for a specific wallet address
    route("GET", "/wallets/:address", async (_req, res, params) => {
      try {
        const address = params.address;
        if (!address) {
          throw new Error("Address parameter is required");
        }
        const account = await accountService.getAccount(address);
        if (!account) {
          json(res, 404, {
            data: null,
            error: { code: "NOT_FOUND", message: `Wallet not found: ${address}` },
          });
          return;
        }
        json(res, 200, { data: account, error: null });
      } catch (err: any) {
        json(res, 400, {
          data: null,
          error: { code: "GET_WALLET_FAILED", message: err.message },
        });
      }
    }),

    // List all public addresses managed by this wallet service
    route("GET", "/wallets", async (_req, res) => {
      try {
        const publicKeys = await vaultService.listPublicKeys();
        json(res, 200, { data: publicKeys, error: null });
      } catch (err: any) {
        json(res, 500, {
          data: null,
          error: { code: "LIST_WALLETS_FAILED", message: err.message },
        });
      }
    }),

    // Simulate Soroban contract call
    route("POST", "/transactions/simulate", async (req, res) => {
      try {
        const body = await readJsonBody<{
          sourceAddress: string;
          contractId: string;
          method: string;
          args: unknown[];
          memo?: string;
        }>(req);

        if (!body.sourceAddress || !body.contractId || !body.method || !body.args) {
          throw new Error("Missing required transaction simulation parameters");
        }

        const simResult = await transactionService.simulate({
          sourceAddress: body.sourceAddress,
          contractId: body.contractId,
          method: body.method,
          args: body.args,
          memo: body.memo ?? "Simulating transaction",
        });

        json(res, 200, { data: simResult, error: null });
      } catch (err: any) {
        json(res, 400, {
          data: null,
          error: { code: "SIMULATION_FAILED", message: err.message },
        });
      }
    }),

    // Sign and submit a transaction to Soroban
    route("POST", "/transactions/submit", async (req, res) => {
      try {
        const body = await readJsonBody<{
          sourceAddress: string;
          contractId: string;
          method: string;
          args: unknown[];
          memo?: string;
        }>(req);

        if (!body.sourceAddress || !body.contractId || !body.method || !body.args) {
          throw new Error("Missing required transaction submission parameters");
        }

        const txResult = await transactionService.submit({
          sourceAddress: body.sourceAddress,
          contractId: body.contractId,
          method: body.method,
          args: body.args,
          memo: body.memo ?? "Submitting transaction",
        });

        json(res, 200, { data: txResult, error: null });
      } catch (err: any) {
        json(res, 400, {
          data: null,
          error: { code: "SUBMISSION_FAILED", message: err.message },
        });
      }
    }),
  ];
}
