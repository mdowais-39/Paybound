"""Small client for driving the durable Purchase-approval workflow from scripts.

  python -m workflows.client start <session_id> <cart_id> <ttl_seconds>   # -> prints WF id
  python -m workflows.client approve <workflow_id>                        # -> signals + prints result
  python -m workflows.client result <workflow_id>                         # -> awaits + prints result
"""

from __future__ import annotations

import asyncio
import os
import sys

from temporalio.client import Client

from workflows.purchase_workflow import TASK_QUEUE, PurchaseApprovalWorkflow


async def _client() -> Client:
    return await Client.connect(os.environ.get("TEMPORAL_ADDRESS", "localhost:7233"))


async def start(session_id: str, cart_id: str, ttl: int) -> None:
    client = await _client()
    wf_id = f"purchase-{session_id}"
    await client.start_workflow(
        PurchaseApprovalWorkflow.run,
        args=[session_id, cart_id, ttl],
        id=wf_id,
        task_queue=TASK_QUEUE,
    )
    print(wf_id)


async def approve(wf_id: str) -> None:
    client = await _client()
    handle = client.get_workflow_handle(wf_id)
    await handle.signal(PurchaseApprovalWorkflow.approve)
    result = await handle.result()
    print(result)


async def result(wf_id: str) -> None:
    client = await _client()
    print(await client.get_workflow_handle(wf_id).result())


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "start":
        asyncio.run(start(sys.argv[2], sys.argv[3], int(sys.argv[4])))
    elif cmd == "approve":
        asyncio.run(approve(sys.argv[2]))
    elif cmd == "result":
        asyncio.run(result(sys.argv[2]))
    else:
        print("usage: start|approve|result ...", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
