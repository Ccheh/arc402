"""LangChain integration example -- wrap any Cadence-protected API as a LangChain Tool.

This shows how an AI agent built with LangChain can pay USDC per call to use
external paid APIs (search, LLMs, oracles, etc.) protected by Cadence.

Prereqs:
    pip install cadence-sdk langchain langchain-openai
    Set CADENCE_PK and ANTHROPIC_API_KEY (or OpenAI) in env.

The agent below has access to a paid `cadence_search` tool. Every time the LLM
decides to call it, the Cadence SDK transparently handles the 402 -> sign
EIP-712 claim -> retry flow under the hood.

For a real run, point CADENCE_DEMO_ENDPOINT at a live Cadence-protected service
(the sdk-ts/examples/llm-paid-demo.ts server works as a test target).
"""

import os

from cadence import AgentClient, format_usdc, parse_usdc

# ---------- 1. Set up the Cadence-paying agent (one-time, at startup) ----------

agent = AgentClient(private_key=os.environ["CADENCE_PK"])
ESCROW = os.environ["ESCROW_V2_ADDRESS"]
ENDPOINT = os.environ.get("CADENCE_DEMO_ENDPOINT", "http://127.0.0.1:7403/v1/chat/completions")

# Top up the agent's escrow if needed (call once during deployment).
if agent.balance_in_escrow(ESCROW) < parse_usdc("0.10"):
    print(f"Topping up agent escrow with 0.5 USDC...")
    agent.deposit(ESCROW, parse_usdc("0.5"))
print(f"Agent has {format_usdc(agent.balance_in_escrow(ESCROW))} USDC in escrow.\n")

# ---------- 2. Define the LangChain tool ----------

try:
    from langchain.agents import AgentExecutor, create_tool_calling_agent
    from langchain_core.prompts import ChatPromptTemplate
    from langchain_core.tools import tool

    @tool
    def cadence_search(query: str) -> str:
        """Search the web via a paid Cadence-protected API.

        Cost: 0.005 USDC per call. Payment is automatic; the agent's escrow
        is debited on each invocation.
        """
        response = agent.fetch(
            url=ENDPOINT,
            method="POST",
            headers={"Content-Type": "application/json"},
            json={
                "model": "search",
                "messages": [{"role": "user", "content": f"Search: {query}"}],
            },
        )
        if response.status_code != 200:
            return f"Search failed: HTTP {response.status_code}"
        body = response.json()
        return body["choices"][0]["message"]["content"]

    # ---------- 3. Wire into a LangChain agent ----------

    print("LangChain tool registered:")
    print(f"  name: {cadence_search.name}")
    print(f"  description: {cadence_search.description}\n")

    # Direct call (without an LLM in the loop, for demo purposes):
    print("Direct tool call demo (skipping LLM)...")
    result = cadence_search.invoke({"query": "latest Arc network releases"})
    print(f"  Result: {result[:200]}...\n")
    print(f"  Agent escrow after: {format_usdc(agent.balance_in_escrow(ESCROW))} USDC")

except ImportError:
    print(
        "[skipped] LangChain not installed -- pip install langchain langchain-core "
        "to enable the LLM-driven agent example.\n"
        "\nThe Cadence-paid tool function itself is defined above; in a real "
        "LangChain setup you'd add it to your `AgentExecutor.from_agent_and_tools(...)` "
        "call. Every time the LLM picks this tool, Cadence handles the 402 -> "
        "sign claim -> retry flow under the hood -- LangChain code stays clean."
    )
