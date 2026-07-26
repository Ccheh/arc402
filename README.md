# Cadence

[![CI](https://github.com/Ccheh/arc402/actions/workflows/ci.yml/badge.svg)](https://github.com/Ccheh/arc402/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Arc Testnet](https://img.shields.io/badge/Arc%20Testnet-V2%20live-blue)](https://testnet.arcscan.app/address/0xc95b1b20f91901206ba3ea94bbc7313e7cd82f8d)
[![Tests](https://img.shields.io/badge/tests-34%20forge%20%2B%2027%20SDK%20passing-success)](#)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.28-blue)](contracts/foundry.toml)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](sdk-ts/tsconfig.json)

> **Streaming USDC micropayments for AI agents on Arc — an open-source self-hostable implementation of the Nanopayments pattern.**

## Where Cadence fits (honest positioning)

On **2026-04-29 Circle officially shipped [Agent Stack](https://agents.circle.com/)**, which includes their own production **Nanopayments** implementation via Circle Gateway. Cadence is **not a competitor** — it's the open-source reference implementation of the same architectural pattern, useful when you want:

- **Self-hostable infrastructure** without relying on Circle's hosted services
- **Forkable, modifiable Solidity + TypeScript** you can audit and adapt
- **Educational reference** for understanding how EIP-712 streaming payments work on Arc
- **A starting point** for protocols that need streaming-payment primitives but with different settlement semantics (see: [**Crucible**](https://github.com/Ccheh/crucible), the companion protocol that uses Cadence's pattern as the payment layer below quality-conditional settlement above)

**What Cadence is NOT trying to be**: the production payment rail for the Circle ecosystem — that's what Circle's official Nanopayments does, and it does it well. Cadence is the open reference.

## What it does

**Arc402** is the underlying open protocol (and the on-chain EIP-712 domain). Cadence is the developer brand around it. The pair lets any API charge per call in USDC with:

- **Sub-cent on-chain cost** when batched (32-37k gas per claim at n≥10)
- **Zero on-chain overhead per request** — claims are signed off-chain
- **Gas-free agent onboarding** via the sponsorship pattern (third party funds agent's escrow)
- **Session keys** so the agent's master key never touches a hot service
- **Composable with Circle's stack**: ERC-8183 (discrete jobs), ERC-8004 (agent identity), Agent Stack (wallets + marketplace), and Circle Gateway for outflow ([example](sdk-ts/examples/with-gateway.ts))
- **Native to the Python AI stack** via [`@cadence-sdk`](sdk-py/) — FastAPI `require_payment_fastapi` + Flask decorator + `settle_batch`, 18 pytest tests passing

## On-chain status

| | Value |
|---|---|
| **PaymentEscrowV2** (current) | [`0xc95b1b20f91901206ba3ea94bbc7313e7cd82f8d`](https://testnet.arcscan.app/address/0xc95b1b20f91901206ba3ea94bbc7313e7cd82f8d) |
| **PaymentEscrowV1** (legacy, historical record) | [`0x55aFA5Cf28B98DD6DC550F15c075F46B5eaf2a98`](https://testnet.arcscan.app/address/0x55aFA5Cf28B98DD6DC550F15c075F46B5eaf2a98) |
| Chain | Arc Testnet (chainId `5042002`) |
| Contract tests | **34/34** passing (15 V1 + 15 V2 + 3 invariants × 128k random calls + fuzz + gas curve) |
| V2 EIP-712 domain version | `"2"` — sigs do not cross-replay with V1 |
| License | MIT |

## What V2 adds over V1

1. **`claimBatch(Claim[])`** — settle N claims in one tx. Per-claim gas drops from 69k to **32-37k** (50%+ savings).
2. **`depositFor(agent)`** — third-party sponsorship; agent's escrow can be funded **without** the agent ever holding gas.
3. **`authorizeSession(sessionKey, expiry)`** — agent's master key delegates claim-signing to an ephemeral session key with expiry.
4. **Cross-version EIP-712 isolation** — V1 signatures cannot be replayed against V2 (confirmed live in adversarial test #5 below).

## Live on-chain evidence (Arc Testnet)

| Experiment | Proof |
|---|---|
| **V2 deployment** | tx [`0xed61c372...`](https://testnet.arcscan.app/tx/0xed61c3721e183f8e9032e590f5a1fa47b2e368208cfc69653b8e0a5f3e4053ab) |
| **20-claim batch settled in one tx** (5 agents × 4 claims) | tx [`0xce39b45b...`](https://testnet.arcscan.app/tx/0xce39b45baeab833ce3e02b96c3893a4511f5d4e94db27f9589162a7f66056f81) — gas 732,180 (36,609/claim) |
| **5/5 adversarial attacks blocked** | replay, expired, wrong-service, forged-sig, V1→V2 cross-version — each reverted with correct custom error |
| **depositFor sponsorship** | agents zero-gas onboarded via main wallet pre-funding their escrow |
| **LLM-style paid endpoint** (3 agents × 2 calls, batched) | OpenAI-compatible `/v1/chat/completions` priced at 0.005 USDC/call; 106ms avg latency; 6 claims settled in [`0xd93df460...`](https://testnet.arcscan.app/tx/0xd93df4607856fa09d06e76b54dd98d05ceaf6c2a167a79108f2bfa17f3be3a97) |
| **Cross-protocol integration with Crucible** (1 routine Cadence call + 1 Crucible-routed quality-attested call, same SERVICE) | Cadence deposit [`0xe5d0f7aa...`](https://testnet.arcscan.app/tx/0xe5d0f7aa2c5225079d20f9aa48616de97931d0b321002b7882752af08adfaa2a) · Crucible openMarket [`0x3fa47a01...`](https://testnet.arcscan.app/tx/0x3fa47a01aca51d2b53cda1ee652cea1874ab0b93c3ca5b2e5219e597efbd14b5) · Crucible collect (scoreBps=10000) [`0x0a1f6ab9...`](https://testnet.arcscan.app/tx/0x0a1f6ab91d8423fe19d1da151f94a57fb638d3d256e441028657f91b0d437f8b) · Cadence settleBatch [`0xe5c15625...`](https://testnet.arcscan.app/tx/0xe5c15625ac20854cd8a3da968ccc393ea385ed2b6bcc3c4c798484af3f637f0c). Orchestration script: [`hackathon-submission/integration/cross-protocol.ts`](https://github.com/Ccheh/arc402/tree/main) (separate repo) |
| **Single lifecycle** (V1 origin demo) | deposit / 402 / sign / settle — [`0x1931d9...`](https://testnet.arcscan.app/tx/0x1931d96f0f5ce0037d632325383d78e88f0386978251cd663d96ddb27d3b58e3) |

## Economics on real Arc Testnet (measured, not modeled)

At Arc's observed gas price of **20 gwei** (verified in batch tx above):

| Service price per call | Single-claim margin | Batched margin (n≥10) |
|---|---|---|
| $0.01 (typical SaaS API) | 86% | **93%** |
| $0.005 (cheap API) | 72% | **85%** |
| $0.002 (low-cost LLM) | 31% | **63%** |
| $0.001 (premium nanopayment) | -38% | **-27%** -- needs state channel / Merkle batching, future work |

**Cadence is economically viable for $0.002+ per call when batched.** Sub-millicent payments require next-gen settlement (open W3).

## Reproduce everything in 5 minutes

```sh
git clone https://github.com/Ccheh/arc402.git
cd arc402
git submodule update --init --recursive

# 1. Run all 34 contract tests (V1 + V2 + invariants + fuzz + gas curve)
cd contracts && forge test -vv

# 2. Reproduce the 20-claim batch settlement on live Arc Testnet
#    (requires PRIVATE_KEY, SERVICE_PRIVATE_KEY, ESCROW_V2_ADDRESS in .env)
cd ../sdk-ts && npm install
npx tsx examples/stress-batch.ts

# 3. Reproduce 5 adversarial attacks (must all revert)
npx tsx examples/adversarial.ts

# 4. Demo: OpenAI-compatible paid LLM endpoint, 3 agents x 2 calls, batched settle
npx tsx examples/llm-paid-demo.ts
```

## Architecture at a glance

```
┌──────────────┐   ┌────────────────────────────────┐   ┌──────────────┐
│ Agent        │   │ Service                         │   │ PaymentEscrow│
│ (smart acc / │   │ ┌──────────────┐ ┌───────────┐  │   │ V2 contract  │
│ EOA + sess.) │──▶│ │ requirePayment│ │ settleBatch│ │──▶│ on Arc       │
│              │HTTP   middleware    │ │ flusher    │ │   │              │
│ AgentClient  │   │ │ (off-chain    │ │ (every     │ │   │ - claimBatch │
│ - deposit    │   │ │  EIP-712 ver) │ │  5s)       │ │   │ - depositFor │
│ - signClaim  │   │ └──────────────┘ └───────────┘  │   │ - sessions   │
│ - fetch()    │   └────────────────────────────────┘   └──────────────┘
└──────────────┘
                  Per call:  HTTP 402 → sign claim → 200
                  Server:    queue claim → flush in batch when economic
                  Settle:    1 tx settles N claims → service gets USDC
```

## Cadence + Circle Gateway — composing them

Cadence and Circle Gateway are **complementary, not competing**. They split the
service-side payment problem at the natural seam: **collection** vs **routing**.

```
   Agent ──Cadence──▶ Service wallet (Arc) ──Gateway──▶ Base / ETH / Op / Arb
   per-call sigs        per-batch USDC            cross-chain settlement
   (off-chain)          (1 tx settles N)          (Circle hosted)
```

| Layer | What it does | Where it runs |
|---|---|---|
| **Cadence** | Collect per-call EIP-712 claims from agents, batch-settle N claims on Arc in one tx (~32-37k gas/claim) | On-chain, Arc Testnet/Mainnet, self-hosted by the service |
| **Circle Gateway** | Route the resulting USDC across chains (CCTP), settle to wherever the service treasury lives | Circle hosted infrastructure, requires Circle account |

A working Cadence + Gateway pattern walks through this in
[`sdk-ts/examples/with-gateway.ts`](sdk-ts/examples/with-gateway.ts) — runs the
Cadence batch settlement live on Arc Testnet, then documents the Gateway
handoff call (which requires a Circle account so we document rather than
execute it).

**Key positioning takeaway**: a real Cadence deployment ends where Gateway
begins. Cadence is the seller-side middleware that produces the USDC stream
Gateway routes. Treating them as alternatives is a category error.

## Where Cadence fits in Circle's stack

| Layer | Tool | Cadence's relationship |
|---|---|---|
| Identity | ERC-8004 | **read** (planned: surface reputation in middleware) |
| Discrete jobs | ERC-8183 | **complementary** (large discrete contracts vs continuous stream) |
| Cross-chain | `@circle-fin/app-kit` | adapter pattern (planned) |
| Smart accounts | ZeroDev / Pimlico | optional layer on top (protocol session keys built-in) |
| **Streaming payments** | Circle's official **Nanopayments** (via Gateway) — production hosted | Cadence (Arc402 protocol) — open self-hostable reference |

See [`docs/spec.md`](docs/spec.md) for full positioning.

## Honest limits

Cadence is a portfolio-quality reference implementation, not a production payment rail. Things to know before depending on it:

- **No production adopters yet.** Every transaction on Arc Testnet was generated by our own scripts. We have not yet seen a third-party service integrate Cadence for real traffic.
- **Pre-audit.** 34 forge tests + 27 SDK vitest tests pass, 5/5 adversarial scenarios are blocked, and [`audits/slither-report.md`](audits/slither-report.md) reports no high or medium severity findings. No independent security audit has been performed yet — treat as testnet-only.
- **Circle's official Nanopayments covers the same architectural ground.** If you don't need self-hosting or forkable code, prefer the official version — it has Circle's reliability guarantees and direct support.
- **Sub-millicent payments not viable** at observed Arc gas prices (20 gwei). The $0.001/call price point lands at -38% margin even when batched. Truly nano payments need state channels or Merkle batching — out of scope for this version.
- **The "streaming" framing is one-shot escrow + signed claims**, not literal per-second streaming. Each claim is an off-chain EIP-712 signature; on-chain settlement is batched. This is correct architecture but worth being precise about.

## Repository layout

| Folder | Purpose |
|---|---|
| [`contracts/`](contracts/) | Solidity — `PaymentEscrow.sol` (V1) + `PaymentEscrowV2.sol` (current) + 34 tests |
| [`sdk-ts/`](sdk-ts/) | TypeScript SDK — `requirePayment` middleware, `AgentClient`, `settle`, `settleBatch` |
| [`sdk-ts/examples/`](sdk-ts/examples/) | Live Arc Testnet demos: `run.ts`, `stress-batch.ts`, `adversarial.ts` |
| [`sdk-py/`](sdk-py/) | Python SDK — agent (`AgentClient`) + service-side (FastAPI / Flask middleware, `verify_claim`, `settle_batch`). 18 pytest tests passing |
| [`web/`](web/) | Static landing page (deployable to GitHub Pages / Vercel zero-config) |
| [`docs/`](docs/) | Protocol spec, positioning |

## Roadmap

- **W1** ✅ V1 contract + Node SDK + single-claim demo
- **W2** ✅ V2 with batched settlement + session keys + 20-claim live test + 5 adversarial proofs
- **W3** ✅ vitest SDK test suite (27/27) ✅ LLM-style paid endpoint demo (batched, on-chain settled) ✅ Python SDK MVP (`cadence-sdk`) ✅ ERC-8004 IdentityRegistry read (live on Arc Testnet) ✅ [Security analysis + audit prep doc](docs/security-analysis.md) ✅ GitHub Actions CI ✅ LangChain integration example · ⏳ formal Arc402 spec polish · independent audit (Grant M2)
- **W4** Next.js demo marketplace · Circle Developer Grant submission · audit + mainnet deploy plan

## Author

Built by [Zen Chen](https://github.com/Ccheh) — MSc Data Science (Sheffield). Building on Arc.

## License

[MIT](LICENSE)
