# Circle Developer Grant — Cadence (Arc402 protocol)

> **Working draft** — copy/paste fields into [circle.questbook.app](https://circle.questbook.app/) when ready to submit.
> Author: Zen Chen. Last revised: 2026-06-03.

---

## Field 1: Project name
**Cadence**

(Built on the open **Arc402** protocol. "Cadence" is the developer brand and SDK; "Arc402" is the on-chain protocol name and EIP-712 domain.)

## Field 2: One-line description
Streaming USDC micropayments for AI agents on Arc — sub-cent per-call billing with zero on-chain overhead per request.

## Field 3: Project URL / GitHub
- GitHub: **https://github.com/Ccheh/arc402** (public, MIT, 79 passing tests)
- Live contract: [`0xc95b1b20...82f8d` on Arc Testnet](https://testnet.arcscan.app/address/0xc95b1b20f91901206ba3ea94bbc7313e7cd82f8d)
- Spec: [`docs/spec.md`](https://github.com/Ccheh/arc402/blob/main/docs/spec.md)

---

## Positioning — winning the seller side of the agentic-payments race (2026 Arc track)

**One line.** Cadence (Arc402) is the open-source, permissionless, self-hostable **seller-side layer** for agentic USDC payments on Arc — letting any developer accept per-call USDC **without an approval form**, settling through the same Nanopayments + Gateway pattern Circle already ships.

**The contested frontier.** Agentic payments is where the closed networks are converging — **Stripe (Tempo / Machine Payment Protocol), Visa & Mastercard agent rails, and Google's AP2.** Circle's structural edge is USDC-native settlement on Arc: gas-free sub-cent charges, ~1-second finality, and an open standards stack (x402, EIP-712/3009, ERC-8004 identity, ERC-8183 jobs). Cadence turns that edge into something a developer adopts in an afternoon — which is how Circle wins the **seller side** before the closed networks lock it up.

**The gap.** Circle has shipped the rails and the demand side (Nanopayments, Gateway, Agent Marketplace, Agent Stack), but listing a paid agent service still runs through a gated approval form. For the agentic economy to compound, *any* developer needs to stand up a paid endpoint **permissionlessly, in minutes, in the language they already use.** Cadence is that missing seller-side middleware — the open, self-hostable counterpart to the Agent Marketplace, and exactly the "seller-side middleware reference" Tim Baker called for.

**Capability fit (the gaps builders cite):** gas-free sub-cent nanopayments · sub-second settlement · first-class AI-framework integration (Claude / MCP / LangChain) · SDKs in TypeScript and Python — all live today.

**Why it strengthens Circle, not competes.** Every paid call is USDC on Arc, so adopting Cadence *is* adopting USDC + Arc + the Circle agentic stack — working seller-side proof for the "Circle is a developer platform, not just a stablecoin issuer" narrative. It composes with Nanopayments + Gateway, reads ERC-8004 identity, and complements ERC-8183 jobs.

| Listing a paid agent service | How |
|---|---|
| Circle Agent Marketplace | gated — approval form, Circle-hosted |
| Stripe Tempo / Visa·MC / Google AP2 | closed networks, not USDC/Arc-native |
| **Cadence (Arc402)** | **permissionless · self-hostable · open-source · USDC-on-Arc-native** |

---

## Field 4: The problem we're solving

Today's AI agent ecosystem has no clean way to charge **per-API-call** in stablecoins **with permissionless deployment**. Existing primitives partially fit, but each leaves a gap Cadence addresses:

- **Circle Nanopayments** (announced 2026-04-29, ships the official `withGateway()` middleware in `@circle-fin/x402-batching/client`) covers the protocol pattern (x402 + Gateway batched settlement) but is **gated**: sellers list at `agents.circle.com` only by application/form. Cadence is the **permissionless, open-source seller-side reference** Tim Baker publicly called for in that same blog (§ "Get Involved" → "Seller-side middleware examples"). Same protocol, different deployment posture — the GitHub vs GitHub Enterprise / WordPress.org vs WordPress.com dynamic.
- **ERC-8183** (job escrow) is multi-tx and evaluator-gated — overkill for "charge $0.001 per LLM call."
- **`@circle-fin/app-kit`** covers bridging/swapping/sending, not per-call billing.
- **Stripe / traditional billing** requires accounts, API keys, KYC, and fiat rails — incompatible with autonomous agents.
- **Lightning / state channels** require channel setup and bilateral trust — too much friction.

Yet AI agents will increasingly need to pay for:
- Per-call API access (LLMs, search, scraping, geocoding)
- Compute time (rented GPU, serverless functions)
- Data marketplace access
- Inter-agent service fees

**The streaming-micropayment gap is real, and growing.**

## Field 5: Our solution

**Cadence**, built on the **Arc402** protocol, ships five primitives:

1. **Pre-deposit escrow** (`PaymentEscrowV2`): An agent deposits USDC once into the on-chain contract.
2. **Off-chain signed claims**: Per API call, the agent signs an EIP-712 claim authorizing the service to pull `X` USDC. **No on-chain transaction per call.** Claims verify in ~50ms locally.
3. **Batched settlement** (`claimBatch`): The service queues claims and submits them in batch when economic. **Per-claim gas drops 52%** (32k vs 69k single, measured on chain).
4. **Reputation-tiered pricing via ERC-8004 (LIVE)**: Cadence middleware reads the agent's ERC-8004 IdentityRegistry status inline and applies a discounted price tier to verified agents. *This primitive does not exist in Circle Nanopayments or Coinbase x402* — both settle based on USDC balance only and have no native identity-awareness. By composing with Circle's own ERC-8004 standard, Cadence delivers per-call identity-gated pricing that Circle's hosted settlement layer structurally cannot.
5. **Refundable claims (v0.3 design)**: Spec proposal for opt-in dispute window before service collection. Agent can claw back funds within the window if service delivered poor output. SLA-aware payments — see [spec.md §12](https://github.com/Ccheh/arc402/blob/main/docs/spec.md).

**Honest delta vs Circle Nanopayments (announced 2026-04-29)**: Tim Baker's product covers (1), (2), (3). Cadence is the **open-source reference seller-side middleware** he publicly called for in that blog, plus the AI-native extensions (4) and (5). The two compose — a Cadence seller can be Gateway-funded; an Arc402 batch can settle alongside Gateway settlement.

**On Arc specifically:**
- USDC is the **native gas token** — agents never need to acquire another token.
- Gas is predictable at ~20 gwei — sub-cent payments are economically viable.
- The `depositFor(agent)` pattern lets a sponsor pre-fund an agent's escrow — **agents can transact with zero gas of their own**.

## Field 6: Why Arc is core, not bolted-on

The economic model **only works on chains where USDC = gas**. On Ethereum or Base, an agent needs ETH for gas before it can use USDC — defeating the "agent-native onboarding" pitch. On Arc:

| Property | Other EVM chains | Arc |
|---|---|---|
| Gas token | ETH / native | **USDC** |
| Need separate gas reserve | Yes | **No** |
| Sub-cent settlement viable | Marginal | **Yes** |
| Sponsorship pattern (zero-gas agent) | Possible via paymaster | **Native** (just `depositFor`) |
| 18-decimal USDC precision | Wrapping needed | **Native** |

**Cadence is not portable to other chains without losing its central UX advantage.**

## Field 7: Current state (built and verified, not planned)

All of the following is **live and verifiable on Arc Testnet today**:

| Artifact | Evidence |
|---|---|
| `PaymentEscrowV2` contract deployed | [`0xc95b1b20...82f8d`](https://testnet.arcscan.app/address/0xc95b1b20f91901206ba3ea94bbc7313e7cd82f8d) |
| 34 contract tests passing (15 V1 + 15 V2 + 3 invariants) | `forge test` in CI |
| 45 SDK tests passing (27 TypeScript + 18 Python) | `npm test` (TS) + `pytest` (Python) |
| Gas curve measured | single 69k → batched 32k per claim (52% reduction) |
| 20-claim batched settlement on chain (5 agents × 4 claims) | [tx `0xce39b45b...`](https://testnet.arcscan.app/tx/0xce39b45baeab833ce3e02b96c3893a4511f5d4e94db27f9589162a7f66056f81) |
| 6-claim LLM endpoint settlement (3 agents × 2 calls @ 0.005 USDC) | [tx `0xd93df460...`](https://testnet.arcscan.app/tx/0xd93df4607856fa09d06e76b54dd98d05ceaf6c2a167a79108f2bfa17f3be3a97) |
| 5 adversarial attacks all reverted with correct custom errors | replay / expired / wrong-service / forged-sig / V1-V2 cross-version |
| EIP-712 cross-version safety | V1 sigs cannot replay on V2 (verified on chain) |
| TypeScript + Python SDKs shipped | `@arc402/sdk` (TS) + `cadence-sdk` (Python) — `requirePayment` middleware, `AgentClient`, `settle`, `settleBatch` |
| OpenAI-compatible paid endpoint demo | 106ms avg latency, real USDC settled on chain |
| Public OSS repo with MIT license | https://github.com/Ccheh/arc402 |

This is **not a deck pitch** — it's a working system you can clone and run in 5 minutes.

## Field 8: Milestones (12-week plan tied to grant disbursements)

I propose 5 milestones at 2-3 week cadence. Each is verifiable on-chain or in GitHub.

### M1 (Week 2): Be the canonical seller-side reference for Circle Nanopayments
- Position Cadence as the open-source seller-side middleware Tim Baker called for in his 2026-04-29 Nanopayments blog.
- Ship one real AI-tool integration as a Cadence-paid endpoint (target: open-source LLM wrapper or real-world API).
- Publish a public reference linked from at least one Circle-controlled property (community.arc.network, agents.circle.com listing, or developer docs).
- Verification: live URL + open-source repo + one real on-chain settlement + one cross-reference from Circle infrastructure.
- **Disbursement: $5,000**

### M2 (Week 4): Audit + mainnet readiness
- Engage independent auditor (Trail of Bits / Spearbit / smaller boutique) for a focused review of `PaymentEscrowV2`.
- Address all High and Medium findings.
- Deploy audited V2 to Arc mainnet on launch.
- Verification: public audit report + mainnet contract address.
- **Disbursement: $10,000**

### M3 (Week 6): MCP / AI-framework integration + SDK hardening
- **Already delivered pre-grant:** Python SDK (`cadence-sdk`, parity with TypeScript) and inline `ERC-8004` agent-identity reads in `requirePayment` middleware.
- New in this milestone: ship an **MCP server adapter** so a Claude / LangChain agent can discover an Arc402 endpoint and settle per call in a few lines — the AI-framework integration builders ask for, and the seller-side contribution Tim Baker called for.
- Harden both SDKs and publish `llms.txt` + AI-native docs.
- Verification: published MCP adapter + a Claude/MCP agent paying an Arc402 endpoint on testnet + docs live.
- **Disbursement: $5,000**

### M4 (Week 9): Developer experience + dashboard
- Ship `cadence.dev` (Next.js) — interactive docs, paid-endpoint playground, live testnet dashboard showing batched settlements.
- Document common patterns: subscriptions, rate-limited free tiers, ERC-8004-gated premium tiers.
- Verification: live deployed site + at least 3 community-contributed demo integrations.
- **Disbursement: $3,000**

### M5 (Week 12): Real volume
- Achieve $10,000 in real (mainnet) settled volume across at least 10 paid services.
- Publish quantitative case study: gas cost vs revenue, settlement cadence, failure modes.
- Verification: on-chain analytics dashboard.
- **Disbursement: $2,000**

**Total ask: $25,000 USDC.**

## Field 9: Use of funds (granular)

| Bucket | Amount | Rationale |
|---|---|---|
| Independent audit | $10,000 | Focused review of `PaymentEscrowV2` (small surface, ~250 LOC) before mainnet |
| Frontend (Next.js docs + playground) | $5,000 | DevX matters more than additional features for adoption |
| Open-source contributions to dev tools | $3,000 | Sponsor a developer to contribute Cadence support to common AI agent frameworks (LangChain, MCP servers, etc.) |
| Cloud infra + RPC + monitoring | $2,000 | 6 months of production infra for the playground + dashboard |
| Marketing / DevRel content | $3,000 | Technical blog series, conference travel (1 event), tutorial videos |
| Buffer (unexpected security findings, infrastructure spikes) | $2,000 | |
| **Total** | **$25,000** | |

## Field 10: Team

**Solo founder for now, with intent to expand based on traction.**

**Zen Chen** (Chinese name 陈振民)
- **Strategy Researcher at Polymarket** — quant on USDC-settled prediction markets. Direct domain expertise in stablecoin commerce at scale and adversarial conditions.
- **MSc Data Science, University of Sheffield** — ranked **1st in cohort**. Analytical foundation.
- Prior crypto: BRC-20 indexing work (Python), DAO governance research (DARC contributions).
- GitHub: [@Ccheh](https://github.com/Ccheh) · X: [pending — to be added before submission]
- Location: Xiamen, China.

**Why solo is workable for the M1-M3 scope:**
- 24-hour execution proof: built and deployed V2 (contract + tests + SDK + 5 live demos) in one session.
- All milestones M1-M3 are well within a single developer's scope.
- Plan to recruit a co-founder for M4-M5 community + DevRel work; grant funding partially earmarked for this.

## Field 11: Traction

**Honest status: pre-launch, no paying users yet.** What we have instead:

- **Working product** (not just specs) — anyone can clone the repo and reproduce all 5 live testnet demos in 5 minutes.
- **34 + 45 = 79 passing tests** (contract + TS/Python SDK) with fuzz coverage and gas measurements.
- **5 adversarial attacks blocked live on chain** — economic security verified, not just simulated.
- **Open OSS** — MIT, public from day 1.
- **Strategic positioning** validated against Circle's announced direction (ERC-8004 / ERC-8183 / App Kit / Architects program) — Cadence sits in the explicitly-named gap.

**Targets before M1 disbursement** (i.e., what I'll show in the technical walkthrough):
- 1-2 letters of intent from AI tool developers willing to integrate at mainnet launch.
- 1 paying pilot lined up (even if small volume).
- Community presence: active in Arc Discord, posted on `Build on Arc`.

## Field 12: How does this compose with the existing Circle stack?

Cadence is **complementary**, not competitive, to every layer Circle already ships:

| Circle layer | What it does | Cadence relationship |
|---|---|---|
| **USDC** | The settlement asset | Required substrate |
| **Arc chain** | Stablecoin-native L1 | Required substrate (uses 18-decimal native gas) |
| **`@circle-fin/app-kit`** | Bridge / Swap / Send / Unified Balance | Cadence ships as **App Kit adapter** for "paid endpoint" workflows (planned M3) |
| **Circle Nanopayments + `withGateway()` middleware** | Official x402 + Gateway batched-settlement protocol + seller middleware (announced 2026-04-29) | **Compose, don't replace** — Cadence is the OSS self-hosted alternative-deployment Tim Baker publicly called for; Cadence-protected sellers can still accept Gateway-funded payments |
| **`agents.circle.com` (Agent Marketplace)** | Curated listing of paid agentic endpoints (537 endpoints / 42 services as of 2026-05-12) | Cadence-protected endpoints can be listed (manually); also self-discoverable for builders who don't apply through the form |
| **Arc Escrow sample (`circlefin/arc-escrow`)** | AI-validated multi-step escrow with OpenAI vision model evaluation, EIP-712 Refund Protocol | **Different lane** — Arc Escrow is project/job escrow (Upwork-style); Cadence is per-request metering (AWS-style). Both compose: Cadence handles the per-call cost layer inside an Arc Escrow job |
| **ERC-8183 (job escrow)** | Discrete, evaluator-gated job contracts | **Complementary** — Cadence covers the streaming case 8183 doesn't fit |
| **ERC-8004 (agent identity)** | Onchain agent identity + reputation | Cadence **consumes** 8004 for trust signals in middleware (planned M3) |
| **ZeroDev / Pimlico (AA)** | Smart accounts | Cadence ships protocol-level session keys; complements third-party AA |

**The narrative**: Cadence is the "Stripe per-call" for the Circle agentic stack — App Kit handles money in/out, Cadence handles per-call value flow, ERC-8004 handles identity, ERC-8183 handles discrete jobs. **Each layer focused, none duplicative.**

## Field 13: Risks and mitigations

1. **Solo founder risk** → Mitigant: M1 grant disbursement contingent on first integration shipping = forced traction validation before further funding.
2. **No mainnet audit yet** → Mitigant: M2 audit is the first explicit milestone; no mainnet deploy without it.
3. **Demand uncertainty** → Mitigant: pre-launch outreach to find 1-2 integration partners before M1.
4. **Arc adoption risk** (chain itself doesn't take off) → Mitigant: SDK is portable. Core protocol works on any EVM chain. Cadence's value-add increases on Arc but isn't dependent on Arc winning.
5. **Settlement economics at sub-cent prices** → Honest limit: current architecture is profitable at $0.002+/call. Below that needs state channels or Merkle-batched proofs — flagged as W3+ future work, not in this grant scope.

---

## Cover note for the form (use as introduction)

> Cadence is the streaming-payment SDK for AI agents on Circle's Arc, built on the open Arc402 protocol. We've shipped a complete working system — `PaymentEscrowV2` deployed on testnet, batched settlement verified at 52% gas reduction, 5 adversarial attacks blocked on chain, 79 tests passing, an OpenAI-compatible paid endpoint demo, and a public OSS repo. Everything in this proposal is reproducible in 5 minutes from the README.
>
> The 12-week, 5-milestone plan ($25K total) gets Cadence from "verified on testnet" to "$10K real settled volume on mainnet with audit complete and at least one major AI tool integrated."
