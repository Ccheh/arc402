# Cadence

> **Streaming USDC micropayments for AI agents on Arc.**
>
> Cadence is the developer brand. **Arc402** is the underlying open protocol (and the on-chain EIP-712 domain). The pair is the missing streaming-payment layer below Circle's [ERC-8183](https://docs.arc.network/arc/tutorials/create-your-first-erc-8183-job) jobs and [ERC-8004](https://docs.arc.network/arc/tutorials/register-your-first-ai-agent) identity stack -- letting any API charge per call in USDC with sub-cent on-chain cost when batched, zero on-chain overhead per request, and gas-free agent onboarding via the sponsorship pattern.

## On-chain status

| | Value |
|---|---|
| **PaymentEscrowV2** (current) | [`0xc95b1b20f91901206ba3ea94bbc7313e7cd82f8d`](https://testnet.arcscan.app/address/0xc95b1b20f91901206ba3ea94bbc7313e7cd82f8d) |
| **PaymentEscrowV1** (legacy, historical record) | [`0x55aFA5Cf28B98DD6DC550F15c075F46B5eaf2a98`](https://testnet.arcscan.app/address/0x55aFA5Cf28B98DD6DC550F15c075F46B5eaf2a98) |
| Chain | Arc Testnet (chainId `5042002`) |
| V2 contract tests | **30/30** passing (15 V1 + 15 V2 inc. fuzz + gas curve) |
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

# 1. Run all 30 contract tests (V1 + V2 + fuzz + gas curve)
cd contracts && forge test -vv

# 2. Reproduce the 20-claim batch settlement on live Arc Testnet
#    (requires PRIVATE_KEY, SERVICE_PRIVATE_KEY, ESCROW_V2_ADDRESS in .env)
cd ../sdk-ts && npm install
npx tsx examples/stress-batch.ts

# 3. Reproduce 5 adversarial attacks (must all revert)
npx tsx examples/adversarial.ts
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

## Where Cadence fits in Circle's stack

| Layer | Tool | Cadence's relationship |
|---|---|---|
| Identity | ERC-8004 | **read** (planned: surface reputation in middleware) |
| Discrete jobs | ERC-8183 | **complementary** (large discrete contracts vs continuous stream) |
| Cross-chain | `@circle-fin/app-kit` | adapter pattern (planned) |
| Smart accounts | ZeroDev / Pimlico | optional layer on top (protocol session keys built-in) |
| **Streaming payments** | *(gap)* | **★ Cadence (Arc402 protocol)** |

See [`docs/spec.md`](docs/spec.md) for full positioning.

## Repository layout

| Folder | Purpose |
|---|---|
| [`contracts/`](contracts/) | Solidity — `PaymentEscrow.sol` (V1) + `PaymentEscrowV2.sol` (current) + 30 tests |
| [`sdk-ts/`](sdk-ts/) | TypeScript SDK — `requirePayment` middleware, `AgentClient`, `settle`, `settleBatch` |
| [`sdk-ts/examples/`](sdk-ts/examples/) | Live Arc Testnet demos: `run.ts`, `stress-batch.ts`, `adversarial.ts` |
| [`sdk-py/`](sdk-py/) | Python SDK (W3) |
| [`web/`](web/) | Marketing/demo site (W4) |
| [`docs/`](docs/) | Protocol spec, positioning |

## Roadmap

- **W1** ✅ V1 contract + Node SDK + single-claim demo
- **W2** ✅ V2 with batched settlement + session keys + 20-claim live test + 5 adversarial proofs
- **W3** Python SDK · formal Arc402 spec · ERC-8004 read integration · OpenRouter LLM gateway example
- **W4** Next.js demo marketplace · Circle Developer Grant submission · audit + mainnet deploy plan

## Author

Built by [Zen Chen](https://github.com/Ccheh) — Strategy Researcher @ Polymarket. MSc Data Science (Sheffield).

## License

[MIT](LICENSE)
