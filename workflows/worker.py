"""The Temporal worker: hosts the Purchase-approval workflow + its activities.
Kill it and restart it mid-session — the workflow's durable state lives in the
Temporal server, so it resumes exactly where it was.

Run: python -m workflows.worker
"""

from __future__ import annotations

import asyncio
import os
from concurrent.futures import ThreadPoolExecutor

from temporalio.client import Client
from temporalio.worker import Worker

from .activities import authorize_payment, expire_session
from .purchase_workflow import TASK_QUEUE, PurchaseApprovalWorkflow


async def main() -> None:
    client = await Client.connect(os.environ.get("TEMPORAL_ADDRESS", "localhost:7233"))
    # The activities are synchronous (requests/psycopg), so run them in a thread pool.
    with ThreadPoolExecutor(max_workers=8) as executor:
        worker = Worker(
            client,
            task_queue=TASK_QUEUE,
            workflows=[PurchaseApprovalWorkflow],
            activities=[authorize_payment, expire_session],
            activity_executor=executor,
        )
        await _run(worker)


async def _run(worker: Worker) -> None:
    print(f"worker started on task queue '{TASK_QUEUE}'", flush=True)
    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())
