"""Cadence Python SDK -- streaming USDC micropayments for AI agents on Arc.

Built on the open Arc402 protocol. Mirror of the TypeScript SDK at
github.com/Ccheh/arc402/tree/main/sdk-ts.
"""

from cadence.agent import AgentClient
from cadence.constants import (
    ARC_TESTNET,
    CLAIM_HEADER,
    PAYMENT_ESCROW_ABI,
    REQUIRED_HEADER,
    ArcChain,
)
from cadence.types import ClaimAuth
from cadence.utils import (
    build_domain,
    decode_claim,
    encode_claim,
    format_usdc,
    parse_usdc,
    random_nonce,
)

__version__ = "0.0.1"

__all__ = [
    "__version__",
    "AgentClient",
    "ARC_TESTNET",
    "ArcChain",
    "ClaimAuth",
    "CLAIM_HEADER",
    "REQUIRED_HEADER",
    "PAYMENT_ESCROW_ABI",
    "build_domain",
    "decode_claim",
    "encode_claim",
    "format_usdc",
    "parse_usdc",
    "random_nonce",
]
