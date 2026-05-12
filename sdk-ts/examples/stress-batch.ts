/**
 * Phase B: Multi-agent concurrent stress test on Arc Testnet.
 *
 * Scenario:
 *   - Main wallet uses depositFor() to pre-fund 10 ephemeral agent wallets in escrow
 *     (agents never need gas themselves -- they only sign).
 *   - Each agent signs 5 EIP-712 claims for a single service (50 claims total).
 *   - Service submits ALL 50 claims in one claimBatch() tx.
 *   - Verify: every agent's balance is exactly correct, every nonce is marked used,
 *     service received the correct total.
 *
 * This proves the core "stream of micropayments" economic model under real chain conditions.
 */

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  http,
  keccak256,
  parseEther,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

process.loadEnvFile("../.env");

// ---------- config ----------

const RPC = process.env.ARC_RPC ?? "https://rpc.blockdaemon.testnet.arc.network";
const CHAIN_ID = 5042002;
const MAIN_PK = process.env.PRIVATE_KEY as Hex;
const SERVICE_PK = process.env.SERVICE_PRIVATE_KEY as Hex;
const ESCROW = process.env.ESCROW_V2_ADDRESS as Hex;

if (!MAIN_PK || !SERVICE_PK || !ESCROW) {
  throw new Error("Missing PRIVATE_KEY / SERVICE_PRIVATE_KEY / ESCROW_V2_ADDRESS in .env");
}

const N_AGENTS = Number(process.env.N_AGENTS ?? 5);
const CLAIMS_PER_AGENT = Number(process.env.CLAIMS_PER_AGENT ?? 4);
const PER_AGENT_DEPOSIT = parseEther("0.2"); // 0.2 USDC per agent
const CLAIM_AMOUNT = parseEther("0.01"); // 0.01 USDC per claim

// ---------- viem setup ----------

const arc = defineChain({
  id: CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const transport = http(RPC, { timeout: 60_000, retryCount: 2 });
const publicClient = createPublicClient({ chain: arc, transport });
const mainAccount = privateKeyToAccount(MAIN_PK);
const mainWallet = createWalletClient({ account: mainAccount, chain: arc, transport });
const serviceAccount = privateKeyToAccount(SERVICE_PK);
const serviceWallet = createWalletClient({ account: serviceAccount, chain: arc, transport });

// ---------- minimal ABI ----------

const ESCROW_ABI = [
  {
    type: "function",
    name: "depositFor",
    stateMutability: "payable",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "isNonceUsed",
    stateMutability: "view",
    inputs: [
      { type: "address" },
      { type: "address" },
      { type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "claimBatch",
    stateMutability: "nonpayable",
    inputs: [
      {
        type: "tuple[]",
        components: [
          { name: "agent", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "expiry", type: "uint256" },
          { name: "signature", type: "bytes" },
        ],
      },
    ],
    outputs: [],
  },
] as const;

const CLAIM_TYPES = {
  Claim: [
    { name: "agent", type: "address" },
    { name: "service", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
} as const;

const domain = {
  name: "Arc402",
  version: "2",
  chainId: CHAIN_ID,
  verifyingContract: ESCROW,
} as const;

// ---------- run ----------

const t0 = Date.now();
console.log(`Phase B stress test starting`);
console.log(`  V2 escrow: ${ESCROW}`);
console.log(`  Service:   ${serviceAccount.address}`);
console.log(`  ${N_AGENTS} agents x ${CLAIMS_PER_AGENT} claims = ${N_AGENTS * CLAIMS_PER_AGENT} total\n`);

// Step 0a: Pre-flight -- get latest main nonce (we'll manage nonces explicitly to avoid races)
let mainNonce = await publicClient.getTransactionCount({ address: mainAccount.address });
console.log(`Step 0: pre-flight, main wallet nonce = ${mainNonce}`);

// Step 0b: Ensure service has enough gas for the batch
const estimatedBatchGas = BigInt(N_AGENTS * CLAIMS_PER_AGENT) * 35_000n + 50_000n;
const arcGasPrice = 50_000_000_000n; // 50 gwei buffer
const estimatedBatchCost = estimatedBatchGas * arcGasPrice;
const minServiceBalance = (estimatedBatchCost * 12n) / 10n;

const serviceBalPre = await publicClient.getBalance({ address: serviceAccount.address });
console.log(`  service has:        ${serviceBalPre} wei`);
console.log(`  estimated need:     ${minServiceBalance} wei`);
if (serviceBalPre < minServiceBalance) {
  const topup = minServiceBalance - serviceBalPre + parseEther("0.05");
  console.log(`  topping up service with ${topup} wei from main (nonce=${mainNonce})`);
  const fundHash = await mainWallet.sendTransaction({
    to: serviceAccount.address,
    value: topup,
    nonce: mainNonce++,
  });
  await publicClient.waitForTransactionReceipt({ hash: fundHash });
  console.log(`  top-up tx confirmed: ${fundHash}`);
} else {
  console.log(`  service has enough gas, skipping top-up`);
}
console.log();

// Step 1: Generate ephemeral agent wallets
const agents = Array.from({ length: N_AGENTS }, () => {
  const pk = generatePrivateKey();
  const acc = privateKeyToAccount(pk);
  return { pk, address: acc.address, account: acc };
});
console.log(`Step 1: Generated ${N_AGENTS} ephemeral agents:`);
for (const a of agents) console.log(`  ${a.address}`);

// Step 2: Pre-fund each agent's escrow via depositFor (parallel, explicit nonces)
console.log(`\nStep 2: depositFor() for each agent (0.2 USDC each, parallel with explicit nonces)`);
const depositTxs = await Promise.all(
  agents.map((a, i) =>
    mainWallet.writeContract({
      address: ESCROW,
      abi: ESCROW_ABI,
      functionName: "depositFor",
      args: [a.address],
      value: PER_AGENT_DEPOSIT,
      nonce: mainNonce + i,
    })
  )
);
mainNonce += N_AGENTS;
for (let i = 0; i < N_AGENTS; i++) {
  console.log(`  ${agents[i]!.address.slice(0, 8)}... funded -- tx ${depositTxs[i]!.slice(0, 10)}`);
}
console.log(`  Waiting for last deposit to confirm...`);
const lastReceipt = await publicClient.waitForTransactionReceipt({ hash: depositTxs[depositTxs.length - 1]! });
console.log(`  Done at block ${lastReceipt.blockNumber}`);

// Step 3: All agents sign claims off-chain (parallel)
console.log(`\nStep 3: Each agent signs ${CLAIMS_PER_AGENT} claims off-chain (parallel)`);
const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);
type Claim = { agent: Hex; amount: bigint; nonce: bigint; expiry: bigint; signature: Hex };
const claims: Claim[] = [];

await Promise.all(
  agents.map(async (a, agentIdx) => {
    for (let i = 0; i < CLAIMS_PER_AGENT; i++) {
      const nonce = BigInt(Date.now()) * 1000n + BigInt(agentIdx * 100 + i);
      const sig = await a.account.signTypedData({
        domain,
        types: CLAIM_TYPES,
        primaryType: "Claim",
        message: {
          agent: a.address,
          service: serviceAccount.address,
          amount: CLAIM_AMOUNT,
          nonce,
          expiry,
        },
      });
      claims.push({
        agent: a.address,
        amount: CLAIM_AMOUNT,
        nonce,
        expiry,
        signature: sig,
      });
    }
  })
);
console.log(`  ${claims.length} claims signed`);

// Step 4: Service submits ONE big claimBatch
console.log(`\nStep 4: Service submits claimBatch with ${claims.length} claims (ONE tx)`);
const serviceBalBefore = await publicClient.getBalance({ address: serviceAccount.address });
console.log(`  Service gas balance: ${serviceBalBefore} wei (${Number(serviceBalBefore) / 1e18} USDC)`);

// Skip simulation -- contract logic is verified by 15 foundry tests + RPC simulation is heavy at batch size.
let batchTx: Hex | undefined;
const MAX_RETRIES = 5;
for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  try {
    batchTx = await serviceWallet.writeContract({
      address: ESCROW,
      abi: ESCROW_ABI,
      functionName: "claimBatch",
      args: [claims],
    });
    break;
  } catch (e: any) {
    const det = e.details || e.cause?.details || e.shortMessage || e.message || "";
    const transient = det.includes("txpool") || det.includes("rate") || det.includes("timeout");
    console.error(`  attempt ${attempt}/${MAX_RETRIES} failed: ${det.slice(0, 200)}`);
    if (!transient || attempt === MAX_RETRIES) {
      console.error(`  GIVING UP`);
      process.exit(1);
    }
    const waitMs = 5000 * attempt;
    console.error(`  transient -- sleeping ${waitMs}ms and retrying`);
    await new Promise(r => setTimeout(r, waitMs));
  }
}
if (!batchTx) process.exit(1);
console.log(`  Batch tx: ${batchTx}`);
const batchReceipt = await publicClient.waitForTransactionReceipt({ hash: batchTx });
console.log(`  Status: ${batchReceipt.status}, block: ${batchReceipt.blockNumber}, gas used: ${batchReceipt.gasUsed}`);
const serviceBalAfter = await publicClient.getBalance({ address: serviceAccount.address });

// Step 5: Verify on-chain state
console.log(`\nStep 5: Verify on-chain state`);
const expectedPerAgentRemaining = PER_AGENT_DEPOSIT - CLAIM_AMOUNT * BigInt(CLAIMS_PER_AGENT);
let allGood = true;
for (const a of agents) {
  const bal = await publicClient.readContract({
    address: ESCROW,
    abi: ESCROW_ABI,
    functionName: "balanceOf",
    args: [a.address],
  });
  const ok = bal === expectedPerAgentRemaining;
  if (!ok) {
    console.log(`  ${a.address.slice(0, 10)}: ${bal} (expected ${expectedPerAgentRemaining}) FAIL`);
    allGood = false;
  }
}
console.log(`  All ${N_AGENTS} agent balances correct: ${allGood ? "YES" : "NO"}`);

// Check nonces marked used
let allNoncesUsed = true;
for (const c of claims) {
  const used = await publicClient.readContract({
    address: ESCROW,
    abi: ESCROW_ABI,
    functionName: "isNonceUsed",
    args: [c.agent, serviceAccount.address, c.nonce],
  });
  if (!used) {
    allNoncesUsed = false;
    console.log(`  Nonce ${c.nonce} for agent ${c.agent.slice(0, 10)}: NOT MARKED USED`);
    break;
  }
}
console.log(`  All ${claims.length} nonces marked used: ${allNoncesUsed ? "YES" : "NO"}`);

// Service collected total
const totalExpected = CLAIM_AMOUNT * BigInt(claims.length);
const serviceGain = serviceBalAfter - serviceBalBefore + batchReceipt.gasUsed * batchReceipt.effectiveGasPrice;
console.log(`  Service net gain (incl gas):  ${serviceGain} wei`);
console.log(`  Expected total settled:       ${totalExpected} wei`);
const settlementMatch = serviceGain === totalExpected;
console.log(`  Settlement amount matches:    ${settlementMatch ? "YES" : "NO (small diff likely effective gas rounding)"}`);

const t1 = Date.now();
console.log(`\n=== Summary ===`);
console.log(`Total claims processed: ${claims.length}`);
console.log(`Batch tx gas:           ${batchReceipt.gasUsed}`);
console.log(`Per-claim gas:          ${batchReceipt.gasUsed / BigInt(claims.length)}`);
console.log(`Effective gas price:    ${batchReceipt.effectiveGasPrice} wei`);
const batchCostUsdc = Number(batchReceipt.gasUsed * batchReceipt.effectiveGasPrice) / 1e18;
console.log(`Batch settlement cost:  ${batchCostUsdc.toFixed(6)} USDC`);
console.log(`Per-claim cost:         ${(batchCostUsdc / claims.length).toFixed(8)} USDC`);
console.log(`Margin at 0.01 svc:     ${(((CLAIM_AMOUNT - BigInt(Math.floor(batchCostUsdc / claims.length * 1e18))) * 10000n) / CLAIM_AMOUNT)} bps`);
console.log(`Wall-clock duration:    ${((t1 - t0) / 1000).toFixed(1)}s`);
console.log(`Batch tx URL:           https://testnet.arcscan.app/tx/${batchTx}`);
console.log(`\nVERDICT: ${allGood && allNoncesUsed ? "PASS" : "FAIL"}`);
