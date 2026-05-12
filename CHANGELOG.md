# Changelog

All notable changes to Cadence / Arc402 protocol.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] — 2026-05-12

First stable baseline. 48-hour build from empty repo → audit-prep-ready open-source protocol implementation. Live on Arc Testnet.

### Added — Smart contracts

- `PaymentEscrow.sol` (V1) — initial escrow with `deposit` / `withdraw` / `claim` and EIP-712 v1 signed claims. Deployed at `0x55aFA5Cf28B98DD6DC550F15c075F46B5eaf2a98`.
- `PaymentEscrowV2.sol` (V2, current) — adds:
  - `claimBatch(Claim[])` for atomic multi-claim settlement. Measured 52% per-claim gas reduction (69k → 32k) at batch sizes ≥ 10.
  - `depositFor(address agent)` — sponsorship pattern for zero-gas agent onboarding.
  - `authorizeSession(address, uint64)` / `revokeSession` — protocol-level session keys.
  - EIP-712 domain version `"2"` — cross-version replay isolation verified live on chain.
  - Deployed at `0xc95b1b20f91901206ba3ea94bbc7313e7cd82f8d`.

### Added — Tests

- 16 V1 unit tests covering deposit/withdraw/claim lifecycle, replay protection, signature recovery
- 15 V2 unit tests adding `claimBatch`, session keys, depositFor, V1↔V2 isolation, gas curve measurement
- 3 invariant tests (Foundry StdInvariant): conservation of value, contract-balance bookkeeping match, balance non-negativity. Each runs 256 random sequences × 500 calls = **128k random call sequences each**.
- 27 SDK vitest tests covering utils, signing flow, middleware behavior (402 / wrong-service / expired / underpaid / forged)
- **Total: 61 passing tests, 0 failures**

### Added — TypeScript SDK (`@arc402/sdk`)

- `AgentClient` with `deposit`, `withdraw`, `balanceInEscrow`, `signClaim`, `fetch` (auto-402 retry)
- `requirePayment` Express middleware with **reputation-tiered pricing** via ERC-8004 (Cadence-only, not in Nanopayments)
- `settle` (single-claim) and `settleBatch` (atomic batch) helpers
- `getAgentIdentity` reading from Circle's canonical ERC-8004 IdentityRegistry on Arc Testnet
- Full TypeScript strict mode, 0 type errors

### Added — Python SDK (`cadence-sdk`)

- `AgentClient` parity with TypeScript (deposit/withdraw/sign/fetch)
- EIP-712 v2 domain signing via `eth-account`
- LangChain integration example for paid tool invocation

### Added — Live demos (all real on-chain on Arc Testnet)

- Single lifecycle (V1) — `tx 0x1931d9...58e3`
- 20-claim batched settle (5 agents × 4 claims) — `tx 0xce39b45b...f81`
- 5 adversarial attacks blocked (replay / expired / wrong-service / forged / V1→V2 cross-version) — each reverted with the correct custom error
- LLM-style paid `/v1/chat/completions` endpoint with batched settlement — `tx 0xd93df460...a97`
- ERC-8004 IdentityRegistry live read confirmed
- Reputation-tiered pricing demo verified

### Added — Documentation

- `README.md` — reviewer-facing landing with live evidence
- `docs/spec.md` — 13-section formal protocol specification (v0.2), includes reputation-tiered pricing (live) and refundable-claims design proposal (v0.3 future work)
- `docs/security-analysis.md` — threat model, 14 attack vectors mapped to mitigations, audit prep checklist
- `docs/competitive-analysis.md` — explicit comparison vs Circle Nanopayments (released 2026-04-29), x402, Lightning, Stripe, direct-on-chain, subscriptions, ERC-8183, Crumb
- `docs/grant-application-draft.md` — Circle Developer Grant application ready (5 milestones, $25K ask)
- `docs/blog-cadence-on-arc.md` — Arc House guest-post draft, 2000 words
- `docs/mainnet-deploy-checklist.md` — 7 hard prereqs + post-deploy verification runbook
- `docs/integrations/mcp-server.md` — pattern for wrapping MCP servers in Cadence payments

### Added — Infrastructure

- `LICENSE` (MIT)
- `web/index.html` — single-file static landing page, deployable to GitHub Pages or Vercel zero-config
- `.github/workflows/ci.yml` (local — not pushed pending OAuth `workflow` scope) — Foundry tests + vitest + Python smoke import
- `contracts/script/DeployMainnet.s.sol` with `MAINNET_CONFIRM` safety latch

### Strategic positioning at v0.1.0

After Circle's Nanopayments product launched on 2026-04-29 with the same architectural pattern (HTTP 402 + signed auth + batched settlement), Cadence/Arc402 repositioned as the **open-source, permissionless, self-hostable seller-side reference** Tim Baker publicly called for, plus two AI-native primitives:

1. **Reputation-tiered pricing via ERC-8004** (LIVE in middleware) — pricing decisions read on-chain identity
2. **Refundable claims** (v0.3 design proposal in spec.md §12) — opt-in dispute window before service collects

Both primitives are structurally absent from Circle Nanopayments / Gateway and Coinbase x402.

### Known limitations at v0.1.0

- **No independent audit** — contract is `~250 LOC`, EIP-712 + checks-effects-interactions + reentrancy guards + custom errors. Mainnet deploy gated on M2 audit.
- **No mainnet deployment** — Arc mainnet has not launched as of release. Deployment script and checklist prepared.
- **Sub-millicent payments uneconomic** — current architecture profitable at ≥ $0.002/call. Sub-$0.002 requires next-gen settlement (state channels or Merkle-batched proofs, see spec.md §13).
- **No paying users yet** — pre-launch, finding pilot integrators is the W4 priority.
- **CI workflow not auto-running** — pending GitHub OAuth `workflow` scope refresh.

### Acknowledgments

Built on top of Circle's Arc, ERC-8004 standard, OpenZeppelin contracts, Foundry, viem, and the broader x402 / HTTP 402 design pattern community.

---

[0.1.0]: https://github.com/Ccheh/arc402/releases/tag/v0.1.0
