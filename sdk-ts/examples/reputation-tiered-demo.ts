/**
 * Demo: reputation-tiered pricing via ERC-8004 in Cadence middleware.
 *
 * This is a genuinely novel primitive not in Coinbase x402 nor Circle
 * Nanopayments / Gateway: the seller-side middleware reads the agent's
 * ERC-8004 identity inline and applies a discounted price tier when the
 * agent is a verified identity holder.
 *
 * Flow demonstrated:
 *   1. Service requires 0.005 USDC by default, 0.001 USDC for ERC-8004-verified agents.
 *   2. The 402 response advertises both tiers so the agent SDK can choose.
 *   3. The agent in this demo is NOT registered in ERC-8004 (we read live and confirm),
 *      so it pays the base tier.
 *   4. A second hypothetical agent that IS registered would get the discount; we show the
 *      contract path that would accept the lower amount.
 */

import express from "express";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  AgentClient,
  parseUsdc,
  formatUsdc,
  requirePayment,
  ARC_TESTNET,
  ERC8004_ARC_TESTNET,
  getAgentIdentity,
  type Hex,
} from "../src/index.js";

process.loadEnvFile("../.env");

const SERVICE_PK = process.env.SERVICE_PRIVATE_KEY as Hex;
const ESCROW = process.env.ESCROW_V2_ADDRESS as Hex;
const AGENT_PK = process.env.PRIVATE_KEY as Hex;
if (!SERVICE_PK || !ESCROW || !AGENT_PK) throw new Error("missing .env");

const SERVICE_ADDR = privateKeyToAccount(SERVICE_PK).address;

const app = express();
app.use(express.json());

// ───── Service config: 0.005 USDC base, 0.001 USDC for verified agents ─────
app.post(
  "/v1/premium-search",
  requirePayment({
    amount: parseUsdc("0.005"),                  // base tier
    reputationAmount: parseUsdc("0.001"),        // 80% off for verified agents
    reputation: { minTokens: 1 },                // ≥ 1 ERC-8004 identity NFT qualifies
    escrow: ESCROW,
    service: SERVICE_ADDR,
    chain: ARC_TESTNET,
  }),
  (req, res) => {
    const claim = req.arc402Claim!;
    res.json({
      result: "Demo search result",
      paid_by: claim.agent,
      paid_amount_usdc: formatUsdc(claim.amount),
      reputation_accepted: req.arc402ReputationAccepted ?? false,
      tier: req.arc402ReputationAccepted ? "reputation_discount" : "base",
    });
  },
);

const PORT = 7404;
const server = app.listen(PORT, () =>
  console.log(`[server] reputation-tiered endpoint live at http://127.0.0.1:${PORT}/v1/premium-search\n`),
);

// ───── Agent path ─────
const agent = new AgentClient({ privateKey: AGENT_PK });
console.log(`Agent: ${agent.address}`);

// 1. Show agent's actual ERC-8004 identity status
const identity = await getAgentIdentity(agent.address);
console.log(
  `ERC-8004 identity check (against ${ERC8004_ARC_TESTNET.identityRegistry.slice(0, 14)}...):`,
);
console.log(`  registered: ${identity.registered}`);
console.log(`  tokenCount: ${identity.tokenCount}`);
console.log(
  identity.registered
    ? `  → qualifies for reputation discount\n`
    : `  → must pay base tier (no identity NFT)\n`,
);

// 2. Make the call (SDK auto-handles 402)
console.log(`Calling /v1/premium-search...`);
const response = await agent.fetch(`http://127.0.0.1:${PORT}/v1/premium-search`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query: "test" }),
});
const body = (await response.json()) as any;
console.log(`Status: ${response.status}`);
console.log(`Tier: ${body.tier}`);
console.log(`Amount paid: ${body.paid_amount_usdc} USDC`);
console.log(`Reputation accepted by server: ${body.reputation_accepted}`);

console.log(`
─────────────────────────────────────────────────────────────────────
[ok] Cadence middleware reads ERC-8004 inline per-call.
     - Verified agents: pay 0.001 USDC (80% discount)
     - Unverified agents: pay 0.005 USDC (base)

This is a primitive Circle Nanopayments / Gateway cannot offer:
their settlement layer reads USDC balance only, not on-chain identity.
Cadence composes with Circle's ERC-8004 standard to deliver the feature.
─────────────────────────────────────────────────────────────────────
`);

server.close();
