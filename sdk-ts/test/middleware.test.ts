import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import type { Express } from "express";
import { privateKeyToAccount } from "viem/accounts";
import { AgentClient } from "../src/client/AgentClient.js";
import { requirePayment } from "../src/server/requirePayment.js";
import { parseUsdc } from "../src/utils.js";
import { CLAIM_HEADER, REQUIRED_HEADER, ARC_TESTNET } from "../src/constants.js";
import { encodeClaim } from "../src/utils.js";
import type { Hex } from "../src/types.js";

const AGENT_PK = "0x0000000000000000000000000000000000000000000000000000000000000003" as Hex;
const SERVICE_PK = "0x0000000000000000000000000000000000000000000000000000000000000004" as Hex;
const ESCROW = "0xc95b1b20f91901206ba3ea94bbc7313e7cd82f8d" as Hex;

const serviceAddr = privateKeyToAccount(SERVICE_PK).address;
let agent: AgentClient;
let app: Express;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  agent = new AgentClient({ privateKey: AGENT_PK });
  app = express();
  app.use(express.json());
  app.get(
    "/paid",
    requirePayment({
      amount: parseUsdc("0.01"),
      escrow: ESCROW,
      service: serviceAddr,
      chain: ARC_TESTNET,
    }),
    (req, res) => {
      res.json({ data: "ok", paidBy: req.arc402Claim?.agent });
    }
  );
  return new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const port = (server.address() as any).port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

describe("requirePayment middleware", () => {
  it("returns 402 with requirements header when no claim", async () => {
    const res = await fetch(`${baseUrl}/paid`);
    expect(res.status).toBe(402);
    const body = (await res.json()) as any;
    expect(body.error).toBe("payment_required");
    expect(body.requirements.escrow.toLowerCase()).toBe(ESCROW.toLowerCase());
    expect(body.requirements.amount).toBe(parseUsdc("0.01").toString());
    expect(res.headers.get(REQUIRED_HEADER)).toBeTruthy();
  });

  it("rejects malformed claim header with 400", async () => {
    const res = await fetch(`${baseUrl}/paid`, {
      headers: { [CLAIM_HEADER]: "not_base64!@#" },
    });
    expect(res.status).toBe(400);
  });

  it("rejects claim signed by wrong service with 402", async () => {
    const wrongService = privateKeyToAccount("0xdead000000000000000000000000000000000000000000000000000000000001" as Hex).address;
    const claim = await agent.signClaim({
      escrow: ESCROW,
      service: wrongService, // mismatch
      amount: parseUsdc("0.01"),
    });
    const res = await fetch(`${baseUrl}/paid`, {
      headers: { [CLAIM_HEADER]: encodeClaim(claim) },
    });
    expect(res.status).toBe(402);
    const body = (await res.json()) as any;
    expect(body.error).toBe("wrong_service");
  });

  it("rejects underpaid claim", async () => {
    const claim = await agent.signClaim({
      escrow: ESCROW,
      service: serviceAddr,
      amount: parseUsdc("0.005"), // less than required 0.01
    });
    const res = await fetch(`${baseUrl}/paid`, {
      headers: { [CLAIM_HEADER]: encodeClaim(claim) },
    });
    expect(res.status).toBe(402);
    const body = (await res.json()) as any;
    expect(body.error).toBe("insufficient_amount");
  });

  it("rejects expired claim", async () => {
    const claim = await agent.signClaim({
      escrow: ESCROW,
      service: serviceAddr,
      amount: parseUsdc("0.01"),
      expirySeconds: -1, // already expired
    });
    const res = await fetch(`${baseUrl}/paid`, {
      headers: { [CLAIM_HEADER]: encodeClaim(claim) },
    });
    expect(res.status).toBe(402);
    const body = (await res.json()) as any;
    expect(body.error).toBe("claim_expired");
  });

  it("rejects forged signature (signed by attacker, claims agent role)", async () => {
    const attacker = new AgentClient({
      privateKey: "0xdead000000000000000000000000000000000000000000000000000000000002" as Hex,
    });
    const realClaim = await attacker.signClaim({
      escrow: ESCROW,
      service: serviceAddr,
      amount: parseUsdc("0.01"),
    });
    // tamper: rewrite agent to victim's address, keep attacker's signature
    const tampered = { ...realClaim, agent: agent.address };
    const res = await fetch(`${baseUrl}/paid`, {
      headers: { [CLAIM_HEADER]: encodeClaim(tampered) },
    });
    expect(res.status).toBe(402);
    const body = (await res.json()) as any;
    expect(body.error).toBe("invalid_signature");
  });

  it("accepts a valid claim and returns 200", async () => {
    const claim = await agent.signClaim({
      escrow: ESCROW,
      service: serviceAddr,
      amount: parseUsdc("0.01"),
    });
    const res = await fetch(`${baseUrl}/paid`, {
      headers: { [CLAIM_HEADER]: encodeClaim(claim) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toBe("ok");
    expect(body.paidBy.toLowerCase()).toBe(agent.address.toLowerCase());
  });
});
