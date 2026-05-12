import type { Request, Response, NextFunction, RequestHandler } from "express";
import { recoverTypedDataAddress, createPublicClient, http } from "viem";
import { CLAIM_HEADER, REQUIRED_HEADER, PAYMENT_ESCROW_ABI } from "../constants.js";
import { buildDomain, CLAIM_TYPES, decodeClaim, encodeClaim } from "../utils.js";
import { getAgentIdentity, ERC8004_ARC_TESTNET } from "../erc8004.js";
import type { ArcChain, ClaimAuth, Hex, PaymentRequirements } from "../types.js";

/**
 * Optional reputation gate for tiered pricing. If set, callers whose ERC-8004
 * identity meets the threshold qualify for `reputationAmount` (typically a
 * discount) instead of `amount`. This is genuinely novel relative to Circle
 * Nanopayments / Gateway, which read only USDC balance and have no native
 * identity-awareness.
 */
export interface ReputationRequirement {
  /** Minimum number of ERC-8004 IdentityRegistry tokens the agent must own. Default: 1. */
  minTokens?: number;
  /** Custom IdentityRegistry address. Defaults to the canonical Arc Testnet deployment. */
  identityRegistry?: Hex;
  /** Custom chain if identity lookup uses a different chain than the escrow. Defaults to opts.chain. */
  chain?: ArcChain;
}

export interface RequirePaymentOptions {
  /** Base USDC (wei) the agent must authorize for this endpoint. */
  amount: bigint;
  /** Deployed PaymentEscrow contract address. */
  escrow: Hex;
  /** This service's wallet address (must match claim.service). */
  service: Hex;
  /** Arc chain config. */
  chain: ArcChain;
  /**
   * NEW (Cadence-only, not in Nanopayments): discounted amount for ERC-8004-verified agents.
   * If set, the middleware reads ERC-8004 IdentityRegistry inline; if the agent has
   * `reputation.minTokens` identity tokens, this lower amount is accepted as sufficient.
   * Pricing-discovery flow: the 402 response surfaces both tiers so the agent SDK
   * can pick the path it qualifies for.
   */
  reputationAmount?: bigint;
  reputation?: ReputationRequirement;
  /** If true, also check on-chain that nonce hasn't been used. Default false. */
  verifyNonceOnchain?: boolean;
}

/** Augment Express Request with `arc402Claim` for downstream handlers. */
declare module "express-serve-static-core" {
  interface Request {
    arc402Claim?: ClaimAuth;
    /** True if the verified claim was accepted at the discounted reputation rate. */
    arc402ReputationAccepted?: boolean;
  }
}

export function requirePayment(opts: RequirePaymentOptions): RequestHandler {
  const publicClient = createPublicClient({ transport: http(opts.chain.rpc) });
  const hasReputationTier =
    opts.reputationAmount !== undefined && opts.reputationAmount < opts.amount;

  return async (req: Request, res: Response, next: NextFunction) => {
    const headerVal = req.headers[CLAIM_HEADER];
    const claimHeader = Array.isArray(headerVal) ? headerVal[0] : headerVal;

    // Build a requirements doc. If a reputation tier exists, surface it so the
    // calling agent SDK can discover the discount path.
    const requirements: PaymentRequirements & {
      reputationAmount?: string;
      reputation?: { identityRegistry: Hex; minTokens: number; chainId: number };
    } = {
      scheme: "arc402",
      chainId: opts.chain.chainId,
      escrow: opts.escrow,
      service: opts.service,
      amount: opts.amount.toString(),
    };
    if (hasReputationTier) {
      requirements.reputationAmount = opts.reputationAmount!.toString();
      const repChain = opts.reputation?.chain ?? opts.chain;
      requirements.reputation = {
        identityRegistry: opts.reputation?.identityRegistry ?? ERC8004_ARC_TESTNET.identityRegistry,
        minTokens: opts.reputation?.minTokens ?? 1,
        chainId: repChain.chainId,
      };
    }

    if (!claimHeader) {
      res.set(REQUIRED_HEADER, Buffer.from(JSON.stringify(requirements)).toString("base64"));
      res.status(402).json({ error: "payment_required", requirements });
      return;
    }

    let claim: ClaimAuth;
    try {
      claim = decodeClaim(claimHeader);
    } catch {
      res.status(400).json({ error: "malformed_claim_header" });
      return;
    }

    // ----------- Decide effective required amount (rep tier) -----------
    let effectiveAmount = opts.amount;
    let reputationAccepted = false;

    if (hasReputationTier && claim.amount < opts.amount && claim.amount >= opts.reputationAmount!) {
      // The agent is claiming the discounted tier -- verify their ERC-8004 identity inline.
      const repChain = opts.reputation?.chain ?? opts.chain;
      const minTokens = opts.reputation?.minTokens ?? 1;
      try {
        const identity = await getAgentIdentity(claim.agent, repChain);
        if (identity.tokenCount >= minTokens) {
          effectiveAmount = opts.reputationAmount!;
          reputationAccepted = true;
        }
      } catch {
        // Identity lookup failed (RPC issue, etc.). Fall through to base-tier check;
        // do NOT silently approve the discount.
      }
    }

    if (claim.amount < effectiveAmount) {
      res.status(402).json({
        error: "insufficient_amount",
        required: effectiveAmount.toString(),
        reputationAvailable: hasReputationTier,
      });
      return;
    }
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (claim.expiry < now) {
      res.status(402).json({ error: "claim_expired" });
      return;
    }
    if (claim.service.toLowerCase() !== opts.service.toLowerCase()) {
      res.status(402).json({ error: "wrong_service" });
      return;
    }

    const recovered = await recoverTypedDataAddress({
      domain: buildDomain(opts.escrow, opts.chain.chainId),
      types: CLAIM_TYPES,
      primaryType: "Claim",
      message: {
        agent: claim.agent,
        service: claim.service,
        amount: claim.amount,
        nonce: claim.nonce,
        expiry: claim.expiry,
      },
      signature: claim.signature,
    });

    if (recovered.toLowerCase() !== claim.agent.toLowerCase()) {
      res.status(402).json({ error: "invalid_signature" });
      return;
    }

    if (opts.verifyNonceOnchain) {
      const used = await publicClient.readContract({
        address: opts.escrow,
        abi: PAYMENT_ESCROW_ABI,
        functionName: "isNonceUsed",
        args: [claim.agent, claim.service, claim.nonce],
      });
      if (used) {
        res.status(402).json({ error: "nonce_already_used" });
        return;
      }
    }

    req.arc402Claim = claim;
    req.arc402ReputationAccepted = reputationAccepted;
    next();
  };
}

/** Re-export so service code can call `encodeClaim()` if it wants to log/forward claims. */
export { encodeClaim };
