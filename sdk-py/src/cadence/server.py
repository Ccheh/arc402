"""Service-side middleware: verify Cadence claims and gate paid endpoints.

The Python mirror of @arc402/sdk-ts's `requirePayment` middleware. Two
frameworks supported out of the box:

  - **FastAPI** via `require_payment_fastapi(...)` returning a `Depends(...)`-friendly
    callable. This is the recommended path for AI / LLM service developers
    (FastAPI is the dominant Python web framework for ML serving).
  - **Flask** via `require_payment_flask(...)` returning a route decorator.

Both wrap the same pure verifier `verify_claim(...)` which has no web-framework
dependency and can be used directly from any other server (aiohttp, Starlette,
Django, etc.).

Settlement side:
  - `settle_batch(claims, escrow_address, service_key, chain)` submits a
    `claimBatch(Claim[])` tx to PaymentEscrowV2 on Arc. Same wire shape as
    @arc402/sdk-ts's `settleBatch`.
"""

import json
import time
from typing import Any, Callable, Optional

from eth_account import Account
from eth_account.messages import encode_typed_data
from web3 import Web3

from cadence.constants import (
    ARC_TESTNET,
    CLAIM_EIP712_TYPES,
    CLAIM_HEADER,
    PAYMENT_ESCROW_ABI,
    REQUIRED_HEADER,
    ArcChain,
)
from cadence.types import ClaimAuth
from cadence.utils import build_domain, decode_claim


# ---------- pure verifier (framework-agnostic) ----------

class ClaimVerificationError(ValueError):
    """Raised when a presented ClaimAuth fails any verification check."""


def verify_claim(
    claim: ClaimAuth,
    *,
    expected_amount: int,
    expected_escrow: str,
    expected_service: str,
    chain: ArcChain = ARC_TESTNET,
    now_ts: Optional[int] = None,
) -> bool:
    """Verify a ClaimAuth without hitting the chain.

    Checks (in order, raising ClaimVerificationError on first failure):
      1. claim.amount >= expected_amount
      2. claim.service == expected_service (case-insensitive)
      3. claim.expiry > now (no replay of stale claims)
      4. EIP-712 signature recovers to claim.agent

    Does NOT check:
      - On-chain agent escrow balance (settle will revert if insufficient).
      - Nonce uniqueness (settle will revert on replay).

    Returns True on success, raises on failure.
    """
    if now_ts is None:
        now_ts = int(time.time())

    if claim.amount < expected_amount:
        raise ClaimVerificationError(
            f"amount mismatch: claim={claim.amount} < required={expected_amount}",
        )
    if claim.service.lower() != expected_service.lower():
        raise ClaimVerificationError(
            f"service mismatch: claim={claim.service} != expected={expected_service}",
        )
    if claim.expiry <= now_ts:
        raise ClaimVerificationError(
            f"claim expired: expiry={claim.expiry} <= now={now_ts}",
        )

    domain = build_domain(expected_escrow, chain.chain_id)
    full_message: dict[str, Any] = {
        "domain": domain,
        "primaryType": "Claim",
        "types": {
            "EIP712Domain": [
                {"name": "name", "type": "string"},
                {"name": "version", "type": "string"},
                {"name": "chainId", "type": "uint256"},
                {"name": "verifyingContract", "type": "address"},
            ],
            **CLAIM_EIP712_TYPES,
        },
        "message": {
            "agent": claim.agent,
            "service": claim.service,
            "amount": claim.amount,
            "nonce": claim.nonce,
            "expiry": claim.expiry,
        },
    }
    signable = encode_typed_data(full_message=full_message)
    recovered = Account.recover_message(signable, signature=claim.signature)
    if recovered.lower() != claim.agent.lower():
        raise ClaimVerificationError(
            f"signature recovers to {recovered} but claim.agent is {claim.agent}",
        )
    return True


# ---------- FastAPI dependency ----------

def require_payment_fastapi(
    *,
    amount: int,
    escrow: str,
    service: str,
    chain: ArcChain = ARC_TESTNET,
    on_verified: Optional[Callable[[ClaimAuth], None]] = None,
) -> Callable[..., ClaimAuth]:
    """Build a FastAPI dependency that gates an endpoint behind a Cadence
    payment claim. Use as:

        from fastapi import Depends, FastAPI
        from cadence import require_payment_fastapi

        app = FastAPI()
        pay = require_payment_fastapi(amount=parse_usdc("0.005"),
                                       escrow=ESCROW, service=SERVICE_ADDR)

        @app.post("/v1/chat/completions")
        async def chat(claim = Depends(pay)):
            queue.append(claim)
            return {...}

    The dependency raises a FastAPI HTTPException with status 402 if the
    `x-arc402-claim` header is missing/invalid. The response body includes
    `x-arc402-required` style requirements so the agent SDK can auto-sign
    and retry.

    `on_verified` (optional): called with the verified ClaimAuth on success.
    Use this to queue the claim for later batch settlement.
    """
    # FastAPI import is lazy so users without fastapi installed can still
    # import the module and use the framework-agnostic `verify_claim`.
    from fastapi import HTTPException, Request

    def _required_payload() -> dict[str, Any]:
        return {
            "scheme": "arc402",
            "version": "2",
            "chainId": chain.chain_id,
            "escrow": escrow,
            "service": service,
            "amount": str(amount),
        }

    def dep(request: Request) -> ClaimAuth:
        header_value = request.headers.get(CLAIM_HEADER)
        if not header_value:
            raise HTTPException(
                status_code=402,
                detail={"error": "payment-required", "requirements": _required_payload()},
                headers={REQUIRED_HEADER: json.dumps(_required_payload())},
            )
        try:
            claim = decode_claim(header_value)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(
                status_code=400,
                detail={"error": "malformed-claim", "message": str(e)},
            ) from e
        try:
            verify_claim(
                claim,
                expected_amount=amount,
                expected_escrow=escrow,
                expected_service=service,
                chain=chain,
            )
        except ClaimVerificationError as e:
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "claim-invalid",
                    "message": str(e),
                    "requirements": _required_payload(),
                },
                headers={REQUIRED_HEADER: json.dumps(_required_payload())},
            ) from e
        if on_verified is not None:
            on_verified(claim)
        return claim

    return dep


# ---------- Flask decorator ----------

def require_payment_flask(
    *,
    amount: int,
    escrow: str,
    service: str,
    chain: ArcChain = ARC_TESTNET,
    on_verified: Optional[Callable[[ClaimAuth], None]] = None,
) -> Callable[..., Any]:
    """Build a Flask route decorator. Stores the verified ClaimAuth on
    `flask.g.arc402_claim` for the handler to read.

        from flask import Flask, g
        from cadence import require_payment_flask

        app = Flask(__name__)

        @app.route("/v1/chat/completions", methods=["POST"])
        @require_payment_flask(amount=parse_usdc("0.005"),
                                escrow=ESCROW, service=SERVICE_ADDR)
        def chat():
            claim = g.arc402_claim
            queue.append(claim)
            return {...}
    """
    from functools import wraps
    from flask import g, jsonify, request

    def _required_payload() -> dict[str, Any]:
        return {
            "scheme": "arc402",
            "version": "2",
            "chainId": chain.chain_id,
            "escrow": escrow,
            "service": service,
            "amount": str(amount),
        }

    def decorator(handler: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(handler)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            header_value = request.headers.get(CLAIM_HEADER)
            if not header_value:
                resp = jsonify({"error": "payment-required", "requirements": _required_payload()})
                resp.status_code = 402
                resp.headers[REQUIRED_HEADER] = json.dumps(_required_payload())
                return resp
            try:
                claim = decode_claim(header_value)
            except Exception as e:  # noqa: BLE001
                resp = jsonify({"error": "malformed-claim", "message": str(e)})
                resp.status_code = 400
                return resp
            try:
                verify_claim(
                    claim,
                    expected_amount=amount,
                    expected_escrow=escrow,
                    expected_service=service,
                    chain=chain,
                )
            except ClaimVerificationError as e:
                resp = jsonify({
                    "error": "claim-invalid",
                    "message": str(e),
                    "requirements": _required_payload(),
                })
                resp.status_code = 402
                resp.headers[REQUIRED_HEADER] = json.dumps(_required_payload())
                return resp
            if on_verified is not None:
                on_verified(claim)
            g.arc402_claim = claim
            return handler(*args, **kwargs)

        return wrapper

    return decorator


# ---------- settle_batch ----------

def settle_batch(
    claims: list[ClaimAuth],
    *,
    escrow: str,
    service_private_key: str,
    chain: ArcChain = ARC_TESTNET,
) -> str:
    """Submit a `claimBatch(Claim[])` tx to PaymentEscrowV2 on `chain`.
    Returns the tx hash as 0x-prefixed hex.

    Mirrors @arc402/sdk-ts's `settleBatch`.
    """
    if not claims:
        raise ValueError("settle_batch called with empty claims list")
    if not service_private_key.startswith("0x"):
        service_private_key = "0x" + service_private_key

    service_account = Account.from_key(service_private_key)
    w3 = Web3(Web3.HTTPProvider(chain.rpc))
    contract = w3.eth.contract(
        address=Web3.to_checksum_address(escrow),
        abi=PAYMENT_ESCROW_ABI,
    )

    # Pack each claim as the (agent, amount, nonce, expiry, signature) tuple
    # the contract expects.
    packed = []
    for c in claims:
        sig_bytes = bytes.fromhex(c.signature[2:] if c.signature.startswith("0x") else c.signature)
        packed.append((
            Web3.to_checksum_address(c.agent),
            int(c.amount),
            int(c.nonce),
            int(c.expiry),
            sig_bytes,
        ))

    nonce = w3.eth.get_transaction_count(service_account.address)
    tx = contract.functions.claimBatch(packed).build_transaction({
        "from": service_account.address,
        "nonce": nonce,
        "chainId": chain.chain_id,
    })
    signed = service_account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    w3.eth.wait_for_transaction_receipt(tx_hash)
    return tx_hash.hex() if isinstance(tx_hash, bytes) else str(tx_hash)
