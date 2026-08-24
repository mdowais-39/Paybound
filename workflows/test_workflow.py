"""Deterministic tests for the durable Purchase-approval workflow using
Temporal's time-skipping test server with MOCK activities (no storefront/DB).
Proves the two durable behaviours: approval resumes the purchase; the mandate
TTL timer revokes the authority."""

import asyncio

import pytest
from temporalio import activity
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

from workflows.purchase_workflow import TASK_QUEUE, PurchaseApprovalWorkflow


@activity.defn(name="authorize_payment")
async def mock_authorize(session_id: str, cart_id: str) -> dict:
    return {"verdict": "approved", "payment_link": "https://rzp.io/mock"}


@activity.defn(name="expire_session")
async def mock_expire(session_id: str) -> None:
    return None


async def _run(ttl_seconds: int, approve: bool) -> dict:
    try:
        env = await WorkflowEnvironment.start_time_skipping()
    except Exception as e:  # noqa: BLE001
        pytest.skip(f"Temporal test server unavailable: {e}")
    async with env:
        async with Worker(
            env.client,
            task_queue=TASK_QUEUE,
            workflows=[PurchaseApprovalWorkflow],
            activities=[mock_authorize, mock_expire],
        ):
            handle = await env.client.start_workflow(
                PurchaseApprovalWorkflow.run,
                args=["sess-1", "cart-1", ttl_seconds],
                id=f"wf-{ttl_seconds}-{approve}",
                task_queue=TASK_QUEUE,
            )
            if approve:
                await handle.signal(PurchaseApprovalWorkflow.approve)
            return await handle.result()


def test_human_approval_resumes_the_purchase():
    result = asyncio.run(_run(ttl_seconds=3600, approve=True))
    assert result["state"] == "AUTHORIZED"
    assert result["checkout"]["payment_link"] == "https://rzp.io/mock"


def test_mandate_ttl_expiry_revokes_the_session():
    # No approval -> the durable TTL timer fires (time-skipped) -> REVOKED.
    result = asyncio.run(_run(ttl_seconds=30, approve=False))
    assert result["state"] == "REVOKED"
    assert result["reason"] == "mandate_ttl_expired"
