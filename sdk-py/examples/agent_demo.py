"""End-to-end demo: a Python agent pays a Cadence-protected endpoint.

Prereqs:
- Server side: Express service running examples/llm-paid-demo.ts (or similar) in sdk-ts/
- .env at project root with PRIVATE_KEY, ESCROW_V2_ADDRESS

Run:
    cd sdk-py
    pip install -e .
    python examples/agent_demo.py
"""

import os
from pathlib import Path

from cadence import AgentClient, format_usdc, parse_usdc

# Minimal .env loader (we don't pull in python-dotenv).
ENV_PATH = Path(__file__).parent.parent.parent / ".env"
for line in ENV_PATH.read_text().splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, _, val = line.partition("=")
    os.environ.setdefault(key.strip(), val.strip())

PK = os.environ["PRIVATE_KEY"]
ESCROW = os.environ["ESCROW_V2_ADDRESS"]
ENDPOINT = os.environ.get("CADENCE_DEMO_ENDPOINT", "http://127.0.0.1:7403/v1/chat/completions")

agent = AgentClient(private_key=PK)
print(f"Agent address: {agent.address}")
print(f"Wallet balance: {format_usdc(agent.wallet_balance())} USDC")
print(f"Escrow balance: {format_usdc(agent.balance_in_escrow(ESCROW))} USDC")

# Top up if escrow is low.
if agent.balance_in_escrow(ESCROW) < parse_usdc("0.05"):
    print(f"\nEscrow < 0.05 -- depositing 0.1 USDC...")
    tx = agent.deposit(ESCROW, parse_usdc("0.1"))
    print(f"  deposit tx: {tx}")

# Make a paid call.
print(f"\nCalling {ENDPOINT} ...")
response = agent.fetch(
    url=ENDPOINT,
    method="POST",
    headers={"Content-Type": "application/json"},
    json={
        "model": "gpt-4o-mini",
        "messages": [{"role": "user", "content": "Hello from a Python agent paid via Cadence."}],
    },
)
print(f"  status: {response.status_code}")
body = response.json()
if response.status_code == 200:
    print(f"  reply : {body['choices'][0]['message']['content'][:120]}")
    print(f"  paid  : {body.get('cadence', {}).get('paid_amount_usdc')} USDC")
else:
    print(f"  body  : {body}")

print(f"\nEscrow after: {format_usdc(agent.balance_in_escrow(ESCROW))} USDC")
