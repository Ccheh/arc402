/**
 * Phase E: LLM-style paid endpoint demo.
 *
 * Demonstrates that any OpenAI-compatible /v1/chat/completions endpoint
 * can be wrapped in Cadence/Arc402 with three lines of middleware.
 *
 * Flow:
 *   1. Main wallet pre-funds 3 ephemeral agents via depositFor (zero-gas agent onboarding).
 *   2. Server exposes /v1/chat/completions priced at 0.005 USDC per call.
 *   3. Each agent makes 2 calls; SDK transparently handles 402 -> sign -> retry.
 *   4. Server collects all 6 signed claims in an in-memory queue.
 *   5. Server flushes the queue with ONE claimBatch tx on Arc Testnet.
 *   6. Final verification: agent balances + service balance + tx hash.
 *
 * Mock LLM responses are clearly labeled; real OpenAI/Anthropic integration
 * would swap the handler body in <10 lines.
 */

import express from "express";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseEther,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import {
  ARC_TESTNET,
  AgentClient,
  parseUsdc,
  formatUsdc,
  requirePayment,
  settleBatch,
  type ClaimAuth,
} from "../src/index.js";

process.loadEnvFile("../.env");

const MAIN_PK = process.env.PRIVATE_KEY as Hex;
const SERVICE_PK = process.env.SERVICE_PRIVATE_KEY as Hex;
const ESCROW = process.env.ESCROW_V2_ADDRESS as Hex;
if (!MAIN_PK || !SERVICE_PK || !ESCROW) throw new Error("Missing .env values");

const RPC = "https://rpc.blockdaemon.testnet.arc.network";
const PORT = 7403;
const PRICE_PER_CALL = parseUsdc("0.005"); // 0.5 cents per LLM call
const N_AGENTS = 3;
const CALLS_PER_AGENT = 2;

// ---------- viem setup for funding ----------
const arc = defineChain({
  id: ARC_TESTNET.chainId,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const transport = http(RPC, { timeout: 60_000, retryCount: 2 });
const publicClient = createPublicClient({ chain: arc, transport });
const mainAccount = privateKeyToAccount(MAIN_PK);
const mainWallet = createWalletClient({ account: mainAccount, chain: arc, transport });
const serviceAccount = privateKeyToAccount(SERVICE_PK);

// ---------- mock LLM "completions" ----------
function mockCompletion(userMessage: string): string {
  // Clearly labeled demo response. Real impl would call OpenAI/Anthropic here.
  const replies: Record<string, string> = {
    capital: "The capital you asked about is one of the world's major political centers. (Cadence demo response -- real LLM would answer specifically.)",
    weather: "Current conditions look mild and clear. (Cadence demo -- real impl would call a weather API or LLM.)",
    code: "Here's a Python one-liner: `print('hello from a paid agent call')`. (Cadence demo response.)",
  };
  for (const k of Object.keys(replies)) {
    if (userMessage.toLowerCase().includes(k)) return replies[k]!;
  }
  return `Acknowledged: "${userMessage.slice(0, 80)}". This response was served via a paid Cadence endpoint on Arc -- the agent's wallet was debited 0.005 USDC and the service collected an off-chain claim that will be settled on-chain in batch.`;
}

// ---------- in-memory queue for collected claims ----------
const claimQueue: ClaimAuth[] = [];

// ---------- Express server ----------
const app = express();
app.use(express.json());

const SERVICE_ADDR = serviceAccount.address;

app.post(
  "/v1/chat/completions",
  requirePayment({
    amount: PRICE_PER_CALL,
    escrow: ESCROW,
    service: SERVICE_ADDR,
    chain: ARC_TESTNET,
  }),
  (req, res) => {
    const claim = req.arc402Claim!;
    claimQueue.push(claim);

    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const lastUser = [...messages].reverse().find((m: any) => m?.role === "user");
    const userMsg = typeof lastUser?.content === "string" ? lastUser.content : "(empty)";

    // OpenAI-compatible response shape.
    res.json({
      id: `chatcmpl-cadence-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: req.body?.model ?? "cadence-demo-llm",
      choices: [{
        index: 0,
        message: { role: "assistant", content: mockCompletion(userMsg) },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: userMsg.length / 4, completion_tokens: 50, total_tokens: userMsg.length / 4 + 50 },
      cadence: {
        paid_by: claim.agent,
        paid_amount_usdc: formatUsdc(claim.amount),
        settlement: "queued (batched)",
        protocol: "Arc402 v2",
      },
    });
  },
);

const server = app.listen(PORT, () => console.log(`[server] paid LLM endpoint live at http://127.0.0.1:${PORT}/v1/chat/completions\n`));

// ---------- 1. Pre-fund N agents via depositFor (zero-gas onboarding) ----------
console.log(`Pre-funding ${N_AGENTS} ephemeral agent wallets via depositFor (agents need 0 gas)...`);
const agents = Array.from({ length: N_AGENTS }, () => {
  const pk = generatePrivateKey();
  return { pk, address: privateKeyToAccount(pk).address };
});
let mainNonce = await publicClient.getTransactionCount({ address: mainAccount.address });

const depositTxs = await Promise.all(agents.map((a, i) =>
  mainWallet.writeContract({
    address: ESCROW,
    abi: [{
      type: "function", name: "depositFor", stateMutability: "payable",
      inputs: [{ name: "agent", type: "address" }], outputs: [],
    }],
    functionName: "depositFor",
    args: [a.address],
    value: parseEther("0.05"), // 0.05 USDC each (enough for 10 calls at 0.005 each)
    nonce: mainNonce + i,
  }),
));
await publicClient.waitForTransactionReceipt({ hash: depositTxs[depositTxs.length - 1]! });
console.log(`  ${N_AGENTS} agents funded.`);
agents.forEach((a, i) => console.log(`    agent ${i}: ${a.address.slice(0,10)}... funded -- tx ${depositTxs[i]!.slice(0,12)}`));

// ---------- 2. Each agent makes CALLS_PER_AGENT paid calls in parallel ----------
console.log(`\nEach agent makes ${CALLS_PER_AGENT} paid LLM calls...`);
const prompts = ["What is the capital of France?", "Write me a Python one-liner", "What's the weather like?", "Tell me a joke", "Explain photosynthesis", "Convert 1 BTC to USD"];

const results = await Promise.all(agents.flatMap((a, agentIdx) =>
  Array.from({ length: CALLS_PER_AGENT }, async (_, callIdx) => {
    const client = new AgentClient({ privateKey: a.pk });
    const t0 = Date.now();
    const res = await client.fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompts[(agentIdx * CALLS_PER_AGENT + callIdx) % prompts.length] }],
      }),
    });
    const body = (await res.json()) as any;
    const ms = Date.now() - t0;
    return { agentIdx, callIdx, status: res.status, ms, content: body.choices?.[0]?.message?.content, paidBy: body.cadence?.paid_by };
  }),
));

console.log(`\nPer-call results:`);
for (const r of results) {
  console.log(`  agent ${r.agentIdx} call ${r.callIdx}: ${r.status} in ${r.ms}ms`);
  console.log(`    paid_by: ${r.paidBy?.slice(0,10) ?? "?"}...`);
  console.log(`    content: "${(r.content ?? "").slice(0, 100)}..."`);
}

// ---------- 3. Server batches and settles all collected claims ----------
console.log(`\nServer flushes claim queue (${claimQueue.length} claims) with ONE claimBatch tx...`);
const batchTx = await settleBatch(claimQueue, {
  chain: ARC_TESTNET,
  escrow: ESCROW,
  servicePrivateKey: SERVICE_PK,
});
console.log(`  Batch tx: https://testnet.arcscan.app/tx/${batchTx}`);

// ---------- 4. Verify final state ----------
console.log(`\nFinal on-chain balances:`);
for (const a of agents) {
  const bal = await publicClient.readContract({
    address: ESCROW,
    abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }],
    functionName: "balanceOf",
    args: [a.address],
  });
  const expected = parseEther("0.05") - PRICE_PER_CALL * BigInt(CALLS_PER_AGENT);
  console.log(`  ${a.address.slice(0,10)}... balance=${formatUsdc(bal as bigint)} expected=${formatUsdc(expected)} match=${bal === expected}`);
}

console.log(`\n=== Summary ===`);
console.log(`Calls served:           ${results.length}`);
console.log(`All status 200:         ${results.every(r => r.status === 200)}`);
console.log(`Avg latency:            ${Math.round(results.reduce((s, r) => s + r.ms, 0) / results.length)}ms`);
console.log(`Claims batched:         ${claimQueue.length} (in 1 tx)`);
console.log(`Settlement tx:          ${batchTx}`);
console.log(`Total settled:          ${formatUsdc(PRICE_PER_CALL * BigInt(claimQueue.length))} USDC`);

console.log(`\nVERDICT: Cadence transparently turned a stock OpenAI-style endpoint into a per-call paid service.`);
console.log(`To plug in real OpenAI / Anthropic: swap the mockCompletion() handler -- everything else stays.\n`);

server.close();
