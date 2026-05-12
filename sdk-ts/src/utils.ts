import { parseUnits, formatUnits } from "viem";
import type { ClaimAuth, ClaimAuthWire, Hex } from "./types.js";

/** Convert a human USDC string ("0.05") to wei. Arc-USDC has 18 decimals (NOT 6). */
export function parseUsdc(human: string | number): bigint {
  return parseUnits(typeof human === "string" ? human : human.toString(), 18);
}

/** Format wei to a human-readable USDC string with the given number of decimals shown. */
export function formatUsdc(wei: bigint, displayDecimals = 6): string {
  const full = formatUnits(wei, 18);
  if (displayDecimals >= 18) return full;
  const [whole, frac = ""] = full.split(".");
  if (displayDecimals === 0) return whole!;
  return `${whole}.${frac.slice(0, displayDecimals).padEnd(displayDecimals, "0")}`;
}

/** Cryptographically-random uint256-fitting nonce. */
export function randomNonce(): bigint {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  let n = 0n;
  for (const b of buf) n = (n << 8n) | BigInt(b);
  return n;
}

/** EIP-712 domain for Arc402 escrow at `verifyingContract`. */
export function buildDomain(escrow: Hex, chainId: number) {
  return {
    name: "Arc402",
    version: "1",
    chainId,
    verifyingContract: escrow,
  } as const;
}

export const CLAIM_TYPES = {
  Claim: [
    { name: "agent", type: "address" },
    { name: "service", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
} as const;

export function encodeClaim(c: ClaimAuth): string {
  const wire: ClaimAuthWire = {
    agent: c.agent,
    service: c.service,
    amount: c.amount.toString(),
    nonce: c.nonce.toString(),
    expiry: c.expiry.toString(),
    signature: c.signature,
  };
  return Buffer.from(JSON.stringify(wire)).toString("base64");
}

export function decodeClaim(header: string): ClaimAuth {
  const raw = JSON.parse(Buffer.from(header, "base64").toString());
  return {
    agent: raw.agent,
    service: raw.service,
    amount: BigInt(raw.amount),
    nonce: BigInt(raw.nonce),
    expiry: BigInt(raw.expiry),
    signature: raw.signature,
  };
}
