import { createPublicClient, defineChain, http } from "viem";
import { ARC_TESTNET } from "./constants.js";
import type { ArcChain, Hex } from "./types.js";

/**
 * Canonical ERC-8004 registry deployments on Arc Testnet.
 * All three vanity-prefixed with 0x8004 to encode the EIP number.
 * Source: https://docs.arc.network/arc/tutorials/register-your-first-ai-agent
 */
export const ERC8004_ARC_TESTNET = {
  identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e" as Hex,
  reputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713" as Hex,
  validationRegistry: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272" as Hex,
} as const;

const IDENTITY_REGISTRY_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "string" }],
  },
] as const;

export interface AgentIdentity {
  /** Whether this address owns at least one ERC-8004 identity token */
  registered: boolean;
  /** Number of identity tokens this address owns (typically 0 or 1) */
  tokenCount: number;
}

/**
 * Look up whether a wallet has registered an ERC-8004 agent identity on Arc.
 * Returns `registered: false` if the address has no identity NFT.
 *
 * In a Cadence-paid middleware, you can use this to:
 *   - Show different trust levels for known agents
 *   - Apply per-identity rate limits or pricing
 *   - Skip CAPTCHA for verified-identity agents
 */
export async function getAgentIdentity(
  agentAddress: Hex,
  chain: ArcChain = ARC_TESTNET,
): Promise<AgentIdentity> {
  const viemChain = defineChain({
    id: chain.chainId,
    name: "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [chain.rpc] } },
  });
  const client = createPublicClient({
    chain: viemChain,
    transport: http(chain.rpc, { timeout: 30_000, retryCount: 2 }),
  });

  const balance = await client.readContract({
    address: ERC8004_ARC_TESTNET.identityRegistry,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: "balanceOf",
    args: [agentAddress],
  });

  return {
    registered: balance > 0n,
    tokenCount: Number(balance),
  };
}

