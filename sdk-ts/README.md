# @arc402/sdk-ts

TypeScript SDK for Arc402. Scaffolding lands in W1.

## Planned exports

- `requirePayment(amount, options)` -- Express/Hono middleware that enforces per-call USDC payment
- `AgentClient` -- agent-side client for authorizing and paying
- `verifyClaim(claim)` -- offline signature verification helper
