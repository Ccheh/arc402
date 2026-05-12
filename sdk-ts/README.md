# @arc402/sdk

TypeScript SDK for [Arc402](../README.md) — streaming USDC micropayments for AI agents on Arc.

## Install

```sh
npm install @arc402/sdk
```

## Server-side: charge per call in 3 lines

```ts
import express from "express";
import { requirePayment, parseUsdc, ARC_TESTNET } from "@arc402/sdk";

const app = express();
app.get(
  "/weather",
  requirePayment({
    amount: parseUsdc("0.01"),
    escrow: "0x55aFA5Cf28B98DD6DC550F15c075F46B5eaf2a98",
    service: "0xYourServiceAddress",
    chain: ARC_TESTNET,
  }),
  (req, res) => res.json({ temperature_c: 22 }),
);
app.listen(7402);
```

The middleware:
- Returns HTTP 402 if the request has no `x-arc402-claim` header, attaching the payment requirements.
- Verifies the claim's EIP-712 signature locally (no RPC roundtrip per call).
- Sets `req.arc402Claim` for downstream handlers.

## Agent-side: pay with one method

```ts
import { AgentClient, parseUsdc } from "@arc402/sdk";

const agent = new AgentClient({ privateKey: process.env.AGENT_PK as `0x${string}` });

// One-time: deposit USDC into the escrow so the agent has running balance.
await agent.deposit("0x55aFA5...", parseUsdc("5"));

// Per call: SDK auto-handles 402 → sign claim → retry. No 402 wrangling in your code.
const res = await agent.fetch("https://api.example/weather");
console.log(await res.json());
```

## Settlement

By default the agent never signs an on-chain tx per API call -- it only signs an off-chain EIP-712 claim. The service decides when to call `escrow.claim()` on-chain to actually pull the USDC:

```ts
import { settle, ARC_TESTNET } from "@arc402/sdk";

await settle(claim, {
  chain: ARC_TESTNET,
  escrow: "0x55aFA5...",
  servicePrivateKey: process.env.SERVICE_PK as `0x${string}`,
});
```

In production this is typically batched (one tx settles many claims) -- coming in W2.

## Try the end-to-end demo

```sh
npm run demo
```

This boots a tiny Express server, spins up an agent, deposits 0.5 USDC, makes a paid `/weather` call, and settles on-chain. All against live Arc Testnet. Requires `PRIVATE_KEY` and `ESCROW_ADDRESS` in the project-root `.env`.

## Where Arc402 fits

See [docs/spec.md](../docs/spec.md) for how Arc402 composes with Circle's ERC-8004 (agent identity), ERC-8183 (discrete jobs), `@circle-fin/app-kit`, and ZeroDev smart accounts. TL;DR: Arc402 is the **streaming** micropayment layer; the others cover identity, discrete jobs, cross-chain liquidity, and account abstraction respectively.
