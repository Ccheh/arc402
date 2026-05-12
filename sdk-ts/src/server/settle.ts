import {
  createWalletClient,
  createPublicClient,
  http,
  defineChain,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { PAYMENT_ESCROW_ABI } from "../constants.js";
import type { ArcChain, ClaimAuth } from "../types.js";

export interface SettleOptions {
  chain: ArcChain;
  escrow: Hex;
  /** Service's private key (this account becomes msg.sender on `claim`). */
  servicePrivateKey: Hex;
}

/** Submit a signed claim on-chain. Returns the tx hash. */
export async function settle(claim: ClaimAuth, opts: SettleOptions): Promise<Hex> {
  const account = privateKeyToAccount(opts.servicePrivateKey);
  const chain = defineChain({
    id: opts.chain.chainId,
    name: "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [opts.chain.rpc] } },
  });
  const walletClient = createWalletClient({ account, chain, transport: http(opts.chain.rpc) });
  const publicClient = createPublicClient({ chain, transport: http(opts.chain.rpc) });

  const hash = await walletClient.writeContract({
    address: opts.escrow,
    abi: PAYMENT_ESCROW_ABI,
    functionName: "claim",
    args: [claim.agent, claim.amount, claim.nonce, claim.expiry, claim.signature],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
