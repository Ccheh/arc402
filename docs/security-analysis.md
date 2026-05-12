# Security analysis: Cadence (Arc402 protocol) PaymentEscrowV2

> **Audience**: prospective auditors, technically-minded users, Grant reviewers.
>
> **Status**: pre-audit. This document is the system's threat model + the implementer's own analysis of mitigations and known risks. It is **not** a substitute for an independent audit before mainnet deployment; M2 of the [Grant proposal](grant-application-draft.md) explicitly funds that audit.

## Scope

This document covers:

- `contracts/src/PaymentEscrowV2.sol` (~250 LOC of Solidity 0.8.28)
- The off-chain claim-signing protocol (EIP-712 domain `"Arc402"`, version `"2"`)
- The `@arc402/sdk` TypeScript SDK signature flow
- The `cadence-sdk` Python SDK signature flow

Out of scope:

- ZeroDev / Pimlico ERC-4337 paymaster security (third-party)
- ERC-8004 registry security (Circle-owned)
- Arc chain consensus security (Circle-owned)
- Client-side wallet security (per user)

## Assets at risk

1. **Agents' escrowed USDC** — the primary asset. Held in `PaymentEscrowV2`, accounted by `balanceOf[agent]`.
2. **Service revenue** — USDC claimed by services. After settlement, this is in the service's EOA / smart-account address, no longer this contract's concern.
3. **Identity integrity** — agents' addresses cannot be spoofed; claims cannot be forged.

## Threat model

We model three adversary classes:

### A1: Malicious service
**Capability**: controls a service endpoint; receives signed claims from honest agents.
**Goals**:
- Charge more than authorized
- Replay claims to drain agents' escrow
- Frame an agent (submit a fabricated claim showing the agent paid)

### A2: Malicious agent
**Capability**: controls an agent wallet with escrow balance; signs claims to services.
**Goals**:
- Get service value without paying (e.g., post-claim withdrawal)
- Repudiate a legitimate claim
- DoS the contract (block other agents' settlements)

### A3: Malicious third party
**Capability**: observes the chain and the mempool; may run a relayer / MEV searcher.
**Goals**:
- Front-run settlements for griefing / extraction
- Replay valid claims across services or contract versions
- Steal claims in transit

## Attack vectors and mitigations

### V1: Replay attack (A1)
**Vector**: Service submits the same `Claim` twice via `claim()` or `claimBatch()`.
**Mitigation**: `usedNonces[keccak256(agent, service, nonce)]` set on first acceptance; second submission reverts with `NonceAlreadyUsed`.
**Verified**: live on Arc Testnet via `adversarial.ts` (test 1). Selector `0x1fb09b80` returned.

### V2: Expired claim (A1)
**Vector**: Service holds a signed claim past its `expiry` and submits later when the agent has forgotten.
**Mitigation**: `if (block.timestamp > expiry) revert ClaimExpired()` at the top of `_processClaim`.
**Verified**: live on Arc Testnet. Selector `0x82a49d9e` returned.

### V3: Wrong-service replay (A3)
**Vector**: Service A intercepts a claim signed for service B and submits it themselves to drain the agent.
**Mitigation**: The signed message binds `service = msg.sender`. The EIP-712 hash includes service. A claim signed for B does not recover to the agent when verified against A.
**Verified**: live on Arc Testnet. Selector `0x8baa579f` (`InvalidSignature`) returned.

### V4: Forged signature (A1, A3)
**Vector**: An attacker signs a claim with a different key and submits it claiming to be from the agent.
**Mitigation**: `ECDSA.recover(_hashTypedDataV4(structHash), signature) != agent` reverts. We use OpenZeppelin's audited ECDSA library, which handles signature malleability (rejects s > secp256k1n/2).
**Verified**: live on Arc Testnet. `InvalidSignature` returned.

### V5: Cross-version replay (A3)
**Vector**: A claim signed for V1 (`version="1"`) is replayed against V2 (`version="2"`).
**Mitigation**: EIP-712 domain separator depends on `version`. Different versions produce different digests; signatures don't recover to the agent across versions.
**Verified**: live on Arc Testnet. `InvalidSignature` returned. **This is critical for protocol upgrade safety.**

### V6: Reentrancy on withdraw / claim (A2, A1)
**Vector**: A malicious actor's `receive()`/`fallback()` re-enters `withdraw()` or `claim()` during the value transfer at the end.
**Mitigation**: `nonReentrant` modifier on `withdraw`, `claim`, `claimBatch`. Critically, state mutations (`balanceOf -= amount`, `usedNonces[k] = true`) happen **before** the external call to `msg.sender.call{value: total}("")`. This is the checks-effects-interactions pattern; reentrancy from a malicious recipient cannot re-spend already-debited balance.

### V7: Insufficient-balance dust (A2)
**Vector**: Agent signs a claim for more than they have in escrow; service eagerly settles and reverts after burning gas.
**Mitigation**: `if (balanceOf[agent] < amount) revert InsufficientBalance()`. Service can read `balanceOf` off-chain before submitting; SDK should expose this. The revert is cheap (no state changes before it).

### V8: Zero-amount griefing (A2)
**Vector**: Agent signs many 0-USDC claims to fill `usedNonces` storage with worthless entries.
**Mitigation**: `if (amount == 0) revert ZeroAmount()` rejects them at the entrypoint. Storage write avoided.

### V9: Empty batch griefing (A1, A3)
**Vector**: Anyone calls `claimBatch([])` to consume gas without payload.
**Mitigation**: `if (len == 0) revert EmptyBatch()` at the start.

### V10: Session-key abuse (A2 / unauthorized signer)
**Vector**: An expired or unauthorized session key signs a claim and the contract accepts it as if from the agent.
**Mitigation**: `_processClaim` checks `sessionOf[recovered] == agent` AND `sessionExpiry[key] > block.timestamp`. Expired sessions revert with `SessionExpiredOrUnknown`.

### V11: Front-run settlement (A3)
**Vector**: An MEV searcher observes a service's `claimBatch` tx and front-runs it for some advantage.
**Analysis**: The settlement is purely a state read + state write + transfer to `msg.sender`. There is no profit available to a front-runner -- they cannot redirect funds (transfer goes to `msg.sender`, which is the service). Front-running would only waste the searcher's gas.

### V12: Batch atomicity (A1)
**Vector**: Service submits 100 claims; one is malformed; entire batch reverts wasting gas.
**Analysis**: This is the **intended behavior**. Atomic batches let services trust that either all claims settle or none do. Services that prefer partial-success can pre-filter claims off-chain before submission (the SDK does this implicitly by verifying signatures locally before queuing).

### V13: depositFor sponsorship griefing (A3)
**Vector**: An attacker spams `depositFor(victim_agent)` with tiny amounts to inflate logs / monitoring noise.
**Analysis**: Not an attack on funds (victim's balance increases). At worst it's spam-event noise; victim can always withdraw to themselves. Acceptable.

### V14: First-deposit DoS (A2 self-DoS, or A3)
**Vector**: An agent deposits, then via some flow causes their own `balanceOf` underflow / state corruption.
**Analysis**: All balance arithmetic is checked-subtraction (`if (bal < amount) revert`). Solidity 0.8.x has built-in overflow checks. The `unchecked` blocks (e.g., `balanceOf[agent] = bal - amount`) are inside their own `if (bal < amount)` guards, so the `unchecked` is safe.

## Known limitations and explicit non-goals

1. **No on-chain dispute mechanism.** If a service collects a claim but doesn't deliver the promised value off-chain, the agent has no on-chain recourse. This is intentional for V2 -- dispute resolution is L2-of-the-protocol work (think: optimistic settlement window + slash). Out of scope for the initial Grant milestones.

2. **No privacy.** Every claim, once settled, is observable on chain (agent address, service address, amount). Streaming patterns reveal usage. For privacy, would need either ZK proofs or off-chain settlement -- both are post-V2 work.

3. **No upgradeability proxy.** `PaymentEscrowV2` is a fresh deployment with no admin keys. To upgrade, we deploy V3 with `version="3"` in the EIP-712 domain; V2 sigs cannot replay on V3 (as verified for V1->V2). Funds in V2 remain accessible via `withdraw()`. **This avoids upgrade-related attack surface but creates an operational chore at migration time.**

4. **No fee mechanism.** The contract takes no fee. The team is exploring optional protocol-fee parameters for future versions (not before audit, not in Grant scope).

5. **Sub-millicent economics still negative.** As analyzed in the README's economics table, below $0.002/call the gas cost exceeds revenue even with batching. The protocol works correctly at any amount; it's just unprofitable for the service below that threshold. State-channel / Merkle settlement is the post-Grant solution.

## Open audit checklist (for the M2 auditor)

A focused review of this surface should cover:

- [ ] Signature recovery is consistent with `viem`'s and `eth-account`'s typed-data implementations across the entire EIP-712 domain (we verified for V2 specifically; the cross-language SDK signing must match the contract's recovery)
- [ ] `nonReentrant` does not unintentionally block legitimate composability (a service that wraps `claimBatch` in its own logic should still work)
- [ ] Calldata size limits on `claimBatch(Claim[])` -- testnet RPC rejected batches >50 in our experiments; verify mainnet block-gas-limit ceiling
- [ ] Session-key revocation race conditions (revoke + settle in same block)
- [ ] Gas griefing via long-running custom errors (we use empty `revert MyError()` everywhere; no unbounded fields)
- [ ] Solidity 0.8.28 specific concerns (`unchecked` block correctness, transient storage if used)
- [ ] OpenZeppelin version pinning + transitive deps
- [ ] Test invariant: total `balanceOf` across all agents = contract's native USDC balance, after all settles processed (no funds "stuck" or "duplicated")

## Proposed audit scope and budget

- **Audit firm**: Independent boutique (Spearbit / Pashov / Cyfrin) or freelance senior auditor with EIP-712 and Solidity 0.8.x experience
- **Scope**: ~250 LOC of Solidity + protocol design review
- **Estimated effort**: 1-2 auditor-weeks
- **Budget**: $10,000 USDC (Grant M2 allocation)
- **Deliverables**: written report (medium-detail), all Critical/High findings remediated before mainnet deploy
- **Disclosure window**: 14 days post-report; full disclosure thereafter

## Disclosures already made

Self-disclosed limits and risks are listed throughout this document. No security incidents to date. No known exploits in testnet usage. The contract has not been mainnet-deployed.

For responsible disclosure of any issue found in this contract, please open a private security advisory on the GitHub repo (`Security` tab → `Report a vulnerability`). Do not disclose publicly until coordinated.

---

**Last reviewed**: 2026-05-12 (initial draft)
**Next review**: post-audit
