import { describe, it, expect, beforeAll } from "vitest";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AgentClient } from "../src/client/AgentClient.js";
import { buildDomain, CLAIM_TYPES, parseUsdc } from "../src/utils.js";
import { ARC_TESTNET } from "../src/constants.js";
import type { Hex } from "../src/types.js";

/** Deterministic keys for reproducible tests. NOT real funds. */
const TEST_AGENT_PK = "0x0000000000000000000000000000000000000000000000000000000000000001" as Hex;
const TEST_SERVICE = "0x0000000000000000000000000000000000000000000000000000000000000002" as Hex;
const ESCROW_TEST = "0xc95b1b20f91901206ba3ea94bbc7313e7cd82f8d" as Hex;

describe("AgentClient.signClaim", () => {
  let agent: AgentClient;
  beforeAll(() => {
    agent = new AgentClient({ privateKey: TEST_AGENT_PK });
  });

  it("derives expected address from deterministic key", () => {
    // Anvil/Foundry's "test test test..." key #0 isn't this; this is just PK=1 = vitalik-known address
    expect(agent.address).toBe("0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf");
  });

  it("produces a signature with correct format", async () => {
    const claim = await agent.signClaim({
      escrow: ESCROW_TEST,
      service: privateKeyToAccount(TEST_SERVICE).address,
      amount: parseUsdc("0.01"),
      nonce: 42n,
      expirySeconds: 3600,
    });
    expect(claim.signature).toMatch(/^0x[0-9a-fA-F]{130}$/);
    expect(claim.agent).toBe(agent.address);
    expect(claim.amount).toBe(parseUsdc("0.01"));
    expect(claim.nonce).toBe(42n);
  });

  it("signature recovers back to agent.address", async () => {
    const service = privateKeyToAccount(TEST_SERVICE).address;
    const claim = await agent.signClaim({
      escrow: ESCROW_TEST,
      service,
      amount: parseUsdc("0.05"),
      nonce: 100n,
      expirySeconds: 1800,
    });
    const recovered = await recoverTypedDataAddress({
      domain: buildDomain(ESCROW_TEST, ARC_TESTNET.chainId),
      types: CLAIM_TYPES,
      primaryType: "Claim",
      message: {
        agent: claim.agent,
        service: claim.service,
        amount: claim.amount,
        nonce: claim.nonce,
        expiry: claim.expiry,
      },
      signature: claim.signature,
    });
    expect(recovered.toLowerCase()).toBe(agent.address.toLowerCase());
  });

  it("changing amount invalidates signature recovery", async () => {
    const service = privateKeyToAccount(TEST_SERVICE).address;
    const claim = await agent.signClaim({
      escrow: ESCROW_TEST,
      service,
      amount: parseUsdc("0.05"),
      nonce: 200n,
    });
    const recovered = await recoverTypedDataAddress({
      domain: buildDomain(ESCROW_TEST, ARC_TESTNET.chainId),
      types: CLAIM_TYPES,
      primaryType: "Claim",
      message: {
        agent: claim.agent,
        service: claim.service,
        amount: parseUsdc("0.10"), // tampered: doubled
        nonce: claim.nonce,
        expiry: claim.expiry,
      },
      signature: claim.signature,
    });
    expect(recovered.toLowerCase()).not.toBe(agent.address.toLowerCase());
  });

  it("V1 domain sig does NOT recover under V2 domain (cross-version safety)", async () => {
    const service = privateKeyToAccount(TEST_SERVICE).address;
    const account = privateKeyToAccount(TEST_AGENT_PK);
    // Sign with V1 domain explicitly
    const sigV1 = await account.signTypedData({
      domain: buildDomain(ESCROW_TEST, ARC_TESTNET.chainId, "1"),
      types: CLAIM_TYPES,
      primaryType: "Claim",
      message: {
        agent: account.address,
        service,
        amount: parseUsdc("0.01"),
        nonce: 300n,
        expiry: 9999999999n,
      },
    });
    // Recover under V2 domain
    const recovered = await recoverTypedDataAddress({
      domain: buildDomain(ESCROW_TEST, ARC_TESTNET.chainId, "2"),
      types: CLAIM_TYPES,
      primaryType: "Claim",
      message: {
        agent: account.address,
        service,
        amount: parseUsdc("0.01"),
        nonce: 300n,
        expiry: 9999999999n,
      },
      signature: sigV1,
    });
    expect(recovered.toLowerCase()).not.toBe(account.address.toLowerCase());
  });
});
