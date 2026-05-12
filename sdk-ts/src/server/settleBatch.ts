import {
  createWalletClient,
  createPublicClient,
  http,
  defineChain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { PAYMENT_ESCROW_ABI } from "../constants.js";
import type { ArcChain, ClaimAuth, Hex } from "../types.js";

export interface SettleBatchOptions {
  chain: ArcChain;
  escrow: Hex;
  /** Service's private key (becomes msg.sender on `claimBatch`). */
  servicePrivateKey: Hex;
}

/** Submit a list of signed claims in one tx via claimBatch. Returns tx hash. */
export async function settleBatch(
  claims: ClaimAuth[],
  opts: SettleBatchOptions,
): Promise<Hex> {
  if (claims.length === 0) throw new Error("settleBatch: empty claims");
  const account = privateKeyToAccount(opts.servicePrivateKey);
  const chain = defineChain({
    id: opts.chain.chainId,
    name: "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [opts.chain.rpc] } },
  });
  const transport = http(opts.chain.rpc, { timeout: 60_000, retryCount: 2 });
  const walletClient = createWalletClient({ account, chain, transport });
  const publicClient = createPublicClient({ chain, transport });

  const args = claims.map(c => ({
    agent: c.agent,
    amount: c.amount,
    nonce: c.nonce,
    expiry: c.expiry,
    signature: c.signature,
  }));

  const hash = await walletClient.writeContract({
    address: opts.escrow,
    abi: PAYMENT_ESCROW_ABI,
    functionName: "claimBatch",
    args: [args],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
