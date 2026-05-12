# Arc402 Protocol Specification (Draft)

Status: pre-alpha, to be expanded in W3.

## Overview

Arc402 defines an on-chain mechanism for API services to charge per-call payments in USDC on Arc, and for AI agents to pay them via smart-account-delegated authorization.

## Why Arc

- USDC is native gas -- agents and end users do not need to acquire any other token to transact
- USDC gas is low and predictable, making sub-cent per-call payments economically viable
- Circle as issuer enables fiat ramps, multi-stablecoin settlement (USDC/EURC), and TradFi integration paths

## Arc402 in the Circle stack

Arc402 is **the streaming micropayment layer** in Circle's agentic-economy stack. It does not compete with the primitives Circle already ships; it fills the gap below them.

| Layer | Standard / Tool | Role | Arc402's relationship |
|---|---|---|---|
| **Identity** | ERC-8004 | Agent identity + reputation registry | Arc402 **reads** ERC-8004 identities to display trust signals next to payers |
| **Discrete jobs** | ERC-8183 | Job escrow with explicit fund/submit/complete txs and an evaluator role | Arc402 covers the **opposite** profile -- continuous, low-friction per-call billing where on-chain settlement per call is uneconomic |
| **Cross-chain liquidity** | `@circle-fin/app-kit` | Bridge / Swap / Send / Unified Balance across chains | Arc402 ships as an **App Kit adapter** so existing App Kit users can add per-call billing with one import |
| **Smart accounts** | ZeroDev / Pimlico (ERC-4337) | Smart wallets, session keys, paymasters | Arc402 **uses** ZeroDev smart accounts so agents can pre-authorize spending limits to services |
| **Streaming micropayments** | *(gap)* | Sub-cent per-API-call settlement | **Arc402 fills this gap** |

### How the layers fit together (typical AI agent flow)

1. Agent has an **ERC-8004 identity** with reputation history
2. Agent's wallet is a **ZeroDev smart account** with a session key authorizing "up to 5 USDC/day to *.weather-api.example"
3. Agent calls a paid API on Arc402; the SDK signs an EIP-712 claim with the session key
4. Service collects claims off-chain, settles in batch via PaymentEscrow when it makes economic sense
5. For larger discrete contracts, the agent escalates to **ERC-8183 job escrow** (different protocol, same wallet)

## Open questions

- Optimistic vs. on-chain settlement per call
- Dispute resolution mechanism
- Batched settlement: 1 tx per (agent, service) pair per day vs. per claim
- Integration depth with ERC-8004 (read-only vs. write back reputation events on disputes)
- App Kit adapter API surface

(Full spec drafting begins W3.)

## Network parameters (Arc Testnet)

| Param | Value |
|---|---|
| Chain ID | 5042002 |
| RPC | https://rpc.testnet.arc.network |
| Explorer | https://testnet.arcscan.app |
| Faucet | https://faucet.circle.com |
| USDC contract | 0x3600000000000000000000000000000000000000 |
| **USDC decimals on Arc** | **18** (not 6 as on mainnet) -- because USDC is native gas, it follows EVM 18-decimal convention. SDKs must treat Arc-USDC as 18-decimal. |
| Permit2 | 0x000000000022D473030F116dDEE9F6B43aC78BA3 (canonical address, available on Arc) |
| Multicall3 | 0xcA11bde05977b3631167028862bE2a173976CA11 |
| EURC | 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a |

## Design goals

1. Sub-cent per-call payment economically feasible
2. Zero native-token onboarding (USDC is gas)
3. Standard middleware interface, modeled on HTTP 402
4. Smart-account-native: no per-call user signature required after one-time authorization
5. Settlement transparent and auditable

## Core components

1. **Payment escrow contract** -- holds prepaid USDC, releases on signed claim from the service
2. **Agent wallet factory** -- deploys smart accounts with configurable spending limits and allowlists
3. **Server SDK** (Node, Python) -- middleware that wraps any HTTP handler with `requirePayment(amount)`
4. **Client SDK** -- agent-side library for authorizing top-ups and signing claim approvals
5. **Settlement layer** -- batched on-chain claim execution to amortize gas

