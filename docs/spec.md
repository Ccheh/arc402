# Arc402 Protocol Specification (Draft)

Status: pre-alpha, to be expanded in W3.

## Overview

Arc402 defines an on-chain mechanism for API services to charge per-call payments in USDC on Arc, and for AI agents to pay them via smart-account-delegated authorization.

## Why Arc

- USDC is native gas -- agents and end users do not need to acquire any other token to transact
- USDC gas is low and predictable, making sub-cent per-call payments economically viable
- Circle as issuer enables fiat ramps, multi-stablecoin settlement (USDC/EURC), and TradFi integration paths

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

## Open questions

- Optimistic vs. on-chain settlement per call
- Dispute resolution mechanism
- Pricing-discovery interface (fixed price vs. metered)

(Full spec drafting begins W3.)
