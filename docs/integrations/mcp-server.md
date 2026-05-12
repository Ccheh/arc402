# MCP server + Cadence: pay-per-tool-call USDC for AI agents

> Wrap any [Model Context Protocol](https://modelcontextprotocol.io/) server in Cadence payments so that AI clients (Claude Desktop, ChatGPT desktop, Cursor, Continue, etc.) pay USDC per tool call. Self-hosted, no API keys, no account creation.

## Why MCP × Cadence is a natural fit

MCP defines how AI clients call external tools. Today, every MCP server author has the same problem:

- **If I expose tools publicly, how do I prevent abuse?**
- **If I gate behind API keys, every user must create an account.**
- **If I charge subscriptions, casual users abandon and high-volume users feel ripped off.**

Cadence solves this with **per-tool-call USDC billing**:

- Server lists tools as usual via MCP
- Each tool's handler is wrapped with `requirePayment(amount)`
- Calling client (the AI agent / desktop app) holds an escrow balance
- The agent's MCP client signs a Cadence claim per tool call
- Server settles claims in batch when economic

No accounts. No API keys. Per-call accountability.

## Architecture

```
┌─────────────────┐   MCP Protocol     ┌─────────────────────────┐
│ AI Client       │ <──tools/list────  │ MCP Server              │
│ (Claude Desktop,│                    │ (your tool host)        │
│ ChatGPT, etc.)  │ ──tools/call────>  │ ┌─────────────────────┐ │
│                 │     + Cadence      │ │ Cadence middleware  │ │
│ ┌─────────────┐ │     claim header   │ │ - verify EIP-712    │ │
│ │ Cadence     │ │ <──result + 402──  │ │ - queue claim       │ │
│ │ AgentClient │ │   (first call)     │ │ - flush in batch    │ │
│ │ - signs     │ │                    │ └─────────────────────┘ │
│ │   claims    │ │                    │                         │
│ └─────────────┘ │                    │ Tool implementations    │
└─────────────────┘                    └─────────────────────────┘
                                                  │
                                                  ▼
                                       claimBatch() to Arc
                                       (every 60s or 10 claims)
```

## Server-side: TypeScript implementation

This example wraps an MCP server (using the official `@modelcontextprotocol/sdk`) with Cadence payment requirements on each tool.

### Install

```sh
npm install @modelcontextprotocol/sdk @arc402/sdk express
```

### server.ts

```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  ARC_TESTNET,
  parseUsdc,
  decodeClaim,
  recoverTypedDataAddress,
  buildDomain,
  CLAIM_TYPES,
  type ClaimAuth,
  type Hex,
} from "@arc402/sdk";

const SERVICE_ADDR = process.env.SERVICE_ADDRESS as Hex;
const ESCROW = process.env.ESCROW_V2_ADDRESS as Hex;

// Define each tool with its price.
const tools = {
  fancy_analysis: {
    description: "Run expensive proprietary analysis. Costs 0.01 USDC per call.",
    price: parseUsdc("0.01"),
    handler: async (args: any) => ({
      content: [{ type: "text", text: `Analysis result for: ${args.query}` }],
    }),
  },
  cheap_lookup: {
    description: "Quick cached lookup. Costs 0.001 USDC per call.",
    price: parseUsdc("0.001"),
    handler: async (args: any) => ({
      content: [{ type: "text", text: `Result: ${args.key}` }],
    }),
  },
};

// In-memory queue, flushed by batch settler (see settler.ts).
const claimQueue: ClaimAuth[] = [];

async function verifyClaim(claim: ClaimAuth, requiredAmount: bigint): Promise<boolean> {
  if (claim.amount < requiredAmount) return false;
  if (claim.service.toLowerCase() !== SERVICE_ADDR.toLowerCase()) return false;
  if (claim.expiry < BigInt(Math.floor(Date.now() / 1000))) return false;
  const recovered = await recoverTypedDataAddress({
    domain: buildDomain(ESCROW, ARC_TESTNET.chainId),
    types: CLAIM_TYPES,
    primaryType: "Claim",
    message: claim,
    signature: claim.signature,
  });
  return recovered.toLowerCase() === claim.agent.toLowerCase();
}

const server = new Server(
  { name: "cadence-paid-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Object.entries(tools).map(([name, t]) => ({
    name,
    description: t.description,
    inputSchema: { type: "object", properties: {} },
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = (tools as any)[request.params.name];
  if (!tool) throw new Error(`Unknown tool: ${request.params.name}`);

  // MCP doesn't have a standard "402" mechanism; we use a custom header field
  // in `request.params.arguments._cadence_claim` for the encoded claim.
  const claimHeader = (request.params.arguments as any)?._cadence_claim;
  if (!claimHeader) {
    throw new Error(
      `Payment required: ${tool.description}. ` +
      `Include _cadence_claim header in arguments. ` +
      `Pay to: ${SERVICE_ADDR} via escrow ${ESCROW}.`,
    );
  }
  const claim = decodeClaim(claimHeader);
  const ok = await verifyClaim(claim, tool.price);
  if (!ok) throw new Error("Invalid Cadence claim");

  claimQueue.push(claim);
  return tool.handler(request.params.arguments);
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[cadence-paid-mcp] listening on stdio");
```

### Background settler (settler.ts)

```ts
import { settleBatch, ARC_TESTNET, type ClaimAuth, type Hex } from "@arc402/sdk";

const FLUSH_INTERVAL_MS = 60_000;
const FLUSH_AT_COUNT = 10;

export function startSettler(queue: ClaimAuth[]) {
  setInterval(async () => {
    if (queue.length === 0) return;
    if (queue.length < FLUSH_AT_COUNT && Date.now() - queue[0]!.queuedAt < FLUSH_INTERVAL_MS) return;
    const toFlush = queue.splice(0, queue.length);
    try {
      const tx = await settleBatch(toFlush, {
        chain: ARC_TESTNET,
        escrow: process.env.ESCROW_V2_ADDRESS as Hex,
        servicePrivateKey: process.env.SERVICE_PRIVATE_KEY as Hex,
      });
      console.error(`[settler] settled ${toFlush.length} claims in tx ${tx}`);
    } catch (e) {
      console.error("[settler] failed:", e);
      queue.unshift(...toFlush); // requeue for next attempt
    }
  }, 1_000);
}
```

## Client-side: configuring your AI desktop app

Once your MCP server is running, the client (Claude Desktop / Cursor / etc.) needs:

1. A Cadence-funded escrow balance (pre-fund via `agent.deposit()` once)
2. A wrapper that, on each `tools/call`, signs a claim and injects `_cadence_claim` into arguments

The MCP spec doesn't yet have a standardized payment header, so this is a per-client integration today. For Claude Desktop, a thin proxy MCP server in the middle can do this on the client's behalf.

A reference proxy implementation is roadmapped at `sdk-ts/examples/mcp-proxy.ts` (W4).

## Why this matters

- **Self-hosted**: you run the MCP server on your own infrastructure. No third-party payment processor.
- **Permissionless**: any AI client + any tool author can transact without prior agreement.
- **Composable**: the same tool can be exposed via stdio MCP (for desktop clients) AND HTTP (for web agents) using the same Cadence payment logic.
- **Open**: the Arc402 protocol is open spec; this integration is reference code, not vendor lock-in.

## When NOT to use this

- If you control both client and server and just want shared API keys, this is overkill.
- If your MCP server is for closed/private use only, traditional auth is simpler.
- If your tool is free (no per-call cost), no payment layer is needed.

## See also

- [Arc402 protocol spec](../spec.md)
- [@arc402/sdk LangChain integration](../../sdk-py/examples/langchain_integration.py) — same pattern, different ecosystem
- [Live LLM endpoint demo](../../sdk-ts/examples/llm-paid-demo.ts) — HTTP version of the same idea
