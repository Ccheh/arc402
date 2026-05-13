"""Tests for the framework-agnostic verifier.

Strategy: use eth_account directly to sign EIP-712 claims (NOT going through
AgentClient — keeps the test independent of the agent code) and verify they
pass / fail the verifier in the expected ways.
"""

import time
from pathlib import Path
import sys

import pytest
from eth_account import Account
from eth_account.messages import encode_typed_data

# Make sure `import cadence` works when running from sdk-py/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from cadence import (  # noqa: E402
    ARC_TESTNET,
    ClaimAuth,
    ClaimVerificationError,
    build_domain,
    parse_usdc,
    verify_claim,
)
from cadence.constants import CLAIM_EIP712_TYPES  # noqa: E402


# fixed deterministic keys for tests (NOT real wallets)
AGENT_PK = "0x" + "11" * 32
SERVICE_PK = "0x" + "22" * 32
ESCROW = "0xc95b1b20f91901206ba3ea94bbc7313e7cd82f8d"

AGENT_ADDR = Account.from_key(AGENT_PK).address
SERVICE_ADDR = Account.from_key(SERVICE_PK).address


def _sign(
    *,
    agent_pk: str = AGENT_PK,
    agent: str = AGENT_ADDR,
    service: str = SERVICE_ADDR,
    amount: int = parse_usdc("0.005"),
    nonce: int = 12345,
    expiry: int = 0,  # 0 = "now + 1 hour"
    escrow: str = ESCROW,
    chain_id: int = ARC_TESTNET.chain_id,
    domain_version: str = "2",
) -> ClaimAuth:
    if expiry == 0:
        expiry = int(time.time()) + 3600
    domain = build_domain(escrow, chain_id, version=domain_version)
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
            "agent": agent,
            "service": service,
            "amount": amount,
            "nonce": nonce,
            "expiry": expiry,
        },
    }
    signable = encode_typed_data(full_message=full)
    signed = Account.from_key(agent_pk).sign_message(signable)
    sig = signed.signature.hex()
    if not sig.startswith("0x"):
        sig = "0x" + sig
    return ClaimAuth(
        agent=agent, service=service, amount=amount,
        nonce=nonce, expiry=expiry, signature=sig,
    )


# ---------- happy path ----------

def test_verify_happy_path() -> None:
    claim = _sign()
    assert verify_claim(
        claim,
        expected_amount=parse_usdc("0.005"),
        expected_escrow=ESCROW,
        expected_service=SERVICE_ADDR,
    ) is True


def test_verify_with_excess_amount_passes() -> None:
    """A claim signed for MORE than the required amount should pass."""
    claim = _sign(amount=parse_usdc("0.01"))
    assert verify_claim(
        claim,
        expected_amount=parse_usdc("0.005"),
        expected_escrow=ESCROW,
        expected_service=SERVICE_ADDR,
    ) is True


def test_verify_is_case_insensitive_for_service() -> None:
    """EIP-712 signatures bind specific address bytes, but the verifier should
    not care about hex case in the service argument."""
    claim = _sign()
    assert verify_claim(
        claim,
        expected_amount=parse_usdc("0.005"),
        expected_escrow=ESCROW,
        expected_service=SERVICE_ADDR.lower(),
    ) is True


# ---------- amount mismatch ----------

def test_verify_underpayment_rejected() -> None:
    claim = _sign(amount=parse_usdc("0.001"))
    with pytest.raises(ClaimVerificationError, match="amount mismatch"):
        verify_claim(
            claim,
            expected_amount=parse_usdc("0.005"),
            expected_escrow=ESCROW,
            expected_service=SERVICE_ADDR,
        )


# ---------- service mismatch ----------

def test_verify_wrong_service_rejected() -> None:
    # Sign the claim as if it were for service X, then verify against service Y.
    claim = _sign(service=SERVICE_ADDR)
    other_service = Account.from_key("0x" + "33" * 32).address
    with pytest.raises(ClaimVerificationError, match="service mismatch"):
        verify_claim(
            claim,
            expected_amount=parse_usdc("0.005"),
            expected_escrow=ESCROW,
            expected_service=other_service,
        )


# ---------- expiry ----------

def test_verify_expired_claim_rejected() -> None:
    claim = _sign(expiry=int(time.time()) - 1)
    with pytest.raises(ClaimVerificationError, match="expired"):
        verify_claim(
            claim,
            expected_amount=parse_usdc("0.005"),
            expected_escrow=ESCROW,
            expected_service=SERVICE_ADDR,
        )


def test_verify_explicit_now_ts_used() -> None:
    """`now_ts` argument lets the caller fix the clock, e.g. for deterministic
    tests."""
    claim = _sign(expiry=1_000_000_500)
    assert verify_claim(
        claim,
        expected_amount=parse_usdc("0.005"),
        expected_escrow=ESCROW,
        expected_service=SERVICE_ADDR,
        now_ts=1_000_000_000,
    ) is True
    with pytest.raises(ClaimVerificationError, match="expired"):
        verify_claim(
            claim,
            expected_amount=parse_usdc("0.005"),
            expected_escrow=ESCROW,
            expected_service=SERVICE_ADDR,
            now_ts=2_000_000_000,
        )


# ---------- signature ----------

def test_verify_forged_signature_rejected() -> None:
    """A claim that claims to be from AGENT_ADDR but was signed by someone else."""
    # Sign with a different private key while claiming AGENT_ADDR as the agent.
    other_pk = "0x" + "44" * 32
    # _sign() signs the typed message; we just override the agent field while
    # keeping the wrong signer. That means the recovered address won't match.
    forged = _sign(agent_pk=other_pk, agent=AGENT_ADDR)
    with pytest.raises(ClaimVerificationError, match="signature recovers to"):
        verify_claim(
            forged,
            expected_amount=parse_usdc("0.005"),
            expected_escrow=ESCROW,
            expected_service=SERVICE_ADDR,
        )


def test_verify_wrong_escrow_rejected() -> None:
    """Cross-domain replay: a claim signed against a different escrow contract
    must not verify against this one."""
    other_escrow = "0x55aFA5Cf28B98DD6DC550F15c075F46B5eaf2a98"
    claim = _sign(escrow=other_escrow)
    with pytest.raises(ClaimVerificationError, match="signature recovers to"):
        verify_claim(
            claim,
            expected_amount=parse_usdc("0.005"),
            expected_escrow=ESCROW,
            expected_service=SERVICE_ADDR,
        )


def test_verify_wrong_chain_rejected() -> None:
    """Cross-chain replay: a claim signed for chainId 1 must not verify for
    Arc Testnet (5042002)."""
    claim = _sign(chain_id=1)
    with pytest.raises(ClaimVerificationError, match="signature recovers to"):
        verify_claim(
            claim,
            expected_amount=parse_usdc("0.005"),
            expected_escrow=ESCROW,
            expected_service=SERVICE_ADDR,
        )


def test_verify_v1_domain_rejected_against_v2() -> None:
    """A V1-domain signature must not validate against a V2 verifier."""
    claim = _sign(domain_version="1")
    with pytest.raises(ClaimVerificationError, match="signature recovers to"):
        verify_claim(
            claim,
            expected_amount=parse_usdc("0.005"),
            expected_escrow=ESCROW,
            expected_service=SERVICE_ADDR,
        )
