"""Type definitions for Cadence SDK."""

from dataclasses import dataclass


@dataclass
class ClaimAuth:
    """An EIP-712 signed authorization from `agent` to `service` for `amount` USDC."""

    agent: str
    service: str
    amount: int  # wei (18 decimals on Arc)
    nonce: int
    expiry: int
    signature: str  # 0x-prefixed hex

    def to_dict(self) -> dict:
        return {
            "agent": self.agent,
            "service": self.service,
            "amount": str(self.amount),
            "nonce": str(self.nonce),
            "expiry": str(self.expiry),
            "signature": self.signature,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "ClaimAuth":
        return cls(
            agent=d["agent"],
            service=d["service"],
            amount=int(d["amount"]),
            nonce=int(d["nonce"]),
            expiry=int(d["expiry"]),
            signature=d["signature"],
        )
