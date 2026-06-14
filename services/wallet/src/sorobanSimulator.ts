import {
  Transaction,
  // @ts-ignore
  xdr,
  rpc as SorobanRpc,
} from "@stellar/stellar-sdk";

type SimulateTransactionResponse = SorobanRpc.Api.SimulateTransactionResponse;

export class SorobanTransactionSimulator {
  private rpcServer: SorobanRpc.Server;

  constructor(rpcUrl: string) {
    this.rpcServer = new SorobanRpc.Server(rpcUrl);
  }

  public async simulateTransaction(
    transaction: Transaction
  ): Promise<SimulateTransactionResponse> {
    try {
      const simulation = await this.rpcServer.simulateTransaction(transaction);
      return simulation;
    } catch (error) {
      console.error("Error simulating transaction:", error);
      throw error;
    }
  }

  public extractFeeEstimates(
    simulationResponse: SimulateTransactionResponse
  ): any {
    if (SorobanRpc.Api.isSimulationSuccess(simulationResponse) && simulationResponse.transactionData) {
      const sorobanTransactionData = simulationResponse.transactionData.build();
      const resources = sorobanTransactionData.resources();
      return {
        cpu: resources.instructions().toString(),
        memory: resources.writeBytes().toString(),
      };
    }
    return {};
  }

  // Placeholder for failure detection
  public detectFailureReasons(
    simulationResponse: SimulateTransactionResponse
  ): string[] {
    if (SorobanRpc.Api.isSimulationError(simulationResponse)) {
      return [simulationResponse.error];
    }
    return [];
  }
}
