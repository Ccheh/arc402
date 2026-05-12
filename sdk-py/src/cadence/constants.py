"""Arc network constants and Cadence/Arc402 contract ABI."""

from dataclasses import dataclass


@dataclass(frozen=True)
class ArcChain:
    chain_id: int
    rpc: str
    explorer: str
    usdc: str


ARC_TESTNET = ArcChain(
    chain_id=5042002,
    rpc="https://rpc.testnet.arc.network",
    explorer="https://testnet.arcscan.app",
    usdc="0x3600000000000000000000000000000000000000",
)

# HTTP headers used by the 402 flow.
CLAIM_HEADER = "x-arc402-claim"
REQUIRED_HEADER = "x-arc402-required"

# Minimal ABI for PaymentEscrow V2.
PAYMENT_ESCROW_ABI = [
    {
        "type": "function",
        "name": "deposit",
        "stateMutability": "payable",
        "inputs": [],
        "outputs": [],
    },
    {
        "type": "function",
        "name": "depositFor",
        "stateMutability": "payable",
        "inputs": [{"name": "agent", "type": "address"}],
        "outputs": [],
    },
    {
        "type": "function",
        "name": "withdraw",
        "stateMutability": "nonpayable",
        "inputs": [{"name": "amount", "type": "uint256"}],
        "outputs": [],
    },
    {
        "type": "function",
        "name": "claim",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "agent", "type": "address"},
            {"name": "amount", "type": "uint256"},
            {"name": "nonce", "type": "uint256"},
            {"name": "expiry", "type": "uint256"},
            {"name": "signature", "type": "bytes"},
        ],
        "outputs": [],
    },
    {
        "type": "function",
        "name": "claimBatch",
        "stateMutability": "nonpayable",
        "inputs": [
            {
                "name": "claims",
                "type": "tuple[]",
                "components": [
                    {"name": "agent", "type": "address"},
                    {"name": "amount", "type": "uint256"},
                    {"name": "nonce", "type": "uint256"},
                    {"name": "expiry", "type": "uint256"},
                    {"name": "signature", "type": "bytes"},
                ],
            }
        ],
        "outputs": [],
    },
    {
        "type": "function",
        "name": "balanceOf",
        "stateMutability": "view",
        "inputs": [{"name": "agent", "type": "address"}],
        "outputs": [{"type": "uint256"}],
    },
]

# EIP-712 type definition for a Claim.
CLAIM_EIP712_TYPES = {
    "Claim": [
        {"name": "agent", "type": "address"},
        {"name": "service", "type": "address"},
        {"name": "amount", "type": "uint256"},
        {"name": "nonce", "type": "uint256"},
        {"name": "expiry", "type": "uint256"},
    ],
}
