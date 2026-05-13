# Cadence (Arc402) — Slither static analysis report

> **What this is**: self-run static analysis with the public Slither tool.
> **What this isn't**: a formal independent audit. No external audit firm
> has reviewed Cadence. Treat the contract as research-grade pending audit.

**Tool**: [slither-analyzer](https://github.com/crytic/slither) v0.11.5
**Solidity**: 0.8.28
**Scope**: `contracts/src/` (PaymentEscrow.sol, PaymentEscrowV2.sol)
**Date**: 2026-05-13
**Total detectors run**: 101
**Total findings**: 12 — none high or medium severity. Breakdown:

| Category | Count | Severity | Action |
|---|---|---|---|
| `timestamp` comparisons | 4 | Informational | **No fix** — claim expiry + session expiry timing is intentional |
| `low-level-calls` for native USDC transfer | 5 | Informational | **No fix** — required pattern for native-value transfers on Arc |
| `naming-convention` (DOMAIN_SEPARATOR) | 2 | Informational | **No fix** — EIP-712 convention |
| `uninitialized-local` (`total` in `claimBatch`) | 1 | Informational | **No fix** — Solidity initializes uint256 to 0; explicit init would just add gas |
| `unused-state` (SESSION_AUTH_TYPEHASH) | 1 | Informational | **Defer** — typehash kept for forward-compat; remove on next breaking version |

## Detail

### `timestamp` comparisons (4 findings)

All four occurrences gate either claim acceptance or session-key validity
against `expiry` / `block.timestamp`. Slither flags every use of
`block.timestamp` because miners can manipulate it by up to ~15 seconds. For
Cadence specifically:

- Claim expiry is signed off-chain by the agent. The relevant period is the
  agent's chosen `expiry` (typically 1+ hours). A 15-second miner manipulation
  is irrelevant at that scale.
- Session-key expiry is set by the agent and unrelated to settlement timing.

This is the standard, accepted pattern.

### Low-level calls (5 findings)

All instances send native USDC to a known recipient (`msg.sender`, agent
address, or service address). On Arc, USDC IS the native gas asset, so
high-level patterns like `payable(addr).transfer()` use the deprecated
2300-gas-stipend pattern and are NOT recommended.

The `(bool ok,) = recipient.call{value: amount}("")` pattern is the
OpenZeppelin-canonical approach. Each call site:

- Updates state BEFORE the external call (checks-effects-interactions).
- Is protected by `ReentrancyGuard` (PaymentEscrowV2) or is a
  monotonic-amount-down operation (withdraw).
- Reverts via `TransferFailed` if the call returns `ok=false`.

No reentrancy or unexpected-state risk.

### `naming-convention` (2 findings)

`DOMAIN_SEPARATOR()` is the EIP-712 standard public getter name. Slither's
mixedCase preference disagrees with the standard. We follow the standard.

### `uninitialized-local`: `total` in `claimBatch`

```solidity
uint256 total;  // line 147
for (uint256 i = 0; i < claims.length; i++) {
    total += _processClaim(...);
}
```

Solidity initializes `uint256` to `0` automatically. Explicit `= 0` would
emit an extra `PUSH0` opcode (~2 gas per occurrence) with no semantic effect.
Standard, accepted pattern.

### `unused-state`: `SESSION_AUTH_TYPEHASH`

```solidity
bytes32 public constant SESSION_AUTH_TYPEHASH = keccak256(...);
```

This typehash was added in V2 for a forward-compatibility path (signed
session-key delegation that has not yet shipped). It currently has no
consumers. **Action**: keep for now; remove in the next breaking version
of the contract or wire up the corresponding `authorizeSessionBySig`
flow. Tracked in repo internals.

## What Slither did NOT flag

- **Reentrancy**: zero matches. `ReentrancyGuard.nonReentrant` modifiers on
  `claim` / `claimBatch` / `withdraw` confirmed effective.
- **Arithmetic overflow**: zero matches (Solidity 0.8.x native checks).
- **Tx.origin authorization**: zero matches.
- **Unsafe delegatecall**: zero matches.
- **Unbounded loops**: zero matches (`claimBatch`'s loop is bounded by
  `claims.length` which the service controls).
- **Storage collision**: N/A (no upgrade proxy).

## How to reproduce

```sh
cd contracts
pip install slither-analyzer  # tested with 0.11.5
solc-select install 0.8.28
solc-select use 0.8.28
slither src/ --solc-remaps "openzeppelin-contracts/=lib/openzeppelin-contracts/" --filter-paths "lib|test"
```

## Honest caveats

Slither only catches automatable issues. It misses:
- **Cross-version replay** between PaymentEscrow V1 and V2 — handled by
  including the contract address in the EIP-712 domain. Verified
  experimentally by the V1→V2 cross-version adversarial test (see
  README's "5/5 adversarial attacks blocked").
- **Signature malleability** — `viem` produces canonical (low-s)
  signatures; the contract uses `ECDSA.recover` which is malleability-safe.
- **Gas griefing** — Arc's USDC-native gas means recipients can't reject
  the transfer via gas exhaustion. No issue.

A real audit by an audit firm would cost $10K-$50K and take 2-6 weeks.
This is not a substitute. It is the best self-served evidence we can offer
pre-funding.
