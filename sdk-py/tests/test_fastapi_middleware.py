"""Tests for the FastAPI `require_payment_fastapi` dependency.

Uses fastapi's TestClient + httpx in-memory transport — no live server needed.
"""

import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

fastapi = pytest.importorskip("fastapi")
from fastapi import Depends, FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from cadence import (  # noqa: E402
    AgentClient,
    ARC_TESTNET,
    CLAIM_HEADER,
    REQUIRED_HEADER,
    encode_claim,
    parse_usdc,
    require_payment_fastapi,
)
from cadence.utils import build_domain  # noqa: E402
from cadence.constants import CLAIM_EIP712_TYPES  # noqa: E402
from cadence.types import ClaimAuth  # noqa: E402
from eth_account import Account  # noqa: E402
from eth_account.messages import encode_typed_data  # noqa: E402


AGENT_PK = "0x" + "11" * 32
SERVICE_PK = "0x" + "22" * 32
ESCROW = "0xc95b1b20f91901206ba3ea94bbc7313e7cd82f8d"

AGENT_ADDR = Account.from_key(AGENT_PK).address
SERVICE_ADDR = Account.from_key(SERVICE_PK).address
PRICE = parse_usdc("0.005")


def make_app(queue: list[ClaimAuth] | None = None) -> FastAPI:
    """Build a tiny FastAPI app with one paid endpoint."""
    if queue is None:
        queue = []
    app = FastAPI()

    def _on_verified(claim: ClaimAuth) -> None:
        queue.append(claim)

    pay = require_payment_fastapi(
        amount=PRICE, escrow=ESCROW, service=SERVICE_ADDR,
        chain=ARC_TESTNET, on_verified=_on_verified,
    )

    @app.post("/v1/chat/completions")
    def chat(claim: ClaimAuth = Depends(pay)) -> dict:
        return {
            "ok": True,
            "paid_by": claim.agent,
            "amount": claim.amount,
            "queued": len(queue),
        }

    app.state.queue = queue
    return app


def sign_claim_for_test(
    *,
    amount: int = PRICE,
    service: str = SERVICE_ADDR,
    escrow: str = ESCROW,
    chain_id: int = ARC_TESTNET.chain_id,
    expiry_offset: int = 3600,
    nonce: int = 99,
) -> ClaimAuth:
    expiry = int(time.time()) + expiry_offset
    domain = build_domain(escrow, chain_id)
    full = {
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
            "agent": AGENT_ADDR, "service": service,
            "amount": amount, "nonce": nonce, "expiry": expiry,
        },
    }
    signable = encode_typed_data(full_message=full)
    signed = Account.from_key(AGENT_PK).sign_message(signable)
    sig = signed.signature.hex()
    if not sig.startswith("0x"):
        sig = "0x" + sig
    return ClaimAuth(
        agent=AGENT_ADDR, service=service, amount=amount,
        nonce=nonce, expiry=expiry, signature=sig,
    )


# ---------- 402 challenge / requirements ----------

def test_no_claim_returns_402() -> None:
    client = TestClient(make_app())
    r = client.post("/v1/chat/completions", json={})
    assert r.status_code == 402
    body = r.json()
    assert body["detail"]["error"] == "payment-required"
    assert body["detail"]["requirements"]["escrow"] == ESCROW
    assert body["detail"]["requirements"]["service"] == SERVICE_ADDR
    assert body["detail"]["requirements"]["amount"] == str(PRICE)
    assert REQUIRED_HEADER in r.headers


# ---------- happy path ----------

def test_valid_claim_passes_and_queues() -> None:
    queue: list = []
    app = make_app(queue)
    client = TestClient(app)
    claim = sign_claim_for_test()
    headers = {CLAIM_HEADER: encode_claim(claim)}
    r = client.post("/v1/chat/completions", json={}, headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["paid_by"].lower() == AGENT_ADDR.lower()
    assert body["queued"] == 1
    assert len(queue) == 1
    assert queue[0].nonce == 99


# ---------- malformed ----------

def test_malformed_header_returns_400() -> None:
    client = TestClient(make_app())
    r = client.post("/v1/chat/completions", json={},
                    headers={CLAIM_HEADER: "not-base64-anything"})
    assert r.status_code == 400
    assert r.json()["detail"]["error"] == "malformed-claim"


# ---------- amount mismatch ----------

def test_underpayment_returns_402_with_requirements() -> None:
    client = TestClient(make_app())
    claim = sign_claim_for_test(amount=parse_usdc("0.001"))
    r = client.post(
        "/v1/chat/completions", json={},
        headers={CLAIM_HEADER: encode_claim(claim)},
    )
    assert r.status_code == 402
    assert r.json()["detail"]["error"] == "claim-invalid"
    assert "amount mismatch" in r.json()["detail"]["message"]


# ---------- expired ----------

def test_expired_claim_returns_402() -> None:
    client = TestClient(make_app())
    claim = sign_claim_for_test(expiry_offset=-1)
    r = client.post(
        "/v1/chat/completions", json={},
        headers={CLAIM_HEADER: encode_claim(claim)},
    )
    assert r.status_code == 402
    assert "expired" in r.json()["detail"]["message"]


# ---------- forged signature ----------

def test_wrong_signer_rejected() -> None:
    """Claim says it's from AGENT_ADDR but was signed by a different key."""
    client = TestClient(make_app())
    expiry = int(time.time()) + 3600
    domain = build_domain(ESCROW, ARC_TESTNET.chain_id)
    full = {
        "domain": domain, "primaryType": "Claim",
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
            "agent": AGENT_ADDR, "service": SERVICE_ADDR,
            "amount": PRICE, "nonce": 1, "expiry": expiry,
        },
    }
    signable = encode_typed_data(full_message=full)
    wrong_signer = Account.from_key("0x" + "55" * 32)
    sig = wrong_signer.sign_message(signable).signature.hex()
    if not sig.startswith("0x"):
        sig = "0x" + sig
    forged = ClaimAuth(
        agent=AGENT_ADDR, service=SERVICE_ADDR, amount=PRICE,
        nonce=1, expiry=expiry, signature=sig,
    )
    r = client.post(
        "/v1/chat/completions", json={},
        headers={CLAIM_HEADER: encode_claim(forged)},
    )
    assert r.status_code == 402
    assert "signature recovers to" in r.json()["detail"]["message"]


# ---------- end-to-end with real AgentClient ----------

def test_e2e_with_agent_client() -> None:
    """The Python AgentClient's `sign_claim` must produce a signature the
    server-side middleware accepts. This is the integration test that catches
    drift between agent.py and server.py."""
    queue: list = []
    app = make_app(queue)
    client = TestClient(app)

    agent = AgentClient(private_key=AGENT_PK)
    claim = agent.sign_claim(
        escrow=ESCROW, service=SERVICE_ADDR, amount=PRICE,
    )
    r = client.post(
        "/v1/chat/completions", json={},
        headers={CLAIM_HEADER: encode_claim(claim)},
    )
    assert r.status_code == 200, r.text
    assert len(queue) == 1
    assert queue[0].agent.lower() == agent.address.lower()
