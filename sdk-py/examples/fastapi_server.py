"""Paid FastAPI endpoint demo using Cadence's Python middleware.

Run:
    pip install cadence-sdk fastapi 'uvicorn[standard]'
    python examples/fastapi_server.py

Then in another shell, an agent can call this with `cadence.AgentClient.fetch()`
which auto-signs on 402 and retries.

What this demonstrates:
    - A FastAPI server with a single paid endpoint (mock LLM completion).
    - `require_payment_fastapi` as a single-line dependency gate.
    - In-memory claim queue + manual flush via /admin/settle.

In production:
    - Replace the mock LLM with a real OpenAI / Anthropic / local model call.
    - Replace the in-memory queue with Redis / DB so claims survive restarts.
    - Replace the /admin/settle route trigger with a periodic worker.
    - Set up monitoring on the queue length so you settle before it grows
      unbounded.
"""

import os
from typing import Any

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel

from cadence import (
    ARC_TESTNET,
    CLAIM_HEADER,
    ClaimAuth,
    parse_usdc,
    require_payment_fastapi,
    settle_batch,
)


# ---------- config ----------

ESCROW = os.environ.get("ESCROW_ADDRESS", "0xc95b1b20f91901206ba3ea94bbc7313e7cd82f8d")
SERVICE_PK = os.environ.get("SERVICE_PRIVATE_KEY")
SERVICE_ADDR = os.environ.get("SERVICE_ADDRESS", "0x0000000000000000000000000000000000000000")
PRICE_PER_CALL = parse_usdc("0.005")

# ---------- in-memory state ----------

claim_queue: list[ClaimAuth] = []


# ---------- payment gate ----------

def _on_verified(claim: ClaimAuth) -> None:
    """Hook called when a claim verifies — queue it for batch settlement."""
    claim_queue.append(claim)


pay = require_payment_fastapi(
    amount=PRICE_PER_CALL,
    escrow=ESCROW,
    service=SERVICE_ADDR,
    chain=ARC_TESTNET,
    on_verified=_on_verified,
)


# ---------- app ----------

app = FastAPI(title="Cadence paid endpoint demo")


class ChatRequest(BaseModel):
    model: str = "demo-llm"
    messages: list[dict[str, Any]] = []


def mock_completion(user_message: str) -> str:
    """Stand-in for a real LLM call. Replace with OpenAI / Anthropic / local."""
    snippet = user_message[:60]
    return (
        f"Acknowledged: '{snippet}'. Served via a paid Cadence endpoint on Arc. "
        f"Your agent wallet was debited {PRICE_PER_CALL} wei "
        f"({PRICE_PER_CALL / 1e18:.6f} USDC); the claim is queued for batch settlement."
    )


@app.post("/v1/chat/completions")
def chat(req: ChatRequest, claim: ClaimAuth = Depends(pay)) -> dict[str, Any]:
    last_user = next(
        (m["content"] for m in reversed(req.messages) if m.get("role") == "user"),
        "(no user message)",
    )
    return {
        "id": f"chatcmpl-cadence-{claim.nonce}",
        "object": "chat.completion",
        "model": req.model,
        "choices": [{
            "index": 0,
            "message": {"role": "assistant", "content": mock_completion(last_user)},
            "finish_reason": "stop",
        }],
        "cadence": {
            "paid_by": claim.agent,
            "amount_wei": claim.amount,
            "queue_position": len(claim_queue),
            "settlement": "queued (batched)",
        },
    }


@app.get("/admin/queue")
def queue_len() -> dict[str, int]:
    return {"pending_claims": len(claim_queue)}


@app.post("/admin/settle")
def flush() -> dict[str, Any]:
    """Manually trigger batch settlement of the queued claims.

    In production this would be a periodic worker, not a route. The /admin
    prefix is a reminder to put auth in front of it.
    """
    if not SERVICE_PK:
        raise HTTPException(
            status_code=500,
            detail="SERVICE_PRIVATE_KEY env var not set on the server",
        )
    if not claim_queue:
        return {"settled": 0, "tx": None}

    pending = list(claim_queue)
    tx_hash = settle_batch(pending, escrow=ESCROW, service_private_key=SERVICE_PK)
    claim_queue.clear()
    return {
        "settled": len(pending),
        "tx": tx_hash,
        "explorer": f"https://testnet.arcscan.app/tx/{tx_hash}",
    }


if __name__ == "__main__":
    import uvicorn  # noqa: T201
    print("[server] paid LLM endpoint demo on :7403")
    print(f"[server] price per call: {PRICE_PER_CALL} wei ({PRICE_PER_CALL / 1e18:.6f} USDC)")
    print(f"[server] escrow: {ESCROW}")
    print(f"[server] service address: {SERVICE_ADDR}")
    print("[server] POST /v1/chat/completions  with x-arc402-claim header")
    print("[server] GET  /admin/queue          to see pending claims")
    print("[server] POST /admin/settle         to batch-settle on chain")
    uvicorn.run(app, host="127.0.0.1", port=7403)
