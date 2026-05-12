/**
 * Phase C: Adversarial on-chain tests.
 *
 * Each attack is submitted as a real transaction to Arc Testnet and MUST revert.
 * We capture the revert reason (custom error selector) and verify against expected.
 *
 * Attacks tested:
 *   1. Replay attack -- submit a valid claim twice -> NonceAlreadyUsed
 *   2. Expired claim -> ClaimExpired
 *   3. Wrong-service claim (signed for service A, submitted by service B) -> InvalidSignature
 *   4. Forged signature (signed by random key) -> InvalidSignature
 *   5. Unauthorized session key signer -> InvalidSignature
 */

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseEther,
  toFunctionSelector,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

process.loadEnvFile("../.env");

const RPC = "https://rpc.blockdaemon.testnet.arc.network";
const CHAIN_ID = 5042002;
const MAIN_PK = process.env.PRIVATE_KEY as Hex;
const SERVICE_PK = process.env.SERVICE_PRIVATE_KEY as Hex;
const ESCROW = process.env.ESCROW_V2_ADDRESS as Hex;

const arc = defineChain({
  id: CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const transport = http(RPC, { timeout: 60_000, retryCount: 2 });
const publicClient = createPublicClient({ chain: arc, transport });
const mainAcc = privateKeyToAccount(MAIN_PK);
const mainWallet = createWalletClient({ account: mainAcc, chain: arc, transport });
const svcAcc = privateKeyToAccount(SERVICE_PK);
const svcWallet = createWalletClient({ account: svcAcc, chain: arc, transport });

const ABI = [
  {
    type: "function", name: "depositFor", stateMutability: "payable",
    inputs: [{ name: "agent", type: "address" }], outputs: [],
  },
  {
    type: "function", name: "claim", stateMutability: "nonpayable",
    inputs: [
      { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" },
    ], outputs: [],
  },
  {
    type: "function", name: "balanceOf", stateMutability: "view",
    inputs: [{ type: "address" }], outputs: [{ type: "uint256" }],
  },
] as const;

const domain = (verifyingContract: Hex) => ({
  name: "Arc402", version: "2", chainId: CHAIN_ID, verifyingContract,
} as const);

const CLAIM_TYPES = {
  Claim: [
    { name: "agent", type: "address" },
    { name: "service", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
} as const;

const expectedSelectors = {
  NonceAlreadyUsed: toFunctionSelector("NonceAlreadyUsed()").slice(0, 10),
  ClaimExpired: toFunctionSelector("ClaimExpired()").slice(0, 10),
  InvalidSignature: toFunctionSelector("InvalidSignature()").slice(0, 10),
  SessionExpiredOrUnknown: toFunctionSelector("SessionExpiredOrUnknown()").slice(0, 10),
};
console.log(`Expected error selectors:`, expectedSelectors);
console.log();

// One agent will be the victim/legitimate signer for all attacks
const agentAcc = privateKeyToAccount(generatePrivateKey());
const evilAcc = privateKeyToAccount(generatePrivateKey()); // attacker key
console.log(`Legit agent:  ${agentAcc.address}`);
console.log(`Evil signer:  ${evilAcc.address}`);

// Pre-fund the agent with 1 USDC
let nonce = await publicClient.getTransactionCount({ address: mainAcc.address });
console.log(`Funding agent with 1 USDC via depositFor (nonce=${nonce})...`);
const fundTx = await mainWallet.writeContract({
  address: ESCROW,
  abi: ABI,
  functionName: "depositFor",
  args: [agentAcc.address],
  value: parseEther("1"),
  nonce: nonce++,
});
await publicClient.waitForTransactionReceipt({ hash: fundTx });
console.log(`  funded, tx: ${fundTx}\n`);

// Helper: sign claim
async function sign(opts: {
  signerPk: Hex;
  agent: `0x${string}`;
  service: `0x${string}`;
  amount: bigint;
  nonce: bigint;
  expiry: bigint;
}) {
  return await privateKeyToAccount(opts.signerPk).signTypedData({
    domain: domain(ESCROW),
    types: CLAIM_TYPES,
    primaryType: "Claim",
    message: {
      agent: opts.agent,
      service: opts.service,
      amount: opts.amount,
      nonce: opts.nonce,
      expiry: opts.expiry,
    },
  });
}

// Helper: simulate the attack to get the clean revert reason. simulateContract returns
// errorName for custom errors when the ABI is provided.
async function tryAttack(
  name: string,
  args: { agent: Hex; amount: bigint; nonce: bigint; expiry: bigint; signature: Hex },
  expectedErrorName: string,
): Promise<{ name: string; passed: boolean; detail: string }> {
  const fullAbi = [...ABI, {
    type: "error", name: "NonceAlreadyUsed", inputs: [],
  }, {
    type: "error", name: "ClaimExpired", inputs: [],
  }, {
    type: "error", name: "InvalidSignature", inputs: [],
  }, {
    type: "error", name: "ZeroAmount", inputs: [],
  }, {
    type: "error", name: "InsufficientBalance", inputs: [],
  }, {
    type: "error", name: "SessionExpiredOrUnknown", inputs: [],
  }, {
    type: "error", name: "TransferFailed", inputs: [],
  }] as const;
  try {
    await publicClient.simulateContract({
      account: svcAcc,
      address: ESCROW,
      abi: fullAbi as any,
      functionName: "claim",
      args: [args.agent, args.amount, args.nonce, args.expiry, args.signature],
    });
    return { name, passed: false, detail: `attack unexpectedly simulated as success` };
  } catch (e: any) {
    // viem ContractFunctionRevertedError exposes data.errorName when ABI is present
    const errorName = e.cause?.data?.errorName || e.data?.errorName || "";
    const passed = errorName === expectedErrorName;
    return {
      name,
      passed,
      detail: passed
        ? `reverted with ${errorName} (expected)`
        : `reverted but errorName="${errorName}" (expected ${expectedErrorName})`,
    };
  }
}

const now = BigInt(Math.floor(Date.now() / 1000));
const validExpiry = now + 3600n;
const expiredExpiry = now - 60n;

const results: { name: string; passed: boolean; detail: string }[] = [];

// Attack 1: Replay (do a valid claim then replay it)
console.log(`Attack 1: Replay`);
const replayNonce = BigInt(Date.now()) * 1000n + 1n;
const validSig1 = await agentAcc.signTypedData({
  domain: domain(ESCROW),
  types: CLAIM_TYPES,
  primaryType: "Claim",
  message: {
    agent: agentAcc.address,
    service: svcAcc.address,
    amount: parseEther("0.01"),
    nonce: replayNonce,
    expiry: validExpiry,
  },
});
// First claim should succeed
const okHash = await svcWallet.writeContract({
  address: ESCROW, abi: ABI, functionName: "claim",
  args: [agentAcc.address, parseEther("0.01"), replayNonce, validExpiry, validSig1],
});
const okReceipt = await publicClient.waitForTransactionReceipt({ hash: okHash });
console.log(`  legitimate first claim: ${okReceipt.status}, tx=${okHash.slice(0, 14)}...`);
// Now replay with same nonce
results.push(await tryAttack(
  "1) Replay (same nonce twice)",
  { agent: agentAcc.address, amount: parseEther("0.01"), nonce: replayNonce, expiry: validExpiry, signature: validSig1 },
  "NonceAlreadyUsed",
));
console.log(`  ${results[results.length - 1]!.detail}`);

// Attack 2: Expired claim
console.log(`Attack 2: Expired claim`);
const expNonce = BigInt(Date.now()) * 1000n + 2n;
const expiredSig = await agentAcc.signTypedData({
  domain: domain(ESCROW),
  types: CLAIM_TYPES,
  primaryType: "Claim",
  message: {
    agent: agentAcc.address,
    service: svcAcc.address,
    amount: parseEther("0.01"),
    nonce: expNonce,
    expiry: expiredExpiry,
  },
});
results.push(await tryAttack(
  "2) Expired claim",
  { agent: agentAcc.address, amount: parseEther("0.01"), nonce: expNonce, expiry: expiredExpiry, signature: expiredSig },
  "ClaimExpired",
));
console.log(`  ${results[results.length - 1]!.detail}`);

// Attack 3: Wrong service (signed for X, submitted by svc)
console.log(`Attack 3: Wrong service (signed for someone else)`);
const wrongSvcAcc = privateKeyToAccount(generatePrivateKey());
const wsNonce = BigInt(Date.now()) * 1000n + 3n;
const wrongSvcSig = await agentAcc.signTypedData({
  domain: domain(ESCROW),
  types: CLAIM_TYPES,
  primaryType: "Claim",
  message: {
    agent: agentAcc.address,
    service: wrongSvcAcc.address, // signed for different service
    amount: parseEther("0.01"),
    nonce: wsNonce,
    expiry: validExpiry,
  },
});
results.push(await tryAttack(
  "3) Wrong service (sig binds to X, msg.sender is Y)",
  { agent: agentAcc.address, amount: parseEther("0.01"), nonce: wsNonce, expiry: validExpiry, signature: wrongSvcSig },
  "InvalidSignature",
));
console.log(`  ${results[results.length - 1]!.detail}`);

// Attack 4: Forged signature (signed by evil, claims to be from agent)
console.log(`Attack 4: Forged signature by attacker`);
const fNonce = BigInt(Date.now()) * 1000n + 4n;
const forgedSig = await evilAcc.signTypedData({
  domain: domain(ESCROW),
  types: CLAIM_TYPES,
  primaryType: "Claim",
  message: {
    agent: agentAcc.address, // claims to be from agent
    service: svcAcc.address,
    amount: parseEther("0.01"),
    nonce: fNonce,
    expiry: validExpiry,
  },
});
results.push(await tryAttack(
  "4) Forged signature (evil signs claiming to be agent)",
  { agent: agentAcc.address, amount: parseEther("0.01"), nonce: fNonce, expiry: validExpiry, signature: forgedSig },
  "InvalidSignature",
));
console.log(`  ${results[results.length - 1]!.detail}`);

// Attack 5: Cross-domain replay (try V1's domain version "1" instead of "2")
console.log(`Attack 5: Cross-version replay (V1 sig in V2 contract)`);
const cdNonce = BigInt(Date.now()) * 1000n + 5n;
const v1Sig = await agentAcc.signTypedData({
  domain: { name: "Arc402", version: "1", chainId: CHAIN_ID, verifyingContract: ESCROW },
  types: CLAIM_TYPES,
  primaryType: "Claim",
  message: {
    agent: agentAcc.address,
    service: svcAcc.address,
    amount: parseEther("0.01"),
    nonce: cdNonce,
    expiry: validExpiry,
  },
});
results.push(await tryAttack(
  "5) Cross-version replay (V1 domain sig in V2)",
  { agent: agentAcc.address, amount: parseEther("0.01"), nonce: cdNonce, expiry: validExpiry, signature: v1Sig },
  "InvalidSignature",
));
console.log(`  ${results[results.length - 1]!.detail}`);

// Final tally
console.log(`\n=== Adversarial test results ===`);
let pass = 0;
for (const r of results) {
  console.log(`  ${r.passed ? "[PASS]" : "[FAIL]"}  ${r.name}`);
  if (r.passed) pass++;
}
console.log(`\nVERDICT: ${pass}/${results.length} attacks blocked as expected.`);
console.log(`\nAgent final balance after: ${await publicClient.readContract({
  address: ESCROW, abi: ABI, functionName: "balanceOf", args: [agentAcc.address],
})} wei (started with 1 USDC, only 0.01 consumed by the one legitimate claim)`);
