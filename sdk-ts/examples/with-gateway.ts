/**
 * Cadence + Circle Gateway: the canonical service-side composition.
 *
 * The story this demonstrates (and documents):
 *
 *   1. Cadence handles **per-call signature collection + batched on-chain
 *      settlement** of agent payments on Arc. The output of a Cadence batch
 *      is plain USDC sitting in the service's Arc Testnet wallet.
 *
 *   2. Circle Gateway handles **cross-chain treasury routing + outflow** for
 *      that USDC: settle to Base mainnet, sweep to a custodial wallet, or
 *      route via CCTP to any other supported chain. Gateway is hosted Circle
 *      infrastructure that requires a Circle account.
 *
 * The two pieces compose at the **service's wallet**, not in any one contract.
 * Cadence ends when USDC lands in the service wallet on Arc. Gateway begins
 * when the service wants to do something with that USDC beyond holding it.
 *
 *   Agent ─Cadence─▶ service Arc wallet ─Gateway─▶ Base / Ethereum / sweep
 *
 * This script:
 *   - Runs a real Cadence batch settlement on Arc Testnet (4 mock claims).
 *   - Reads the service's post-settlement Arc USDC balance.
 *   - Prints the Gateway API call the service WOULD make next (commented;
 *     Gateway requires a Circle account, so we document the call shape
 *     rather than execute it).
 *
 * Why this matters for positioning:
 *   - Cadence is **not** trying to be cross-chain treasury — that's Gateway.
 *   - A real production deployment runs Cadence ON ARC + Gateway FOR
 *     OUTFLOW. They are complementary, not competing.
 *   - The Cadence batch is small + cheap (32-37k gas per claim). The
 *     Gateway batch is larger + per-route. Different layers, different jobs.
 */

import {
  createPublicClient,
  defineChain,
  http,
  parseEther,
  formatEther,
  type Hex,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

import {
  ARC_TESTNET,
  parseUsdc,
  formatUsdc,
  buildDomain,
  CLAIM_TYPES,
  settleBatch,
  type ClaimAuth,
} from "../src/index.js";

// ---------- env ----------
process.loadEnvFile("../.env");

const MAIN_PK = process.env.PRIVATE_KEY as Hex;
const SERVICE_PK = process.env.SERVICE_PRIVATE_KEY as Hex;
const ESCROW = process.env.ESCROW_ADDRESS as Hex;
if (!MAIN_PK || !SERVICE_PK || !ESCROW) {
  throw new Error("Missing PRIVATE_KEY / SERVICE_PRIVATE_KEY / ESCROW_ADDRESS in .env");
}

const RPC = "https://rpc.testnet.arc.network";
const EXPLORER = "https://testnet.arcscan.app";
const PRICE_PER_CALL = parseUsdc("0.005");
const N_CLAIMS = 4;

// ---------- viem ----------
const arc = defineChain({
  id: ARC_TESTNET.chainId,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const transport = http(RPC, { timeout: 60_000, retryCount: 2 });
const publicClient = createPublicClient({ chain: arc, transport });

const mainAccount = privateKeyToAccount(MAIN_PK);
const serviceAccount = privateKeyToAccount(SERVICE_PK);

console.log(`PAYER  : ${mainAccount.address}`);
console.log(`SERVICE: ${serviceAccount.address}\n`);

// ---------- 1. Cadence side: synthesize N off-chain claims ----------
console.log(`Step 1: synthesize ${N_CLAIMS} off-chain Cadence claims from MAIN`);

const now = BigInt(Math.floor(Date.now() / 1000));
const expiry = now + 3600n;
const domain = buildDomain(ESCROW, ARC_TESTNET.chainId);

// Create a wallet client just for signing (no broadcasts needed for this step)
import { createWalletClient } from "viem";
const mainWallet = createWalletClient({ account: mainAccount, chain: arc, transport });

const claims: ClaimAuth[] = [];
for (let i = 0; i < N_CLAIMS; i++) {
  const nonce = BigInt("0x" + Math.random().toString(16).slice(2, 18));
  const sig = await mainWallet.signTypedData({
    account: mainAccount,
    domain,
    types: CLAIM_TYPES,
    primaryType: "Claim",
    message: {
      agent: mainAccount.address,
      service: serviceAccount.address,
      amount: PRICE_PER_CALL,
      nonce,
      expiry,
    },
  });
  claims.push({
    agent: mainAccount.address,
    service: serviceAccount.address,
    amount: PRICE_PER_CALL,
    nonce,
    expiry,
    signature: sig as Hex,
  });
}
console.log(`  ${N_CLAIMS} claims signed off-chain. Total value: ${formatUsdc(PRICE_PER_CALL * BigInt(N_CLAIMS))} USDC\n`);

// ---------- 2. Cadence side: batch-settle on Arc ----------
console.log(`Step 2: SERVICE settles all ${N_CLAIMS} claims in one Cadence batch tx`);
const batchTx = await settleBatch(claims, {
  chain: ARC_TESTNET,
  escrow: ESCROW,
  servicePrivateKey: SERVICE_PK,
});
console.log(`  batch tx: ${EXPLORER}/tx/${batchTx}`);

const serviceBalance = await publicClient.getBalance({ address: serviceAccount.address });
console.log(`  SERVICE post-settle Arc USDC balance: ${formatEther(serviceBalance)} USDC\n`);

// ---------- 3. Gateway side: documented, not executed ----------
console.log(`Step 3: SERVICE routes accumulated USDC via Circle Gateway`);
console.log(`  (Gateway requires a Circle account — this script documents the call)\n`);

console.log(`  Conceptual Gateway request the SERVICE would make next:\n`);
console.log(`    POST https://api.circle.com/v2/cctp/transfers`);
console.log(`    Authorization: Bearer <circle-api-key>`);
console.log(`    {`);
console.log(`      "source": {`);
console.log(`        "chain": "ARC_TESTNET",`);
console.log(`        "address": "${serviceAccount.address}",`);
console.log(`        "amount": "${formatEther(serviceBalance)}"`);
console.log(`      },`);
console.log(`      "destination": {`);
console.log(`        "chain": "BASE_SEPOLIA",         // or ETH, OP, ARB, etc.`);
console.log(`        "address": "<service-base-wallet-address>"`);
console.log(`      }`);
console.log(`    }\n`);

console.log(`  After Gateway settlement, the USDC originally collected per-call`);
console.log(`  on Arc is available on Base (or any CCTP-supported chain) for the`);
console.log(`  service's treasury / payroll / cross-chain rebalancing needs.\n`);

// ---------- summary ----------
console.log(`================== SUMMARY ==================`);
console.log(`Cadence + Gateway composition:`);
console.log(`  - Cadence batch settle (Arc):  ${EXPLORER}/tx/${batchTx}`);
console.log(`  - Service USDC now sits at:    ${serviceAccount.address} on Arc`);
console.log(`  - Next step (off-script):      route via Circle Gateway to destination chain`);
console.log();
console.log(`Why split this way:`);
console.log(`  - Cadence handles **collection** — per-call signed claims, batch on Arc.`);
console.log(`  - Gateway handles **routing**    — cross-chain treasury operations.`);
console.log(`  - The service wallet is the **handoff point**. No on-chain bridge needed.`);
console.log();
console.log(`Cadence is not a Gateway competitor. It is the seller-side middleware`);
console.log(`that produces the USDC stream Gateway then routes.`);
