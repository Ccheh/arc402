export type Hex = `0x${string}`;

export interface ArcChain {
  chainId: number;
  rpc: string;
  explorer: string;
  usdc: Hex;
}

export interface ClaimAuth {
  agent: Hex;
  service: Hex;
  amount: bigint;
  nonce: bigint;
  expiry: bigint;
  signature: Hex;
}

/** Wire-format claim (string-encoded bigints for JSON/HTTP transport). */
export interface ClaimAuthWire {
  agent: Hex;
  service: Hex;
  amount: string;
  nonce: string;
  expiry: string;
  signature: Hex;
}

export interface PaymentRequirements {
  scheme: "arc402";
  chainId: number;
  escrow: Hex;
  service: Hex;
  amount: string;
}
