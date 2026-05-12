# Arc402

> **Streaming USDC micropayments for AI agents on Arc.**
>
> The missing layer below Circle's [ERC-8183](https://docs.arc.network/arc/tutorials/create-your-first-erc-8183-job) jobs and [ERC-8004](https://docs.arc.network/arc/tutorials/register-your-first-ai-agent) identity stack — Arc402 lets any API charge USDC per call, with zero on-chain overhead per request.

## Status: live on Arc Testnet

| | |
|---|---|
| **PaymentEscrow contract** | [`0x55aFA5Cf28B98DD6DC550F15c075F46B5eaf2a98`](https://testnet.arcscan.app/address/0x55aFA5Cf28B98DD6DC550F15c075F46B5eaf2a98) |
| **Chain** | Arc Testnet (chainId `5042002`) |
| **Tests** | 16/16 passing, 512 fuzz runs |
| **End-to-end demo** | ✅ deposit → 402 → signed claim → settle, verified on-chain |
| **SDK** | `@arc402/sdk` v0.0.1 (TypeScript) |

## Why this exists

Circle's Arc makes USDC the native gas token, so per-call payments cost sub-cent in fees. But the existing primitives don't fit per-API-call billing:

- **ERC-8183 (job escrow)** is multi-tx and evaluator-gated — overkill for "charge $0.001 per LLM call"
- **`@circle-fin/app-kit`** covers bridging/swapping/sending, not per-call billing
- **Cross-chain payment standards** assume on-chain settlement per tx, which is uneconomic at sub-cent prices

**Arc402 fills the gap**: agents pre-deposit USDC once, then sign cheap off-chain EIP-712 claims per API call. Services collect and settle in batch when economic.

## How it composes with Circle's stack

```
┌──────────────────────────────────────────────────────────────┐
│ Layer            │ Tool                  │ Arc402 role        │
├──────────────────────────────────────────────────────────────┤
│ Identity         │ ERC-8004              │ Read (trust signal)│
│ Discrete jobs    │ ERC-8183              │ Complementary      │
│ Cross-chain liq. │ @circle-fin/app-kit   │ Build as adapter   │
│ Smart accounts   │ ZeroDev (ERC-4337)    │ Build on top of    │
│ ▸ Streaming pay  │ (gap)                 │ ★ Arc402 fills it  │
└──────────────────────────────────────────────────────────────┘
```

See [docs/spec.md](docs/spec.md) for the detailed mapping.

## Try the demo in 30 seconds

```sh
git clone https://github.com/Ccheh/arc402.git
cd arc402
git submodule update --init --recursive

# contracts: run the unit + fuzz tests
cd contracts && forge test -vv && cd ..

# SDK: end-to-end demo on Arc Testnet
# (requires PRIVATE_KEY and ESCROW_ADDRESS in .env -- see .env.example)
cd sdk-ts && npm install && npm run demo
```

The demo boots an Express server with `/weather` priced at 0.01 USDC, then drives an agent through the full lifecycle: deposit → 402 → claim → settle. Every step is a real on-chain tx visible on [testnet.arcscan.app](https://testnet.arcscan.app).

## Repository layout

| Folder | What |
|---|---|
| [`contracts/`](contracts/) | Solidity contracts (Foundry) — `PaymentEscrow.sol` and tests |
| [`sdk-ts/`](sdk-ts/) | TypeScript SDK — `requirePayment` middleware + `AgentClient` |
| [`sdk-py/`](sdk-py/) | Python SDK (W3) |
| [`web/`](web/) | Next.js demo marketplace (W4) |
| [`docs/`](docs/) | Protocol spec, Circle-stack positioning |

## Roadmap

- **W1** ✅ Escrow contract + Node SDK + end-to-end Arc Testnet demo
- **W2** Smart-account agent wallet (ZeroDev session keys) + batched settlement
- **W3** Python SDK + formal Arc402 protocol spec
- **W4** Next.js demo marketplace + Circle Developer Grant submission

## License

MIT
