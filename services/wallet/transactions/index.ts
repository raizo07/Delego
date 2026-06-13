import { 
  Horizon, 
  rpc, 
  TransactionBuilder, 
  Networks, 
  Operation, 
  nativeToScVal 
} from "@stellar/stellar-sdk";
import type { TransactionRequest, TransactionResult } from "@delego/types";
import { createLogger } from "@delego/utils";
import { addTransactionToQueue } from "../src/queue/txQueue.js";

const log = createLogger("wallet:transactions", process.env.LOG_LEVEL ?? "info");

export interface TransactionService {
  submit(request: TransactionRequest): Promise<TransactionResult>;
  simulate(request: TransactionRequest): Promise<rpc.Api.SimulateTransactionResponse>;
}

function getStellarConfig() {
  const network = (process.env.STELLAR_NETWORK ?? "testnet").toLowerCase();
  let horizonUrl = "https://horizon-testnet.stellar.org";
  let rpcUrl = "https://soroban-testnet.stellar.org";
  let networkPassphrase = Networks.TESTNET;

  if (network === "mainnet") {
    horizonUrl = process.env.STELLAR_HORIZON_URL ?? "https://horizon.stellar.org";
    rpcUrl = process.env.STELLAR_RPC_URL ?? "https://rpc.stellar.org";
    networkPassphrase = Networks.PUBLIC;
  } else if (network === "futurenet") {
    horizonUrl = process.env.STELLAR_HORIZON_URL ?? "https://horizon-futurenet.stellar.org";
    rpcUrl = process.env.STELLAR_RPC_URL ?? "https://rpc-futurenet.stellar.org";
    networkPassphrase = Networks.FUTURENET;
  } else {
    horizonUrl = process.env.STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org";
    rpcUrl = process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
    networkPassphrase = Networks.TESTNET;
  }

  return { horizonUrl, rpcUrl, networkPassphrase };
}

export const transactionService: TransactionService = {
  async simulate(request: TransactionRequest): Promise<rpc.Api.SimulateTransactionResponse> {
    const { horizonUrl, rpcUrl, networkPassphrase } = getStellarConfig();
    log.info("Simulating Soroban transaction...", { request, rpcUrl });

    const horizonServer = new Horizon.Server(horizonUrl);
    const rpcServer = new rpc.Server(rpcUrl);

    try {
      const sourceAccount = await horizonServer.loadAccount(request.sourceAddress);
      
      const scArgs = request.args.map((arg) => nativeToScVal(arg));
      
      const tx = new TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase,
      })
        .addOperation(
          Operation.invokeContractFunction({
            contract: request.contractId,
            function: request.method,
            args: scArgs,
          })
        )
        .setTimeout(30)
        .build();

      const simRes = await rpcServer.simulateTransaction(tx);
      log.info("Simulation response received", { 
        error: rpc.Api.isSimulationSuccess(simRes) ? null : "Simulation failed",
        simRes 
      });
      return simRes;
    } catch (err: any) {
      log.error("Simulation error", { error: err.message });
      throw err;
    }
  },

  async submit(request: TransactionRequest): Promise<TransactionResult> {
    log.info("Submitting transaction via resilient queue...", { request });
    return addTransactionToQueue(request);
  },
};
