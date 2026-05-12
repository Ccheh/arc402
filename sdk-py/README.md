# cadence-sdk (Python)

Python SDK for [Cadence](https://github.com/Ccheh/arc402) -- streaming USDC micropayments for AI agents on Arc, built on the open Arc402 protocol.

Mirror of the [TypeScript SDK](../sdk-ts) at parity for the agent-side primitives (`deposit`, `signClaim`, `fetch` with auto 402 retry). Designed for Python AI tooling (LangChain, MCP servers, custom agents) that needs to pay per call in USDC.

## Install

```sh
pip install cadence-sdk    # once published; for now: pip install -e .
```

## Pay a Cadence-protected endpoint in 4 lines

```python
from cadence import AgentClient, parse_usdc

agent = AgentClient(private_key="0x...")
agent.deposit(escrow="0xc95b1b20...82f8d", amount=parse_usdc("1"))   # one-time

response = agent.fetch(
    url="https://api.example.com/v1/chat/completions",
    method="POST",
    json={"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "hi"}]},
)
print(response.json())  # SDK transparently handled the 402 -> sign -> retry
```

## API surface

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
    
    # HTTP with auto 402 retry
    def fetch(self, url, method="GET", headers=None, **kwargs) -> httpx.Response: ...
```

Plus the standalone helpers:
- `parse_usdc("0.05") -> int`  (Arc-USDC is **18 decimals**, not 6)
- `format_usdc(wei, display_decimals=6) -> str`
- `random_nonce() -> int`
- `encode_claim(claim) / decode_claim(header)`
- `build_domain(escrow, chain_id, version="2")`

## Run the demo

```sh
# Start the TypeScript paid LLM endpoint in another shell:
cd ../sdk-ts && npm run demo:server   # or examples/llm-paid-demo.ts

# Then run the Python agent demo:
cd sdk-py && pip install -e .
python examples/agent_demo.py
```

## Differences from TypeScript SDK

| Feature | TS | Py |
|---|---|---|
| AgentClient (deposit / sign / fetch) | ✅ | ✅ |
| Server middleware (`requirePayment`) | ✅ | _(planned -- use Flask/FastAPI when needed)_ |
| Batched settlement helper (`settleBatch`) | ✅ | _(planned)_ |
| Session-key authorization helper | ✅ | _(planned)_ |

## License

[MIT](../LICENSE)
