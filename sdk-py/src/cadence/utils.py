"""Helpers: USDC parsing/formatting (18 decimals!), nonce, claim encoding, EIP-712 domain."""

import base64
import json
import secrets
from decimal import Decimal

from cadence.types import ClaimAuth


def parse_usdc(amount) -> int:
    """Convert a human USDC amount ('0.05' or 1.5) to wei. Arc-USDC has 18 decimals."""
    if isinstance(amount, (int, float)):
        amount = str(amount)
    d = Decimal(amount) * Decimal(10) ** 18
    return int(d)


def format_usdc(wei: int, display_decimals: int = 6) -> str:
    """Wei -> human string truncated to display_decimals."""
    full = Decimal(wei) / Decimal(10) ** 18
    if display_decimals >= 18:
        return f"{full:.18f}".rstrip("0").rstrip(".")
    quantize = Decimal(10) ** -display_decimals
    truncated = full.quantize(quantize)
    return f"{truncated:.{display_decimals}f}"


def random_nonce() -> int:
    """Cryptographically random uint256-fitting nonce."""
    return int.from_bytes(secrets.token_bytes(16), "big")


def build_domain(escrow: str, chain_id: int, version: str = "2") -> dict:
    """EIP-712 domain for the Cadence/Arc402 escrow contract. Defaults to V2."""
    return {
        "name": "Arc402",
        "version": version,
        "chainId": chain_id,
        "verifyingContract": escrow,
    }


def encode_claim(claim: ClaimAuth) -> str:
    """Encode a ClaimAuth into the base64-JSON wire format used in the HTTP header."""
    return base64.b64encode(json.dumps(claim.to_dict()).encode()).decode()


def decode_claim(header_value: str) -> ClaimAuth:
    """Decode a base64-JSON header back into a ClaimAuth (raises on malformed)."""
    raw = json.loads(base64.b64decode(header_value).decode())
    return ClaimAuth.from_dict(raw)
