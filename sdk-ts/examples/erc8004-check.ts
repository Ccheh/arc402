/**
 * Phase: ERC-8004 read integration demo.
 *
 * Reads the official Circle-published ERC-8004 IdentityRegistry on Arc Testnet
 * to check whether an address has a registered agent identity. Demonstrates
 * the read pattern that Cadence middleware uses to apply per-identity policies.
 */

import { getAgentIdentity, ERC8004_ARC_TESTNET } from "../src/index.js";

console.log(`ERC-8004 registries on Arc Testnet (Circle-published canonical deployments):`);
console.log(`  IdentityRegistry:   ${ERC8004_ARC_TESTNET.identityRegistry}`);
console.log(`  ReputationRegistry: ${ERC8004_ARC_TESTNET.reputationRegistry}`);
console.log(`  ValidationRegistry: ${ERC8004_ARC_TESTNET.validationRegistry}`);
console.log();

const samples = [
  "0xA94175a5cA5Ad5c96c96dcbfB97255b9D8683054", // our main wallet (not registered)
  "0x0000000000000000000000000000000000000001", // zero-ish address
] as const;

for (const addr of samples) {
  const identity = await getAgentIdentity(addr as `0x${string}`);
  console.log(
    `  ${addr}: registered=${identity.registered}, tokenCount=${identity.tokenCount}`,
  );
}

console.log(`
[ok] Cadence can now consult ERC-8004 identity inline -- e.g. in
     requirePayment middleware to apply per-identity pricing or trust signals.
`);
