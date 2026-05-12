# Building Cadence: streaming USDC micropayments for AI agents on Arc

> Posted from the "build in public" school of thinking — I'd rather show what works than promise what might. Everything in this post is reproducible from the repo in under 5 minutes.

There's a gap in Circle's emerging agentic stack on Arc. **ERC-8004** handles agent identity. **ERC-8183** handles discrete job contracts. **`@circle-fin/app-kit`** handles bridging, swapping, and unified balance across chains.

What's missing: **per-API-call streaming micropayments.** The thing AI agents will actually need every day — pay 0.005 USDC to call an LLM, pay 0.01 USDC to query an oracle, pay 0.002 USDC to use a translation API. ERC-8183 is too heavy (five transactions per "job"). App Kit is the wrong layer (not per-call billing). Traditional Stripe billing needs API keys and KYC — incompatible with autonomous agents.

I spent the last 48 hours building **Cadence** — a streaming-payment SDK on the open **Arc402** protocol — to fill that gap. Live on Arc Testnet today. Here's what works, what doesn't, and what I learned.

## The mechanic

Cadence/Arc402 uses three primitives:

1. **Pre-deposit escrow.** An agent deposits USDC once into `PaymentEscrowV2`. No per-call deposit, no payment channel setup.
2. **Off-chain signed claims.** Per API call, the agent signs an EIP-712 claim authorizing the service to pull `X` USDC. No on-chain transaction per call. The middleware verifies the signature in ~50ms locally.
3. **Batched on-chain settlement.** The service queues claims and submits them in batch via `claimBatch(Claim[])` when economic — typically every N seconds or N claims.

That's it. The contract is ~250 lines of Solidity. The TypeScript SDK is ~400. The integration on the service side is three lines of Express middleware:

```ts
app.post(
  "/v1/chat/completions",
  requirePayment({ amount: parseUsdc("0.005"), escrow, service, chain: ARC_TESTNET }),
  async (req, res) => res.json(await yourActualHandler(req)),
);
```

## Why Arc specifically

The economic model only works on chains where **USDC = gas**. On Ethereum or Base, an agent needs ETH for gas before it can use USDC — and we're back to the "agents need to manage multiple tokens" problem we set out to avoid. On Arc:

- USDC is the **native gas token**. No second-token onboarding.
- Effective gas price on testnet measured at **~20 gwei** in real txs.
- `depositFor(agent)` pattern: a sponsor can pre-fund any agent's escrow. The **agent itself can transact with zero gas** — it only ever signs.

This is not portable. Move Cadence to any other EVM chain and you lose the central UX advantage.

## The numbers (measured, not modeled)

I shipped a forge test that runs single-claim and batched settlement back-to-back. Output from the test suite:

```
Gas per claim (single):      69,333
Gas per claim (batch=10):    32,972   ← 52% reduction
Gas per claim (batch=50):    32,013
Gas per claim (batch=100):   32,046
```

Two observations. **First**, batching saves ~52% per claim. **Second**, the savings flatten after batch size 10 — the marginal benefit of going from 10 to 100 in one batch is negligible. The floor (~32k gas) is where signature verification + two storage writes dominate. So in production: **auto-flush at batch=10**, not "wait until 100".

Translated to dollars at Arc's 20 gwei: **$0.00073 per claim** when batched. Margin analysis at common API price points:

| Service price | Single-claim margin | Batched margin |
|---|---|---|
| $0.01 | +86% | **+93%** |
| $0.005 | +72% | **+85%** |
| $0.002 | +31% | **+63%** |
| $0.001 | -38% | **-27%** (need state channels) |

**Cadence is economically viable for $0.002+ per call when batched.** Sub-millicent payments need next-gen settlement — Merkle batched proofs or true state channels. Open work.

## Adversarial verification, on chain

It's one thing to write unit tests. It's another to actually submit five attacks to live Arc Testnet and verify each reverts with the correct error. I did the second.

```
Attack 1: Replay (submit same claim twice)        → NonceAlreadyUsed
Attack 2: Expired claim                            → ClaimExpired
Attack 3: Wrong service (sig binds X, msg.sender Y) → InvalidSignature
Attack 4: Forged signature (attacker signs as me)  → InvalidSignature
Attack 5: V1→V2 cross-version replay              → InvalidSignature
```

All five blocked. The agent's escrow balance is the golden proof: deposited 1 USDC, only 0.01 USDC consumed by the single legitimate claim that ran between attacks, 0.99 USDC remaining. The contract refused every attack.

Attack 5 is worth pausing on. When I deployed V2, I bumped the EIP-712 domain version from `"1"` to `"2"`. This means a signature crafted against V1 cannot replay against V2 — even with the same nonce, agent, service, amount. I tested this live. The chain confirms it: `InvalidSignature` revert. Domain isolation works.

## Composition with Circle's stack

Cadence is built *with* Circle's stack, not against it. The current map:

| Circle layer | Tool | Cadence's relationship |
|---|---|---|
| Identity | ERC-8004 | **Read** — middleware can query `IdentityRegistry` (deployed at `0x8004A818...` on Arc Testnet) before pricing a call |
| Discrete jobs | ERC-8183 | **Complementary** — Cadence handles streams, 8183 handles discrete contracts |
| Cross-chain liquidity | `@circle-fin/app-kit` | **Adapter pattern** (planned) — Cadence ships as an App Kit adapter so existing App Kit users get per-call billing with one import |
| Smart accounts | ZeroDev / Pimlico (ERC-4337) | **Optional** — Cadence has protocol-level session keys; users can layer ZeroDev on top for full AA |
| **Streaming payments** | *(gap)* | **Cadence fills this** |

I shipped a live ERC-8004 read in the SDK this morning. `getAgentIdentity(addr)` returns `{ registered, tokenCount }`. The integration works against Circle's published registry contract. The next step is wiring this into `requirePayment` middleware so services can apply per-identity pricing — "0.005 USDC for unknown agents, 0.001 USDC for ERC-8004-verified ones, free for top-reputation."

## What's open

I'm being honest about what's NOT done:

- **Audit.** The contract is small (~250 LOC) but unaudited. Mainnet deploy requires a focused audit first.
- **Sub-millicent settlement.** Batched settlement is profitable at $0.002+/call. Below that needs Merkle-batched proofs or state channels — open work.
- **Real LLM integration.** The demo uses a mock LLM responder labeled as such. Wiring up real OpenAI/Anthropic is a 3-line handler swap; doing it for real with metering and request signing is week-scale work, not hours.
- **Demand validation.** Zero paying users today. I have working code; I do not yet have working customers. Concrete plan: find 1-2 pilot integrators in the next two weeks before applying for Grant disbursements.
- **Python SDK** is at MVP — agent-side primitives done; middleware port (Flask/FastAPI) is W4 work.

## What's done (verifiable)

If you came here for evidence:

| Artifact | Where |
|---|---|
| `PaymentEscrowV2` contract | [`0xc95b1b20...82f8d` on Arc Testnet](https://testnet.arcscan.app/address/0xc95b1b20f91901206ba3ea94bbc7313e7cd82f8d) |
| 57 passing tests | 30 forge + 27 vitest in [the repo](https://github.com/Ccheh/arc402) |
| 20-claim batch settled live | tx `0xce39b45b...` |
| 6-claim LLM demo settled live | tx `0xd93df460...` |
| 5 adversarial attacks blocked | each reverted with correct custom error on chain |
| TypeScript SDK | `@arc402/sdk` v0.0.1 |
| Python SDK | `cadence-sdk` v0.0.1 |
| ERC-8004 read | `getAgentIdentity()`, live verified |
| MIT license, public repo | https://github.com/Ccheh/arc402 |

## Try it yourself

```sh
git clone https://github.com/Ccheh/arc402.git
cd arc402
git submodule update --init --recursive

# All 30 contract tests
cd contracts && forge test

# 27 SDK tests
cd ../sdk-ts && npm install && npm test

# Live testnet demos (need PRIVATE_KEY in .env)
npx tsx examples/stress-batch.ts        # 20-claim batched settle
npx tsx examples/adversarial.ts         # 5 attacks must revert
npx tsx examples/llm-paid-demo.ts       # OpenAI-style paid endpoint
npx tsx examples/erc8004-check.ts       # ERC-8004 read
```

## What I'm looking for

I'm one person right now. If you're a builder on Arc — especially building AI tools, agents, or any per-call API — and you'd want to pilot Cadence at a real or sandbox scale, I'd love to hear from you. The next two weeks are about turning "verified on testnet" into "first real settled volume." Drop me a line on [GitHub](https://github.com/Ccheh) or in the Arc Discord.

— Zen Chen (陈振民), Strategy Researcher @ Polymarket, MSc Data Science (Sheffield)
