import type { Request, Response, NextFunction, RequestHandler } from "express";
import { recoverTypedDataAddress, createPublicClient, http } from "viem";
import { CLAIM_HEADER, REQUIRED_HEADER, PAYMENT_ESCROW_ABI } from "../constants.js";
import { buildDomain, CLAIM_TYPES, decodeClaim, encodeClaim } from "../utils.js";
import type { ArcChain, ClaimAuth, Hex, PaymentRequirements } from "../types.js";

export interface RequirePaymentOptions {
  /** Minimum USDC (wei) the agent must authorize for this endpoint. */
  amount: bigint;
  /** Deployed PaymentEscrow contract address. */
  escrow: Hex;
  /** This service's wallet address (must match claim.service). */
  service: Hex;
  /** Arc chain config. */
  chain: ArcChain;
  /** If true, also check on-chain that nonce hasn't been used (one RPC call per req). Default false (off-chain replay protection only). */
  verifyNonceOnchain?: boolean;
}

/** Augment Express Request with `arc402Claim` for downstream handlers. */
declare module "express-serve-static-core" {
  interface Request {
    arc402Claim?: ClaimAuth;
  }
}

export function requirePayment(opts: RequirePaymentOptions): RequestHandler {
  const publicClient = createPublicClient({ transport: http(opts.chain.rpc) });

  return async (req: Request, res: Response, next: NextFunction) => {
    const headerVal = req.headers[CLAIM_HEADER];
    const claimHeader = Array.isArray(headerVal) ? headerVal[0] : headerVal;

    const requirements: PaymentRequirements = {
      scheme: "arc402",
      chainId: opts.chain.chainId,
      escrow: opts.escrow,
      service: opts.service,
      amount: opts.amount.toString(),
    };

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

    if (claim.amount < opts.amount) {
      res.status(402).json({ error: "insufficient_amount", required: opts.amount.toString() });
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
    next();
  };
}

/** Re-export so service code can call `encodeClaim()` if it wants to log/forward claims. */
export { encodeClaim };
