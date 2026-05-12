"""AgentClient -- the Python counterpart of @arc402/sdk's TypeScript AgentClient.

Provides:
- deposit / withdraw / balance queries
- sign_claim (EIP-712, V2 domain)
- fetch with automatic 402 retry
"""

import time
from typing import Any, Optional

import httpx
from eth_account import Account
from eth_account.messages import encode_typed_data
from web3 import Web3

from cadence.constants import (
    ARC_TESTNET,
    CLAIM_EIP712_TYPES,
    CLAIM_HEADER,
    PAYMENT_ESCROW_ABI,
    ArcChain,
)
from cadence.types import ClaimAuth
from cadence.utils import build_domain, encode_claim, random_nonce


class AgentClient:
    """An agent that can deposit USDC, sign Cadence claims, and call paid endpoints."""

    def __init__(self, private_key: str, chain: ArcChain = ARC_TESTNET):
        if not private_key.startswith("0x"):
            private_key = "0x" + private_key
        self.account = Account.from_key(private_key)
        self.address: str = self.account.address
        self.chain = chain
        self.w3 = Web3(Web3.HTTPProvider(chain.rpc))

    def _contract(self, escrow_address: str):
        return self.w3.eth.contract(
            address=Web3.to_checksum_address(escrow_address),
            abi=PAYMENT_ESCROW_ABI,
        )

    # ---------- on-chain ----------

    def deposit(self, escrow: str, amount: int) -> str:
        contract = self._contract(escrow)
        nonce = self.w3.eth.get_transaction_count(self.address)
        tx = contract.functions.deposit().build_transaction({
            "from": self.address,
            "value": amount,
            "nonce": nonce,
            "chainId": self.chain.chain_id,
        })
        signed = self.account.sign_transaction(tx)
        tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        self.w3.eth.wait_for_transaction_receipt(tx_hash)
        return tx_hash.hex()

    def withdraw(self, escrow: str, amount: int) -> str:
        contract = self._contract(escrow)
        nonce = self.w3.eth.get_transaction_count(self.address)
        tx = contract.functions.withdraw(amount).build_transaction({
            "from": self.address,
            "nonce": nonce,
            "chainId": self.chain.chain_id,
        })
        signed = self.account.sign_transaction(tx)
        tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        self.w3.eth.wait_for_transaction_receipt(tx_hash)
        return tx_hash.hex()

    def balance_in_escrow(self, escrow: str) -> int:
        return self._contract(escrow).functions.balanceOf(self.address).call()

    def wallet_balance(self) -> int:
        return self.w3.eth.get_balance(self.address)

    # ---------- off-chain signing ----------

    def sign_claim(
        self,
        escrow: str,
        service: str,
        amount: int,
        nonce: Optional[int] = None,
        expiry_seconds: int = 3600,
    ) -> ClaimAuth:
        if nonce is None:
            nonce = random_nonce()
        expiry = int(time.time()) + expiry_seconds

        domain = build_domain(escrow, self.chain.chain_id)
        message = {
            "agent": self.address,
            "service": service,
            "amount": amount,
            "nonce": nonce,
            "expiry": expiry,
        }
        full_message = {
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
            "message": message,
        }
        signable = encode_typed_data(full_message=full_message)
        signed = self.account.sign_message(signable)
        sig_hex = signed.signature.hex()
        if not sig_hex.startswith("0x"):
            sig_hex = "0x" + sig_hex

        return ClaimAuth(
            agent=self.address,
            service=service,
            amount=amount,
            nonce=nonce,
            expiry=expiry,
            signature=sig_hex,
        )

    # ---------- HTTP fetch with 402 retry ----------

    def fetch(
        self,
        url: str,
        method: str = "GET",
        headers: Optional[dict] = None,
        timeout: float = 30.0,
        **request_kwargs: Any,
    ) -> httpx.Response:
        """Call a URL. If the server returns 402 with Cadence requirements,
        auto-sign a claim covering the required amount and retry once."""
        hdrs = dict(headers or {})
        first = httpx.request(method=method, url=url, headers=hdrs, timeout=timeout, **request_kwargs)
        if first.status_code != 402:
            return first

        body = first.json()
        reqd = body.get("requirements", {})
        claim = self.sign_claim(
            escrow=reqd["escrow"],
            service=reqd["service"],
            amount=int(reqd["amount"]),
        )
        hdrs[CLAIM_HEADER] = encode_claim(claim)
        return httpx.request(method=method, url=url, headers=hdrs, timeout=timeout, **request_kwargs)
