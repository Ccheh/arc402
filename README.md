# Arc402

AI-agent micropayment protocol + SDK on Arc.

## What this is

A developer-grade SDK that lets any API charge per-call in USDC, and any AI agent pay seamlessly via smart accounts -- all on Arc, where USDC is native gas. Sub-cent payments become feasible; agents don't need to manage native tokens; integration is three lines of middleware.

## Status

Pre-alpha. Actively building toward W1 milestones (escrow contract + Node SDK MVP on Arc Testnet).

## Repository layout

| Folder | Purpose |
|---|---|
| `contracts/` | Solidity contracts (Foundry) -- payment escrow, agent wallet factory |
| `sdk-ts/` | TypeScript SDK for Node -- server middleware + client agent SDK |
| `sdk-py/` | Python SDK (W3) |
| `web/` | Demo marketplace + docs site (Next.js) |
| `docs/` | Protocol spec, design notes |

## License

TBD
