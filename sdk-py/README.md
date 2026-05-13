# cadence-sdk (Python)

Python SDK for [Cadence](https://github.com/Ccheh/arc402) — streaming USDC
micropayments for AI agents on Arc, built on the open Arc402 protocol.

Parity with the [TypeScript SDK](../sdk-ts) on agent-side (`deposit`,
`sign_claim`, `fetch` with auto-402 retry) **and** service-side
(`require_payment_fastapi`, `require_payment_flask`, `verify_claim`,
`settle_batch`). Designed for the Python AI/ML stack — FastAPI for
serving, LangChain / MCP servers for agent code.

[![tests](https://img.shields.io/badge/pytest-18%2F18%20passing-success)](#)
[![python](https://img.shields.io/badge/python-3.10%2B-blue)](#)

## Install

```sh
pip install cadence-sdk           # once published
# or, for now:
pip install -e .[dev]              # editable, with pytest
pip install fastapi httpx          # if using the FastAPI middleware
```

## Pay a Cadence-protected endpoint (agent side, 4 lines)

```python
from cadence import AgentClient, parse_usdc

agent = AgentClient(private_key="0x...")
agent.deposit(escrow="0xc95b1b20...82f8d", amount=parse_usdc("1"))   # one-time

response = agent.fetch(
    url="https://api.example.com/v1/chat/completions",
    method="POST",
    json={"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "hi"}]},
)
print(response.json())  # SDK transparently handled the 402 → sign → retry
```

## Sell a Cadence-paid endpoint (service side, FastAPI)

```python
from fastapi import Depends, FastAPI
from cadence import (
    ARC_TESTNET, parse_usdc, require_payment_fastapi, settle_batch,
)

ESCROW = "0xc95b1b20...82f8d"
SERVICE_ADDR = "0xservice..."
PRICE = parse_usdc("0.005")

claim_queue = []

pay = require_payment_fastapi(
    amount=PRICE,
    escrow=ESCROW,
    service=SERVICE_ADDR,
    chain=ARC_TESTNET,
    on_verified=claim_queue.append,    # queue for batch settlement
)

app = FastAPI()

@app.post("/v1/chat/completions")
def chat(claim = Depends(pay)):
    return {"reply": "Hello, paid agent!", "queued_claims": len(claim_queue)}
```

When the queue is large enough (or on a cron), flush in one tx:

```python
tx = settle_batch(
    claim_queue, escrow=ESCROW,
    service_private_key=SERVICE_PK, chain=ARC_TESTNET,
)
claim_queue.clear()
print(f"Settled {len(claim_queue)} claims: https://testnet.arcscan.app/tx/{tx}")
```

A full runnable FastAPI example is at
[`examples/fastapi_server.py`](examples/fastapi_server.py).

## API surface

### Agent side

```python
class AgentClient:
    def __init__(self, private_key: str, chain: ArcChain = ARC_TESTNET): ...

    # on-chain
    def deposit(self, escrow: str, amount: int) -> str: ...
    def withdraw(self, escrow: str, amount: int) -> str: ...
    def balance_in_escrow(self, escrow: str) -> int: ...
    def wallet_balance(self) -> int: ...

    # off-chain signing
    def sign_claim(self, escrow, service, amount, nonce=None, expiry_seconds=3600) -> ClaimAuth: ...

    # HTTP with auto-402 retry
    def fetch(self, url, method="GET", headers=None, **kwargs) -> httpx.Response: ...
```

### Service side

```python
# Pure verifier — framework-agnostic
def verify_claim(claim: ClaimAuth, *, expected_amount, expected_escrow,
                 expected_service, chain=ARC_TESTNET, now_ts=None) -> bool: ...

# FastAPI dependency
def require_payment_fastapi(*, amount, escrow, service,
                            chain=ARC_TESTNET, on_verified=None) -> Callable: ...

# Flask decorator
def require_payment_flask(*, amount, escrow, service,
                          chain=ARC_TESTNET, on_verified=None) -> Callable: ...

# On-chain batch settlement
def settle_batch(claims: list[ClaimAuth], *, escrow: str,
                 service_private_key: str, chain=ARC_TESTNET) -> str: ...
```

### Shared helpers

- `parse_usdc("0.05") -> int`   (Arc-USDC is **18 decimals**, not 6)
- `format_usdc(wei, display_decimals=6) -> str`
- `random_nonce() -> int`
- `encode_claim(claim) / decode_claim(header)`
- `build_domain(escrow, chain_id, version="2")`

## Run the demos

### End-to-end (Python service + Python agent)

```sh
# Terminal A — start the paid FastAPI server
pip install -e . fastapi 'uvicorn[standard]'
ESCROW_ADDRESS=0x... SERVICE_ADDRESS=0x... python examples/fastapi_server.py

# Terminal B — agent makes paid calls
python examples/agent_demo.py        # uses cadence.AgentClient.fetch()
```

### Cross-stack (Python agent + TypeScript service)

```sh
# Terminal A — TypeScript paid LLM endpoint
cd ../sdk-ts && npm install
npx tsx examples/llm-paid-demo.ts

# Terminal B — Python agent
cd sdk-py && python examples/agent_demo.py
```

The two SDKs share the same on-chain protocol (EIP-712 V2 domain on Arc
Testnet), so Python agents can pay TypeScript-written services and vice
versa — no compatibility work needed.

## Tests

```sh
pytest tests/ -v
```

18 tests cover:
- Happy path for `verify_claim` (signature recovers correctly)
- Amount mismatch, service mismatch, expired claim — all rejected
- Forged signature, wrong escrow, wrong chain, V1-vs-V2 domain — all rejected
- FastAPI dependency: 402 challenge, 400 on malformed, 402 on under/expired/forged
- End-to-end: AgentClient sign → FastAPI middleware verify → handler runs

## Feature parity with the TypeScript SDK

| Feature | TS | Py |
|---|---|---|
| AgentClient (deposit / sign / fetch) | ✅ | ✅ |
| Server middleware (`require_payment_*`) | ✅ Express | ✅ FastAPI + Flask |
| Pure verifier (`verifyClaim` / `verify_claim`) | ✅ | ✅ |
| Batched settlement (`settleBatch` / `settle_batch`) | ✅ | ✅ |
| Session-key authorization helper | ✅ | _(planned)_ |

## License

[MIT](../LICENSE)
