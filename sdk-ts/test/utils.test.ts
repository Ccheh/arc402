import { describe, it, expect } from "vitest";
import { parseUsdc, formatUsdc, randomNonce, buildDomain, CLAIM_TYPES, encodeClaim, decodeClaim } from "../src/utils.js";
import type { ClaimAuth, Hex } from "../src/types.js";

describe("parseUsdc / formatUsdc (18 decimals)", () => {
  it("parses integer string", () => {
    expect(parseUsdc("1")).toBe(1_000_000_000_000_000_000n);
    expect(parseUsdc("0")).toBe(0n);
  });

  it("parses fractional string", () => {
    expect(parseUsdc("0.01")).toBe(10_000_000_000_000_000n);
    expect(parseUsdc("0.001")).toBe(1_000_000_000_000_000n);
  });

  it("parses number input", () => {
    expect(parseUsdc(1.5)).toBe(1_500_000_000_000_000_000n);
  });

  it("formatUsdc truncates to displayDecimals", () => {
    expect(formatUsdc(parseUsdc("1.234567"))).toBe("1.234567");
    expect(formatUsdc(parseUsdc("1.234567"), 2)).toBe("1.23");
    expect(formatUsdc(parseUsdc("1"), 6)).toBe("1.000000");
  });

  it("round-trip preserves human-readable amounts", () => {
    const samples = ["0", "0.01", "1", "100", "1234.567890"];
    for (const s of samples) {
      const wei = parseUsdc(s);
      const back = formatUsdc(wei, 6);
      // back may have trailing zeros / different precision, just verify parse(back) === wei
      expect(parseUsdc(back)).toBe(wei);
    }
  });

  it("formatUsdc handles zero", () => {
    expect(formatUsdc(0n)).toBe("0.000000");
  });
});

describe("randomNonce", () => {
  it("generates uint256-fitting values", () => {
    const n = randomNonce();
    expect(typeof n).toBe("bigint");
    expect(n).toBeGreaterThanOrEqual(0n);
    expect(n).toBeLessThan(2n ** 256n);
  });

  it("is unlikely to collide across many calls", () => {
    const N = 1000;
    const set = new Set<string>();
    for (let i = 0; i < N; i++) set.add(randomNonce().toString());
    expect(set.size).toBe(N);
  });
});

describe("buildDomain", () => {
  const escrow = "0xc95b1b20f91901206ba3ea94bbc7313e7cd82f8d" as Hex;

  it("defaults to V2 (current)", () => {
    const d = buildDomain(escrow, 5042002);
    expect(d.version).toBe("2");
    expect(d.name).toBe("Arc402");
    expect(d.chainId).toBe(5042002);
    expect(d.verifyingContract).toBe(escrow);
  });

  it("supports explicit V1 for legacy compat", () => {
    expect(buildDomain(escrow, 5042002, "1").version).toBe("1");
  });
});

describe("CLAIM_TYPES (EIP-712 type definition)", () => {
  it("has 5 fields in canonical order", () => {
    const fields = CLAIM_TYPES.Claim.map(f => f.name);
    expect(fields).toEqual(["agent", "service", "amount", "nonce", "expiry"]);
  });

  it("uses correct types", () => {
    const types = CLAIM_TYPES.Claim.map(f => f.type);
    expect(types).toEqual(["address", "address", "uint256", "uint256", "uint256"]);
  });
});

describe("encodeClaim / decodeClaim (wire format)", () => {
  const sample: ClaimAuth = {
    agent: "0xA94175a5cA5Ad5c96c96dcbfB97255b9D8683054" as Hex,
    service: "0xF2745f5ed1Dee216da4D87ce88f24fA93939cd95" as Hex,
    amount: parseUsdc("0.01"),
    nonce: 123456789n,
    expiry: 1778565700n,
    signature:
      "0x432d66c8fac0e66748181809b33a5312a2b0d137d064ec158edfbad97955dedc4bf41e2c766025140d1299f4db82652873bc4c937d9ac692bf736dd9e98e7e281c" as Hex,
  };

  it("round-trips losslessly", () => {
    const encoded = encodeClaim(sample);
    const decoded = decodeClaim(encoded);
    expect(decoded).toEqual(sample);
  });

  it("encodes as base64 of JSON", () => {
    const encoded = encodeClaim(sample);
    expect(encoded).toMatch(/^[A-Za-z0-9+/=]+$/);
    const parsed = JSON.parse(Buffer.from(encoded, "base64").toString());
    expect(parsed.agent).toBe(sample.agent);
    expect(parsed.amount).toBe(sample.amount.toString());
  });

  it("decodeClaim rejects malformed input", () => {
    expect(() => decodeClaim("not_base64!@#")).toThrow();
    expect(() => decodeClaim(Buffer.from("not json").toString("base64"))).toThrow();
  });
});
