import { 
  Keypair, 
  Horizon, 
  rpc, 
  TransactionBuilder, 
  Networks, 
  Operation, 
  nativeToScVal 
} from "@stellar/stellar-sdk";
import type { TransactionRequest, TransactionResult } from "@delego/types";
import { vaultService } from "../src/vault.js";
import { createLogger } from "@delego/utils";

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
    const { horizonUrl, rpcUrl, networkPassphrase } = getStellarConfig();
    log.info("Preparing transaction for submission...", { request, rpcUrl });

    const horizonServer = new Horizon.Server(horizonUrl);
    const rpcServer = new rpc.Server(rpcUrl);

    try {
      // 1. Fetch private key from Vault
      const secret = await vaultService.getKey(request.sourceAddress);
      const signerKeypair = Keypair.fromSecret(secret);

      // 2. Load source account
      const sourceAccount = await horizonServer.loadAccount(request.sourceAddress);

      // 3. Convert arguments to ScVals
      const scArgs = request.args.map((arg) => nativeToScVal(arg));

      // 4. Build draft transaction
      let tx = new TransactionBuilder(sourceAccount, {
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

      // 5. Simulate to construct Soroban footprint details
      log.info("Simulating transaction to estimate gas and footprint...");
      const simRes = await rpcServer.simulateTransaction(tx);

      if (!rpc.Api.isSimulationSuccess(simRes)) {
        throw new Error(`Transaction simulation failed: ${JSON.stringify(simRes)}`);
      }

      // 6. Assemble transaction with footprints and sign
      tx = rpc.assembleTransaction(tx, simRes).build();
      tx.sign(signerKeypair);

      // 7. Submit transaction to RPC server
      log.info("Submitting transaction to Stellar network...", { hash: tx.hash().toString("hex") });
      let sendRes = await rpcServer.sendTransaction(tx);

      if (sendRes.status === "ERROR") {
        throw new Error(`Submission failed: ${JSON.stringify(sendRes)}`);
      }

      // 8. Poll for transaction result
      const txHash = sendRes.hash;
      log.info("Waiting for transaction confirmation...", { txHash });
      
      let retries = 12; // Poll for ~1 minute (5s intervals)
      
      while (retries > 0) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const txStatus = await rpcServer.getTransaction(txHash);
        
        if (txStatus.status === rpc.Api.GetTransactionStatus.SUCCESS) {
          const successTx = txStatus as rpc.Api.GetSuccessfulTransactionResponse;
          log.info("Transaction completed successfully", { txHash });
          return {
            hash: txHash,
            ledger: successTx.ledger,
            success: true
          };
        } else if (txStatus.status === rpc.Api.GetTransactionStatus.FAILED) {
          const failedTx = txStatus as rpc.Api.GetFailedTransactionResponse;
          const errXdrStr = typeof failedTx.resultXdr === "string" 
            ? failedTx.resultXdr 
            : failedTx.resultXdr?.toXDR().toString("base64") ?? "Unknown error XDR";
          log.error("Transaction execution failed", { txHash, error: errXdrStr });
          throw new Error(`Transaction failed: ${errXdrStr}`);
        }
        
        retries--;
      }

      throw new Error(`Transaction timeout or status untracked: ${sendRes.status}`);
    } catch (err: any) {
      log.error("Transaction submission error", { error: err.message });
      throw err;
    }
  },
};
