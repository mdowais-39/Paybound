"""MCP client — the ONLY way the agent touches the merchant. It speaks the
storefront's JSON-RPC MCP surface over HTTP. The agent has no other path to the
catalog, the cart, or (through `checkout`) the money."""

from __future__ import annotations

from typing import Protocol

import requests


class Mcp(Protocol):
    def call_tool(self, name: str, arguments: dict) -> dict: ...


class HttpMcpClient:
    """Talks to the Rust storefront's /mcp endpoint."""

    def __init__(self, base_url: str = "http://localhost:8081"):
        self.endpoint = f"{base_url.rstrip('/')}/mcp"
        self._id = 0

    def _rpc(self, method: str, params: dict | None = None) -> dict:
        self._id += 1
        payload = {"jsonrpc": "2.0", "id": self._id, "method": method}
        if params is not None:
            payload["params"] = params
        resp = requests.post(self.endpoint, json=payload, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        if "error" in data:
            raise RuntimeError(f"MCP error: {data['error']}")
        return data["result"]

    def call_tool(self, name: str, arguments: dict) -> dict:
        result = self._rpc("tools/call", {"name": name, "arguments": arguments})
        if result.get("isError"):
            raise RuntimeError(f"tool '{name}' failed: {result.get('structuredContent')}")
        return result["structuredContent"]
