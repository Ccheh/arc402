# Competitive analysis: Cadence vs. alternatives

> Honest comparison of Cadence/Arc402 against the most relevant alternatives for "AI agent pays for API call." Grant reviewers will ask this; here's the answer.

## TL;DR

| Solution | Latency per call | Cost per call ($0.005 SaaS price) | Agent-side friction | Service-side friction | Counter-party risk |
|---|---|---|---|---|---|
| **Cadence (Arc402)** | **~50ms** (off-chain verify) | **$0.0007** (batched) | Deposit once, sign per call | 3 lines of middleware | Limited to deposit balance |
| Coinbase x402 (on Base) | ~100ms | ~$0.001 (Base gas) | Same model | Same model | Same |
| Lightning Network | 100ms-1s (channel state) | $0.0001 if channel pre-opened | Channel setup + capacity mgmt | Node operation | Channel partner balance |
| Traditional Stripe billing | 200-800ms | Stripe takes ~3% + $0.30 | Account + API key + KYC | Account + KYC | Stripe holds funds 2-7 days |
| Direct on-chain per-tx | 1-12s (block time) | $0.003+ (any chain's gas) | Sign per call | Verify per call | None |
| Subscription model (flat fee) | N/A | N/A | Pre-commit usage | Plan management | Pre-paid fees |

**Conclusion**: Cadence's per-call cost and latency profile are competitive with Lightning's (state-channel-based) without the channel-setup overhead. Versus Stripe, the gap is ~40x cost reduction (no payment processor cut) and zero KYC. Versus x402, the only material difference is Arc-native USDC-as-gas vs. Base's ETH-and-then-USDC pattern.

## 1. vs. Coinbase x402 (on Base)

**What x402 is**: An HTTP 402 implementation Coinbase shipped on Base. Same general idea — service responds 402 with payment requirements, agent provides a signed claim, service collects.

**What's the same**:
- HTTP 402 negotiation
- Off-chain claim signing (EIP-712)
- Service collects + settles

**What's different on Cadence/Arc402**:

| Aspect | x402 on Base | Cadence on Arc |
|---|---|---|
| Native gas | ETH | **USDC** |
| Agent must hold native token for gas | Yes (or use paymaster) | **No** (USDC IS gas) |
| Cross-chain coordination | Needed if agent has USDC on another chain | None |
| Settlement gas (single claim) | ~$0.003 at Base mainnet typical fees | **$0.0007** measured |
| Sponsored agent onboarding | Via 3rd-party paymaster (extra surface) | **Native `depositFor()` in protocol** |
| EIP-712 versioning isolation | Standard | **Explicit policy + verified on chain** (V1↔V2 cross-replay blocked) |
| Multiple agents per batch | Same | Same (we measured 5 agents × 4 claims = 20 in one tx) |

**Strategic posture**: Cadence is **complementary**, not competitive. x402 grows the same primitive on Base; Cadence does it on Arc with stablecoin-native economics. Both can win; markets are big enough. Long-term: a shared spec between x402 and Arc402 is desirable.

## 2. vs. Lightning Network

**What Lightning is**: Bitcoin-layer payment channels. Open a channel with on-chain commitment, then exchange off-chain HTLCs at sub-cent cost.

**Where Lightning is better**:
- Sub-millicent payments are economically viable
- Faster (no block time for off-channel updates)
- Battle-tested at scale (over 5,000 BTC capacity at peak)

**Where Cadence is better**:
- **No channel-opening cost** ($1-5 of BTC fees to open per channel)
- **No capacity / liquidity management** (Lightning routing is famously hard; you need inbound capacity, channel rebalancing, etc.)
- **USDC-denominated, not BTC** (price-stability matters for predictable per-call pricing)
- **Smart-contract programmable** (you can attach metadata, conditions, dispute claims — Lightning HTLCs are basically just locks)
- **Standard EVM tooling** (any developer who knows Solidity/viem can integrate, vs. specialized Lightning expertise)

**When Lightning wins**: very-high-frequency, very-low-value flows (think IoT / streaming payments at sub-cent levels). For LLM call billing at $0.005-0.05/call, the economics flip toward Cadence.

## 3. vs. Stripe / traditional payment processors

**Reality check**: Most AI tools today use Stripe-style billing. Cadence is a different model entirely.

**Where Stripe wins**:
- Massive scale, regulatory completeness
- Fiat-rail integration (credit cards, bank transfers, SEPA, etc.)
- Mature dispute and chargeback flows
- Recurring subscription support out of the box

**Where Cadence wins**:
- **Zero fees** to the protocol (Cadence takes 0% — Stripe takes 2.9% + $0.30 per tx)
- **No KYC for agents** (autonomous AI agents cannot pass Stripe's KYC by definition)
- **Per-call granularity** (Stripe minimum charge is $0.50; sub-cent isn't viable)
- **No payout delay** (Stripe holds 2-7 days; Cadence settles in one Arc block, ~1-2s)
- **Cross-border with no FX markup** (USDC is the asset)

**When Stripe wins**: human-to-business commerce, subscription SaaS with monthly billing. Cadence is for **machine-to-machine micropayments**.

## 4. vs. Direct on-chain per-call payment

**The naive alternative**: every API call triggers a real on-chain `transfer(service, amount)`.

**Why this loses to Cadence**:
- Service must wait 1-12s per call (block time)
- Per-call gas is full ~21k base + 50k for ERC-20 transfer ≈ $0.0015 even on cheap chains
- No batching efficiency
- Each call burns a service-side nonce; potential nonce-management headaches

**Where it could be competitive**: extremely high-value single calls ($1+ per call) where settlement-finality-per-call is a feature, not a bug. But for $0.005 calls, the math just doesn't work.

## 5. vs. Subscription / pre-paid plans

**The status quo**: charge $20/month for unlimited use, or $0.10/1K tokens with monthly billing.

**Why agents struggle with this**:
- Agents don't have credit cards or recurring relationships
- Plans are tied to identity (account); agents are ephemeral
- Pre-paying is opposite of "pay per use"
- Cancellation requires human action

**Where Cadence wins**:
- Genuinely per-call billing
- No identity / account / cancellation
- Agent's economic exposure is bounded by escrow balance (max loss = current deposit)

**Hybrid**: Cadence-paid endpoints CAN offer subscriber rates for ERC-8004-verified agents (read identity in middleware, apply discount). Best of both.

## 6. vs. ERC-8183 (on the same chain!)

ERC-8183 is the most important "competitor" because it's on **the same chain (Arc)** and from the **same vendor (Circle)**. Why don't we just use ERC-8183?

**ERC-8183 design**:
- `createJob` → contract record
- `setBudget` → service sets price
- `fund` → client deposits for this specific job
- `submit` → service delivers hash
- `complete` → evaluator approves; payment settles

**Why this doesn't fit per-API-call use cases**:
- 5 transactions per "job" → settlement floor is ~10x Cadence's
- Evaluator role requires a 3rd-party arbiter (or self-eval semantics that defeat purpose)
- Discrete contract per job — doesn't scale to "100 API calls/minute"
- The state machine is rigid, designed for AI agent contracts where deliverables matter (research reports, code reviews) not for high-frequency micro-API access

**Cadence's claim**: 8183 is the right answer for **discrete agent contracts**; Cadence is the right answer for **continuous streams**. Both are needed in the agent economy; they don't conflict.

## 7. Defensibility

What stops someone from forking Cadence and competing on Arc?

**Short answer**: nothing. It's MIT-licensed, public, ~500 LOC. **And that's fine.**

**The real moat is**:
1. **First-mover position with Circle** — Grant relationship, Architects standing, brand association
2. **Real integrations and case studies** — the project that has 10 live paid services on it beats the project that's just a contract on chain
3. **Developer experience polish** — SDKs in multiple languages, batteries-included, ergonomic
4. **Community trust** — open spec, audited contracts, public security analysis, public memory of decisions
5. **Network effects** — when 5 paid services exist, the agent SDK is more valuable; when many agents exist, services choose Cadence

For the next 6-12 months, **execution speed and integration count are the moat.** Eventually Arc402 should become a spec that others implement (like ERC-X family), not a single project. That's the long game.

## What Cadence does NOT claim

- Not the cheapest possible solution (Lightning is, for tiny payments)
- Not the most regulatory-complete (Stripe is)
- Not zero-trust (you trust the service won't take your money without service)
- Not a payment-channel system (no on-chain HTLC; no force-close)
- Not a stablecoin issuer (just routes USDC)
- Not an L2 (settlement is L1 on Arc, batched)

Honest positioning protects the project from over-promising in the Grant application and any future investor conversations.
