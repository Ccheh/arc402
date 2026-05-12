/**
 * Arc402 end-to-end demo.
 *
 * What this does in one run:
 *   1. Load the agent wallet (and ESCROW_ADDRESS) from project-root .env.
 *   2. Generate a fresh "service" wallet, fund it with 0.05 USDC for gas
 *      (one-time, only if .env doesn't already have SERVICE_PRIVATE_KEY).
 *   3. Boot a tiny Express server with a paid /weather endpoint (0.01 USDC per call).
 *   4. Agent deposits 0.5 USDC into the escrow (if its escrow balance is too low).
 *   5. Agent calls /weather using AgentClient.fetch() -- the SDK transparently
 *      handles the 402 response, signs an EIP-712 claim, and retries.
 *   6. Service settles the signed claim on-chain by calling escrow.claim().
 *   7. Print before/after balances + every tx hash so the lifecycle is auditable
 *      on testnet.arcscan.app.
 */

import express from "express";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  createWalletClient,
  createPublicClient,
  defineChain,
  http,
  parseEther,
} from "viem";

import {
  ARC_TESTNET,
  AgentClient,
  parseUsdc,
  formatUsdc,
  requirePayment,
  settle,
  type Hex,
} from "../src/index.js";

// ---------- Load .env ----------

const ENV_PATH = "../.env";
process.loadEnvFile(ENV_PATH);

const AGENT_PK = process.env.PRIVATE_KEY as Hex;
const ESCROW = process.env.ESCROW_ADDRESS as Hex;
if (!AGENT_PK || !ESCROW) {
  throw new Error("PRIVATE_KEY and ESCROW_ADDRESS must be set in .env");
}

// ---------- Ensure a service wallet exists ----------

let servicePk = process.env.SERVICE_PRIVATE_KEY as Hex | undefined;
if (!servicePk) {
  console.log("[setup] No SERVICE_PRIVATE_KEY in .env -- generating a fresh service wallet");
  servicePk = generatePrivateKey();
  const envBody = readFileSync(ENV_PATH, "utf8").replace(/\s+$/, "");
  writeFileSync(ENV_PATH, `${envBody}\nSERVICE_PRIVATE_KEY=${servicePk}\n`, "utf8");
  console.log("[setup] Saved SERVICE_PRIVATE_KEY to .env");
}
const SERVICE_ADDRESS = privateKeyToAccount(servicePk).address;

// ---------- Viem clients for funding / inspection ----------

const arcChain = defineChain({
  id: ARC_TESTNET.chainId,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_TESTNET.rpc] } },
});
const publicClient = createPublicClient({ chain: arcChain, transport: http(ARC_TESTNET.rpc) });
const agentAccount = privateKeyToAccount(AGENT_PK);
const agentWalletClient = createWalletClient({
  account: agentAccount,
  chain: arcChain,
  transport: http(ARC_TESTNET.rpc),
});

// ---------- Fund service wallet if it has no gas ----------

const serviceBal = await publicClient.getBalance({ address: SERVICE_ADDRESS });
console.log(`[setup] Service wallet ${SERVICE_ADDRESS}`);
console.log(`[setup] Service wallet balance: ${formatUsdc(serviceBal)} USDC`);
if (serviceBal < parseUsdc("0.02")) {
  console.log("[setup] Service has < 0.02 USDC -- funding 0.05 USDC for gas...");
  const fundTx = await agentWalletClient.sendTransaction({
    to: SERVICE_ADDRESS,
    value: parseEther("0.05"),
  });
  await publicClient.waitForTransactionReceipt({ hash: fundTx });
  console.log(`[setup] Funding tx: ${ARC_TESTNET.explorer}/tx/${fundTx}`);
}

// ---------- Boot the Express service ----------

const PORT = 7402;
const app = express();
app.use(express.json());

app.get(
  "/weather",
  requirePayment({
    amount: parseUsdc("0.01"),
    escrow: ESCROW,
    service: SERVICE_ADDRESS,
    chain: ARC_TESTNET,
  }),
  async (req, res) => {
    const claim = req.arc402Claim!;
    res.json({
      city: "Tokyo",
      temperature_c: 22,
      humidity: 55,
      paid_by: claim.agent,
      paid_amount_usdc: formatUsdc(claim.amount),
    });

    // Fire-and-forget on-chain settlement so the agent isn't blocked on tx finality.
    settle(claim, { chain: ARC_TESTNET, escrow: ESCROW, servicePrivateKey: servicePk! })
      .then(hash => console.log(`[server] settled on-chain: ${ARC_TESTNET.explorer}/tx/${hash}`))
      .catch(err => console.error("[server] settle failed:", err.message));
  },
);

const server = app.listen(PORT, () => console.log(`[server] listening on http://127.0.0.1:${PORT}`));

// ---------- Run the agent ----------

const agent = new AgentClient({ privateKey: AGENT_PK });
console.log(`\n[agent] address ${agent.address}`);

const wallet0 = await agent.walletBalance();
const escrow0 = await agent.balanceInEscrow(ESCROW);
console.log(`[agent] before: wallet=${formatUsdc(wallet0)}, escrow=${formatUsdc(escrow0)} USDC`);

if (escrow0 < parseUsdc("0.05")) {
  console.log(`[agent] escrow < 0.05 -- depositing 0.5 USDC...`);
  const depHash = await agent.deposit(ESCROW, parseUsdc("0.5"));
  console.log(`[agent] deposit tx: ${ARC_TESTNET.explorer}/tx/${depHash}`);
}

console.log(`\n[agent] calling GET http://127.0.0.1:${PORT}/weather ...`);
const response = await agent.fetch(`http://127.0.0.1:${PORT}/weather`);
const body = await response.json();
console.log(`[agent] response (${response.status}):`, body);

// Give the server a moment to broadcast its settle() tx
await new Promise(r => setTimeout(r, 12_000));

const wallet1 = await agent.walletBalance();
const escrow1 = await agent.balanceInEscrow(ESCROW);
const svcBal1 = await publicClient.getBalance({ address: SERVICE_ADDRESS });
console.log(`\n[agent] after:`);
console.log(`  agent wallet:   ${formatUsdc(wallet1)} USDC`);
console.log(`  agent escrow:   ${formatUsdc(escrow1)} USDC`);
console.log(`  service wallet: ${formatUsdc(svcBal1)} USDC`);

console.log(`\n[done] -- ${ARC_TESTNET.explorer} to see all txs.`);
server.close();
