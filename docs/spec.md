# Arc402 Protocol Specification

> **Version**: 0.2 (2026-05-12)
> **Status**: Working spec — implementation matches; subject to audit revision
> **Implementer**: Cadence ([github.com/Ccheh/arc402](https://github.com/Ccheh/arc402))
> **Live deployment**: Arc Testnet, `0xc95b1b20f91901206ba3ea94bbc7313e7cd82f8d`

## 1. Overview

**Arc402** is an open protocol for streaming USDC micropayments between any payer (an "agent") and any service over HTTP. It defines:

- An on-chain escrow contract that holds payer balances
- An EIP-712 message schema for off-chain payment authorizations ("claims")
- An HTTP-header convention (modeled on HTTP 402 Payment Required) for service-payer negotiation
- A batched on-chain settlement mechanism that amortizes gas

**Cadence** is the reference implementation: contracts + TypeScript SDK + Python SDK + examples.

## 2. Design goals

| Goal | Mechanism |
|---|---|
| Sub-cent economics | Batched settlement: ~32k gas per claim at batch ≥ 10 |
| Zero per-call on-chain overhead | Off-chain EIP-712 claim signature, verified locally in middleware |
| No native-token gas burden on payers | Native USDC gas on Arc + `depositFor()` sponsorship pattern |
| Upgrade safety | EIP-712 domain version isolates signatures across protocol versions |
| Standard HTTP integration | HTTP 402 response + `x-arc402-required` / `x-arc402-claim` headers |
| Cross-language tooling | Identical wire format between TypeScript and Python SDKs |

## 3. Network parameters

Reference deployment (Arc Testnet):

| Param | Value |
|---|---|
| Chain ID | 5042002 |
| RPC | https://rpc.testnet.arc.network (primary), https://rpc.blockdaemon.testnet.arc.network (fallback) |
| Block explorer | https://testnet.arcscan.app |
| USDC contract | `0x3600000000000000000000000000000000000000` |
| USDC decimals on Arc | **18** (not 6 as on mainnet; USDC is native gas) |
| PaymentEscrow V2 | `0xc95b1b20f91901206ba3ea94bbc7313e7cd82f8d` |
| PaymentEscrow V1 (legacy) | `0x55aFA5Cf28B98DD6DC550F15c075F46B5eaf2a98` |
| ERC-8004 IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` (used for optional identity lookup) |

## 4. Roles

- **Agent**: a wallet (EOA or smart account) that wishes to pay for services. Holds USDC; deposits a balance into the escrow; signs claims.
- **Service**: a wallet that operates an API endpoint. Receives signed claims; verifies them locally; submits them on-chain in batch to receive payment.
- **Sponsor** (optional): a third party that pre-funds an agent's escrow on its behalf via `depositFor`. Enables zero-gas onboarding for the agent.
- **Session key** (optional): a key delegated by the agent (via `authorizeSession`) to sign claims on its behalf. Bounded by expiry.

## 5. On-chain primitives

### 5.1 PaymentEscrowV2 functions

```solidity
// Escrow management
function deposit() external payable;
function depositFor(address agent) external payable;
function withdraw(uint256 amount) external;
function balanceOf(address agent) external view returns (uint256);

// Session keys
function authorizeSession(address sessionKey, uint64 expiry) external;
function revokeSession(address sessionKey) external;
function sessionValid(address agent, address sessionKey) external view returns (bool);

// Settlement
function claim(
    address agent,
    uint256 amount,
    uint256 nonce,
    uint256 expiry,
    bytes calldata signature
) external;

struct Claim {
    address agent;
    uint256 amount;
    uint256 nonce;
    uint256 expiry;
    bytes signature;
}
function claimBatch(Claim[] calldata claims) external;

// Replay query
function isNonceUsed(address agent, address service, uint256 nonce) external view returns (bool);
```

### 5.2 Custom errors

| Selector | Name | When raised |
|---|---|---|
| `0x1fb09b80` | `NonceAlreadyUsed` | Claim's (agent, service, nonce) tuple already settled |
| `0x82a49d9e` | `ClaimExpired` | `block.timestamp > expiry` |
| `0x8baa579f` | `InvalidSignature` | Recovered signer is neither agent nor an authorized session key |
| `0x3feb5d70` | `SessionExpiredOrUnknown` | Session signer found but expired or revoked |
| `0xf4d678b8` | `InsufficientBalance` | `balanceOf[agent] < amount` |
| `0x7c946ed7` | `ZeroAmount` | `amount == 0` (deposit or claim) |
| `0xd571a96e` | `EmptyBatch` | `claimBatch(claims)` called with `claims.length == 0` |
| `0x90b8ec18` | `TransferFailed` | Native USDC transfer to recipient reverted |

## 6. EIP-712 claim signature

### 6.1 Domain

```
EIP712Domain(
    string name,
    string version,
    uint256 chainId,
    address verifyingContract
)
```

Reference values:
- `name = "Arc402"`
- `version = "2"` (V2 contract); `"1"` was V1
- `chainId = 5042002` (Arc Testnet)
- `verifyingContract = 0xc95b1b20f91901206ba3ea94bbc7313e7cd82f8d` (V2 reference deployment)

**Domain isolation guarantees a signature for one (contract, version) cannot replay against another.** This is the upgrade-safety mechanism.

### 6.2 Claim type

```
Claim(
    address agent,
    address service,
    uint256 amount,
    uint256 nonce,
    uint256 expiry
)
```

Field semantics:

- `agent`: the address whose escrow balance will be debited. Must match the recovered signer OR be the delegator of an authorized session key.
- `service`: the address that will be credited. Must match `msg.sender` at settlement.
- `amount`: USDC to transfer, in 18-decimal wei. Must be > 0.
- `nonce`: a uint256 chosen by the signer. Must be unique per (agent, service) pair, or the claim reverts as `NonceAlreadyUsed`. Random 128-bit values recommended.
- `expiry`: unix timestamp after which the claim is invalid.

### 6.3 Signing algorithm

Signers use standard EIP-712 `signTypedData_v4`:

1. Compute `domain_separator = keccak256(abi.encode(EIP712Domain_typehash, name_hash, version_hash, chainId, verifyingContract))`
2. Compute `struct_hash = keccak256(abi.encode(Claim_typehash, agent, service, amount, nonce, expiry))`
3. Compute `digest = keccak256(0x1901 ++ domain_separator ++ struct_hash)`
4. Sign with secp256k1: `(r, s, v) = ECDSA.sign(digest, private_key)`
5. Concatenate: `signature = r ++ s ++ v` (65 bytes)

The reference implementations (`@arc402/sdk` via `viem`, `cadence-sdk` via `eth-account`) produce identical signatures for identical inputs.

## 7. HTTP wire protocol

The protocol layers on top of standard HTTP request/response semantics.

### 7.1 Initial request (no claim)

The agent calls the service endpoint as normal:

```http
POST /v1/chat/completions HTTP/1.1
Host: api.example.com
Content-Type: application/json

{ "model": "gpt-4o-mini", "messages": [...] }
```

### 7.2 402 response

If the service requires payment and no valid claim is attached, it responds:

```http
HTTP/1.1 402 Payment Required
Content-Type: application/json
x-arc402-required: <base64(JSON)>

{
  "error": "payment_required",
  "requirements": {
    "scheme": "arc402",
    "chainId": 5042002,
    "escrow": "0xc95b1b20...82f8d",
    "service": "0x...",
    "amount": "5000000000000000"
  }
}
```

The `requirements` body and the `x-arc402-required` header carry equivalent information; agents may consume either.

### 7.3 Retried request (with claim)

The agent signs a `Claim` covering `amount`, encodes it, and retries with the `x-arc402-claim` header:

```http
POST /v1/chat/completions HTTP/1.1
Host: api.example.com
Content-Type: application/json
x-arc402-claim: <base64(JSON)>

{ "model": "gpt-4o-mini", "messages": [...] }
```

### 7.4 Wire format of `x-arc402-claim`

The header value is `base64(JSON({...}))` where the JSON has fields:

```json
{
  "agent":     "0x...",
  "service":   "0x...",
  "amount":    "5000000000000000",
  "nonce":     "123456789012345",
  "expiry":    "1778565700",
  "signature": "0x..."
}
```

All `uint256` fields are string-encoded to avoid JS number precision loss.

### 7.5 Successful response

The service verifies the claim (signature, amount ≥ required, service matches, expiry > now, nonce not yet used). If valid, it proceeds with normal endpoint logic and may include settlement metadata in its response body:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  ...,
  "cadence": {
    "paid_by": "0x...",
    "paid_amount_usdc": "0.005",
    "settlement": "queued (batched)",
    "protocol": "Arc402 v2"
  }
}
```

## 8. Settlement protocol

Services accumulate verified claims in an in-memory queue and settle in batches.

### 8.1 Batching policy (implementation guidance)

- **Flush on count**: when queue size ≥ N (10 recommended)
- **Flush on time**: when oldest claim has been queued > T seconds (60 recommended)
- **Flush on shutdown**: drain on service stop / graceful restart

### 8.2 Atomicity

`claimBatch` is atomic: either all N claims settle or the transaction reverts and no state changes. Services that prefer partial-success must pre-filter claims off-chain before submission.

Recommended pre-flight checks per claim before queueing:
1. Verify signature (always — cheap, prevents bad-faith spam)
2. Optionally read `isNonceUsed(agent, service, nonce)` (one RPC; catches replays from out-of-order claim arrival)
3. Optionally read `balanceOf(agent)` (one RPC; catches insolvent claims before submission)

### 8.3 Gas profile

Measured on Arc Testnet (Foundry test + live runs at 20-gwei effective price):

| Batch size | Total gas | Per-claim gas | Per-claim cost |
|---|---|---|---|
| 1 | ~69,000 | 69,000 | $0.00138 |
| 10 | ~330,000 | 33,000 | $0.00066 |
| 50 | ~1,600,000 | 32,000 | $0.00064 |
| 100 | ~3,200,000 | 32,000 | $0.00064 |

**Practical floor**: ~32k gas per claim (signature verification + 2 storage writes). Beyond batch=10 the marginal benefit is negligible; the optimal automatic flush trigger is `count=10`.

## 9. Session keys (optional)

The agent may authorize a delegated key to sign claims on its behalf:

```solidity
escrow.authorizeSession(sessionKey, expiry);
```

Once authorized, a claim signed by `sessionKey` is accepted at settlement as if signed by the agent, provided:
- `block.timestamp <= sessionExpiry[sessionKey]`
- `sessionOf[sessionKey] == agent`
- All other claim invariants pass

Revocation: `escrow.revokeSession(sessionKey)` clears both `sessionOf` and `sessionExpiry`, immediately invalidating any subsequent claims from that key.

**Use cases**:
- Agent's cold key delegates to a hot key for short-lived high-frequency operations
- Multi-agent workflows where a coordinator signs on behalf of sub-agents within a bounded window
- ERC-4337-style smart-account hot/cold key separation without needing the full AA stack

## 10. Versioning policy

Protocol upgrades take the form of new contract deployments with bumped `version` strings.

- V1 → V2 used `version="1"` → `version="2"`. Signatures do NOT cross-replay (verified on chain).
- V2 → V3 will follow the same pattern.

Migration: balances do NOT auto-migrate. Agents withdraw from V_n via `withdraw()` then deposit into V_{n+1}. Services update their middleware's `escrow` config and EIP-712 domain version.

This policy avoids the security surface of an upgradeability proxy while accepting an operational chore at migration time.

## 11. Reputation-tiered pricing (Cadence extension)

A primitive that distinguishes Cadence from Circle Nanopayments / Coinbase x402 / Gateway: **the seller can offer a reduced price to agents whose on-chain identity meets a threshold**, with identity discovery happening inline in the middleware.

### 11.1 Service-side declaration

A Cadence-protected endpoint may advertise *two* amounts in its 402 response:

```json
{
  "scheme": "arc402",
  "chainId": 5042002,
  "escrow": "0x...",
  "service": "0x...",
  "amount": "5000000000000000",          // base tier: 0.005 USDC
  "reputationAmount": "1000000000000000", // discounted tier: 0.001 USDC
  "reputation": {
    "identityRegistry": "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    "minTokens": 1,
    "chainId": 5042002
  }
}
```

### 11.2 Agent-side decision

The Cadence agent SDK reads the requirements, calls `IdentityRegistry.balanceOf(agent)` inline, and signs a claim for `reputationAmount` if `tokenCount >= reputation.minTokens`; otherwise for `amount`.

### 11.3 Service-side verification

When the seller's middleware receives the claim, it checks `claim.amount`:
- If `claim.amount >= amount`, accept (base tier).
- Else if `claim.amount >= reputationAmount`, re-verify the agent's identity inline; if qualified, accept (discount tier); else 402.

This makes reputation a **payment primitive**, not just an off-chain label.

### 11.4 Why this matters

- **Compatible** with the rest of Arc402 — same EIP-712 claim signature, same settlement path
- **Composes** with Circle's published ERC-8004 standard rather than inventing a new registry
- **Not in Circle Nanopayments / Gateway** — those settle based on USDC balance only and have no native identity-awareness
- **Enables a class of features** Circle's hosted stack structurally cannot: per-identity rate limits, KYC-gated pricing, reputation-as-collateral patterns

## 12. v0.3 design proposal: refundable claims (SLA-aware payments)

> Not yet in V2 contract. Documented here as a design proposal for v0.3 / W4 work.

### 12.1 Problem

Today, once an agent signs a claim and the service settles, the agent has no on-chain recourse if the service delivered garbage. AI outputs in particular are uneven; an agent paying 0.005 USDC for a useless LLM response has no native way to claw it back.

This is **not** addressed by:
- Circle Nanopayments (pure-payment layer, no quality awareness)
- x402 (same)
- Lightning (HTLCs are simple locks, no AI-output semantics)
- ERC-8183 (evaluator-arbitrated, but too heavy for per-call streaming)

### 12.2 Proposed mechanism: opt-in refund window

```solidity
struct RefundableClaim {
    address agent;
    uint256 amount;
    uint256 nonce;
    uint256 expiry;
    uint64  refundWindow; // seconds after settle within which agent can dispute
    bytes32 serviceCommitment; // hash of (e.g.) the agent's intended use, or the service's quality pledge
    bytes signature;
}

function claimWithRefundWindow(RefundableClaim calldata c) external;
function disputeAndRefund(uint256 nonce, bytes32 disputeAttestation) external;
function collectAfterWindow(uint256 nonce) external;
```

Flow:
1. Service calls `claimWithRefundWindow`. USDC is debited from agent's escrow but **escrowed inside the contract** for `refundWindow` seconds, not transferred to the service yet.
2. During the window:
   - Agent can call `disputeAndRefund(nonce, attestation)`. Funds return to the agent.
   - The dispute attestation hash is stored on chain — for accountability / off-chain arbitration.
3. After the window expires, service calls `collectAfterWindow(nonce)` to receive the funds.

### 12.3 Incentive analysis

- **Honest service + honest agent**: window expires without dispute; service collects. Same outcome as V2 with a delay.
- **Bad service + honest agent**: agent disputes; agent recovers funds. Service can be blacklisted off-chain.
- **Honest service + dishonest agent (dispute spam)**: service stops serving them. Dispute frequency becomes a reputation signal (writable to ERC-8004 ReputationRegistry — future work).
- **No mutual cooperation**: cancels out the same way HTLCs cancel out on Lightning — no party gets the funds.

### 12.4 Open questions

- Service deposit / slashing for repeated dispute losses?
- Standardised dispute attestation format?
- Integration with ERC-8004 ReputationRegistry (write-side, not just read)?
- Refund-window batching: can `claimBatchWithRefund` exist, and how does it accounting?

This section is a **design proposal**, not implementation. The author commits to drafting an EIP-style proposal alongside the formal v0.3 spec once V2 audit is complete.

## 13. Multi-asset, cross-chain, and other open questions

Deliberately not specified yet (slated for v0.4+):

- **Multi-asset support**: EURC and other Arc-native stablecoins
- **Sub-millicent settlement**: state channels or Merkle-batched proofs for service prices below $0.002/call
- **Cross-chain settlement**: an agent on chain A pays a service on chain B via CCTP-bridged claims
- **ERC-8004 write-side integration**: writing reputation events on disputes (see §12)
- **EIP-3009 interop layer**: translator so the same payload can be presented to Circle Gateway and Arc402

Contributions welcome via the [GitHub repo](https://github.com/Ccheh/arc402).
