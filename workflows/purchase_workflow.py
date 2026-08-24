"""The durable Purchase-approval workflow.

A session that reaches NEEDS_HUMAN (a >₹15,000 AFA purchase, or low confidence)
must pause — possibly for a long time — until the human approves, but no longer
than the mandate's TTL. Temporal makes both durable: the approval wait and the
TTL timer survive a process restart and resume exactly where they left off, and
the payment activity is idempotent so nothing double-executes across a crash.

Activities are referenced by name so this module stays free of I/O imports (it
runs in Temporal's deterministic workflow sandbox)."""

from __future__ import annotations

from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy

TASK_QUEUE = "paybound-purchase"


@workflow.defn
class PurchaseApprovalWorkflow:
    def __init__(self) -> None:
        self._approved = False

    @workflow.run
    async def run(self, session_id: str, cart_id: str, ttl_seconds: int) -> dict:
        # Durable wait: resume on the human-approval signal, or give up when the
        # mandate's TTL timer fires — whichever comes first.
        try:
            await workflow.wait_condition(
                lambda: self._approved, timeout=timedelta(seconds=ttl_seconds)
            )
        except TimeoutError:
            await workflow.execute_activity(
                "expire_session",
                session_id,
                start_to_close_timeout=timedelta(seconds=30),
            )
            return {"state": "REVOKED", "reason": "mandate_ttl_expired"}

        # Approved -> authorize the payment (idempotent; safe across retries).
        result = await workflow.execute_activity(
            "authorize_payment",
            args=[session_id, cart_id],
            start_to_close_timeout=timedelta(seconds=60),
            retry_policy=RetryPolicy(maximum_attempts=5),
        )
        return {"state": "AUTHORIZED", "checkout": result}

    @workflow.signal
    def approve(self) -> None:
        self._approved = True

    @workflow.query
    def is_approved(self) -> bool:
        return self._approved
