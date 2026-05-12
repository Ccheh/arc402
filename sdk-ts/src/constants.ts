import type { ArcChain } from "./types.js";

export const ARC_TESTNET: ArcChain = {
  chainId: 5042002,
  rpc: "https://rpc.testnet.arc.network",
  explorer: "https://testnet.arcscan.app",
  usdc: "0x3600000000000000000000000000000000000000",
};

/** HTTP header carrying a base64-encoded ClaimAuthWire. */
export const CLAIM_HEADER = "x-arc402-claim";

/** HTTP header carrying PaymentRequirements (set on 402 responses). */
export const REQUIRED_HEADER = "x-arc402-required";

export const PAYMENT_ESCROW_ABI = [
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
  {
    type: "function", name: "depositFor", stateMutability: "payable",
    inputs: [{ name: "agent", type: "address" }], outputs: [],
  },
  {
    type: "function", name: "withdraw", stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }], outputs: [],
  },
  {
    type: "function", name: "claim", stateMutability: "nonpayable",
    inputs: [
      { name: "agent", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "expiry", type: "uint256" },
      { name: "signature", type: "bytes" },
    ], outputs: [],
  },
  {
    type: "function", name: "claimBatch", stateMutability: "nonpayable",
    inputs: [{
      name: "claims", type: "tuple[]",
      components: [
        { name: "agent", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "expiry", type: "uint256" },
        { name: "signature", type: "bytes" },
      ],
    }], outputs: [],
  },
  {
    type: "function", name: "authorizeSession", stateMutability: "nonpayable",
    inputs: [
      { name: "sessionKey", type: "address" },
      { name: "expiry", type: "uint64" },
    ], outputs: [],
  },
  {
    type: "function", name: "balanceOf", stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }], outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "isNonceUsed", stateMutability: "view",
    inputs: [
      { name: "agent", type: "address" },
      { name: "service", type: "address" },
      { name: "nonce", type: "uint256" },
    ], outputs: [{ type: "bool" }],
  },
  { type: "error", name: "NonceAlreadyUsed", inputs: [] },
  { type: "error", name: "ClaimExpired", inputs: [] },
  { type: "error", name: "InvalidSignature", inputs: [] },
  { type: "error", name: "ZeroAmount", inputs: [] },
  { type: "error", name: "InsufficientBalance", inputs: [] },
  { type: "error", name: "SessionExpiredOrUnknown", inputs: [] },
  { type: "error", name: "EmptyBatch", inputs: [] },
  { type: "error", name: "TransferFailed", inputs: [] },
] as const;
