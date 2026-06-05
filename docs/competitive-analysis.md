# Competitive analysis: Cadence vs. alternatives

> Honest comparison of Cadence/Arc402 against the most relevant alternatives for "AI agent pays for API call." Grant reviewers will ask this; here's the answer.

## TL;DR

| Solution | Latency | Cost @ $0.005 SaaS | Identity-aware pricing | SLA / refund | Permissionless seller |
|---|---|---|---|---|---|
| **Cadence (Arc402)** | **~50ms** | **$0.0007** (batched) | **✅ via ERC-8004** | **🟡 v0.3 design** | **✅ MIT, self-host** |
| Circle Nanopayments | ~100ms | similar (batched) | ❌ balance only | ❌ | ❌ form-gated |
| Coinbase x402 (Base) | ~100ms | ~$0.001 | ❌ | ❌ | ✅ |
| Lightning Network | 100ms-1s | $0.0001 if pre-opened | ❌ | ❌ | ✅ but channel-managed |
| Stripe | 200-800ms | 2.9% + $0.30 | ✅ via fraud signals | ✅ | ❌ KYC-gated |
| Direct on-chain per-tx | 1-12s | $0.003+ | ❌ | ❌ | ✅ |

**Conclusion**: Cadence's two differentiators against Circle Nanopayments are now (a) permissionless self-hosting and (b) **two AI-native primitives Circle's settlement layer structurally can't deliver**: reputation-tiered pricing via ERC-8004 (live) and refundable claims (v0.3 design).

> **Strategic frame (2026 Arc track):** the alternatives Circle itself benchmarks against for *agentic* payments are the closed networks — **Stripe Tempo, Visa/Mastercard agent rails, Google AP2** (see §0a). Cadence is the permissionless, USDC-on-Arc seller layer that lets Circle win the builder long tail before those networks lock it up.

## 0. vs Circle Nanopayments (Apr 29 2026 — the critical comparison)

**What Circle shipped**: An official x402 + Gateway batched-settlement product, announced 2026-04-29 by Tim Baker. Functionally the same protocol pattern as Arc402 — HTTP 402 negotiation, off-chain auth, batched on-chain settlement.

**What's identical**:
- HTTP 402 + signed auth pattern (same standard family)
- Pre-deposit escrow (Gateway Wallet ≈ PaymentEscrowV2)
- Batched settlement to amortize gas
- Target use cases (per-call APIs, agent payments, usage-based billing)

**What's different**:

| Aspect | Circle Nanopayments | Cadence/Arc402 |
|---|---|---|
| Source / license | Closed product, Circle-operated | MIT-licensed, deployable by anyone |
| Seller onboarding | Form-gated (`agents.circle.com` review) | Permissionless — clone repo, deploy contract, run middleware |
| Seller middleware API | `withGateway(handler, "$0.001", path)` from `@circle-fin/x402-batching/client` (managed: requires Circle Gateway + Balance API) | `requirePayment({ amount, recipient })` from `@arc402/sdk` (pure local: verifies EIP-712 sig + escrow balance, zero Circle dependency) |
| Signing scheme | EIP-3009 (single-tx authorization) | EIP-712 custom domain (versioned, replay-isolated across V_n → V_{n+1}) |
| Identity awareness | None at settlement | **Reputation-tiered pricing via ERC-8004 (live)** — different price for verified vs unverified agents, evaluated inline in middleware |
| Quality / SLA | None | **Refundable claims** (v0.3 design proposal in spec.md §12) — opt-in dispute window before service collects |
| Escrow operator | Circle | Self-deployed contract; user chooses operator |
| Composability with rest of Circle stack | Native | **Designed to compose**: reads Circle's ERC-8004, can settle against Circle's USDC, complements ERC-8183 jobs |

**Cadence's position**: **complementary, not competitive**. The same protocol pattern, but Cadence ships:
- (a) the **OSS reference seller-side middleware** Tim Baker explicitly called for in his Apr 29 blog
- (b) **two AI-native primitives** Nanopayments doesn't have: identity-aware pricing (live) and SLA-aware refundable claims (design)

Both Nanopayments and Cadence can win simultaneously, in different deployment postures (managed-platform vs self-hosted reference). This is the GitHub vs GitHub Enterprise dynamic, the WordPress.com vs WordPress.org dynamic.

## 0a. vs the closed agentic-payment networks — Stripe Tempo, Visa/MC agent rails, Google AP2

These are the alternatives **Circle itself benchmarks against** for agentic payments (surfaced directly in Circle's 2026 developer brand survey, which asks builders which they'd "reach for first" for agentic payments). They are the strategic reason an open, USDC-on-Arc seller layer matters.

| | Settlement asset | Open / self-host | Permissionless seller | AI-framework native |
|---|---|---|---|---|
| Stripe Tempo / Machine Payment Protocol | fiat + stablecoin (managed) | ❌ closed | ❌ Stripe account / KYC | partial |
| Visa / Mastercard agent rails | card networks | ❌ closed | ❌ network onboarding | ❌ |
| Google AP2 (Agent Payments Protocol) | processor-agnostic | spec open, impls vary | depends on processor | ✅ (Google ecosystem) |
| **Cadence (Arc402) on Arc** | **USDC (native gas)** | **✅ MIT, self-host** | **✅ clone + deploy** | **✅ Claude / MCP / LangChain** |

**The point for the Grant**: Circle's edge in this race is USDC-native settlement on Arc — but that edge only compounds if developers can stand up paid endpoints **without a gatekeeper.** The closed networks onboard sellers through accounts and approval; even Circle's own Agent Marketplace is form-gated. Cadence is the permissionless, open-source seller layer that lets Circle capture the long tail of builders before the closed networks lock it up. It does not compete with Nanopayments — it is the self-hosted reference deployment that makes the whole pattern adoptable, and it reinforces the "Circle is a developer platform, not just a stablecoin issuer" narrative with working seller-side proof.

## 0b. vs Crumb (Arc hackathon spotlight 2026-04-30)

**What Crumb is**: A merchant-facing product built on Circle Nanopayments, settling on Arc. Use cases: pay-per-use APIs, QR/peer transfers, merchant checkout. Founder Taylor Ferran, spotlight video with Sam Sealey (Circle Director of Community) at 29.6K views.

**Why Cadence doesn't compete with Crumb**:
- Crumb = **product layer** (like Stripe Checkout — point-of-sale, merchant onboarding, consumer UX)
- Cadence = **developer layer** (like Stripe.js + Stripe Connect — backend SDK + protocol)

Different markets, different audiences. Crumb sells to coffeeshops; Cadence sells to backend developers shipping AI tools. The two can coexist; Crumb could even use Cadence under the hood.

## 0c. vs Arc Escrow sample (`circlefin/arc-escrow`)

**What Arc Escrow is**: Circle's **official sample application** demonstrating AI-validated escrow on Arc. Buyer creates an escrow contract, deposits USDC, an AI agent submits a deliverable, an **OpenAI vision model** evaluates the submission, funds release on approval or refund on rejection. Uses an **EIP-712 "Refund Protocol"** signing scheme, deployed via Circle's `smart-contract-platform` and orchestrated through Circle Developer-Controlled Wallets API + Console webhooks. Repo: `github.com/circlefin/arc-escrow`. Stack: Next.js + Supabase + Circle managed wallet service.

**Why Cadence and Arc Escrow are different lanes, not competitors**:

| Dimension | Arc Escrow sample | Cadence/Arc402 |
|---|---|---|
| Payment model | **Discrete, multi-step**: create → deposit → submit → validate → release/refund | **Continuous, per-request**: deposit once, sign many claims, batched settle |
| Closest analogy | Upwork / deliverable-bounty / project escrow | AWS metered billing / Stripe pay-per-use |
| Deliverable validation | **AI vision-model evaluation** (OpenAI) — opinionated approval gate | None at protocol — service just collects when claim is valid |
| Tx count per "job" | 4-5 (create, fund, submit, decide, release) | 1-batch for *N* claims (≪1 tx per call) |
| Infrastructure deps | Circle Developer-Controlled Wallets API + Console webhooks + Supabase | Pure local middleware; only RPC + contract |
| Granularity ceiling | Project-level ($1-$10000+) | Sub-cent to dollar per call |
| Standard alignment | ERC-8183-style (job lifecycle) | x402-style (per-request HTTP 402) |

**The two compose naturally**:
- An ERC-8183 / Arc Escrow **job** can have its per-step compute / data / API costs **metered through Cadence**.
- Example: a 2-week agent-built market-research project is escrowed in Arc Escrow; the agent's underlying LLM/search/scraping calls during the work are paid via Cadence-protected endpoints; the AI vision model validates the final deliverable; final funds release through escrow.

**Practical docs implication**: Cadence's documentation should explicitly cross-reference Arc Escrow — "Use Cadence for streaming per-request payments. Use Arc Escrow or ERC-8183 when you need AI-validated work acceptance before funds release. The two are often used together inside the same agent product."



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
