import {
  createWalletClient,
  createPublicClient,
  http,
  defineChain,
  parseSignature,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_TESTNET, CLAIM_HEADER, PAYMENT_ESCROW_ABI } from "../constants.js";
import { buildDomain, CLAIM_TYPES, encodeClaim, randomNonce } from "../utils.js";
import type { ArcChain, ClaimAuth, Hex, PaymentRequirements } from "../types.js";

export interface AgentClientOptions {
  privateKey: Hex;
  chain?: ArcChain;
}

export class AgentClient {
  readonly address: Hex;
  private readonly account;
  private readonly walletClient;
  private readonly publicClient;
  readonly chain: ArcChain;

  constructor(opts: AgentClientOptions) {
    this.chain = opts.chain ?? ARC_TESTNET;
    this.account = privateKeyToAccount(opts.privateKey);
    this.address = this.account.address;
    const viemChain = defineChain({
      id: this.chain.chainId,
      name: "Arc Testnet",
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
      rpcUrls: { default: { http: [this.chain.rpc] } },
    });
    this.walletClient = createWalletClient({
      account: this.account,
      chain: viemChain,
      transport: http(this.chain.rpc),
    });
    this.publicClient = createPublicClient({
      chain: viemChain,
      transport: http(this.chain.rpc),
    });
  }

  async deposit(escrow: Hex, amount: bigint): Promise<Hex> {
    const hash = await this.walletClient.writeContract({
      address: escrow,
      abi: PAYMENT_ESCROW_ABI,
      functionName: "deposit",
      value: amount,
      args: [],
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async withdraw(escrow: Hex, amount: bigint): Promise<Hex> {
    const hash = await this.walletClient.writeContract({
      address: escrow,
      abi: PAYMENT_ESCROW_ABI,
      functionName: "withdraw",
      args: [amount],
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async balanceInEscrow(escrow: Hex): Promise<bigint> {
    return this.publicClient.readContract({
      address: escrow,
      abi: PAYMENT_ESCROW_ABI,
      functionName: "balanceOf",
      args: [this.address],
    });
  }

  async walletBalance(): Promise<bigint> {
    return this.publicClient.getBalance({ address: this.address });
  }

  /** Sign an EIP-712 claim authorizing `service` to pull up to `amount` USDC from our escrow. */
  async signClaim(opts: {
    escrow: Hex;
    service: Hex;
    amount: bigint;
    nonce?: bigint;
    expirySeconds?: number;
  }): Promise<ClaimAuth> {
    const nonce = opts.nonce ?? randomNonce();
    const expiry = BigInt(Math.floor(Date.now() / 1000) + (opts.expirySeconds ?? 3600));
    const signature = await this.walletClient.signTypedData({
      domain: buildDomain(opts.escrow, this.chain.chainId),
      types: CLAIM_TYPES,
      primaryType: "Claim",
      message: {
        agent: this.address,
        service: opts.service,
        amount: opts.amount,
        nonce,
        expiry,
      },
    });
    // Sanity-parse to ensure r/s/v form is valid (throws on malformed)
    parseSignature(signature);
    return {
      agent: this.address,
      service: opts.service,
      amount: opts.amount,
      nonce,
      expiry,
      signature,
    };
  }

  /**
   * Fetch a URL that may be Arc402-protected. If the first call returns 402,
   * automatically sign a claim covering the required amount and retry.
   */
  async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    const first = await fetch(url, init);
    if (first.status !== 402) return first;

    const body = (await first.json()) as {
      requirements: PaymentRequirements & {
        reputationAmount?: string;
        reputation?: { identityRegistry: `0x${string}`; minTokens: number; chainId: number };
      };
    };
    const reqd = body.requirements;

    // If the server advertises a reputation discount tier and we qualify, sign
    // for the lower amount. (This is Cadence-specific — Nanopayments / x402
    // do not have this in their requirements doc.)
    let amount = BigInt(reqd.amount);
    if (reqd.reputationAmount && reqd.reputation) {
      try {
        const { getAgentIdentity } = await import("../erc8004.js");
        const identity = await getAgentIdentity(this.address, this.chain);
        if (identity.tokenCount >= reqd.reputation.minTokens) {
          amount = BigInt(reqd.reputationAmount);
        }
      } catch {
        // identity lookup failed -- fall back to base tier (safer)
      }
    }

    const claim = await this.signClaim({
      escrow: reqd.escrow,
      service: reqd.service,
      amount,
    });
    const headers = new Headers(init.headers);
    headers.set(CLAIM_HEADER, encodeClaim(claim));
    return fetch(url, { ...init, headers });
  }
}
