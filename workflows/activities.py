"""Temporal activities — the side-effecting steps the durable Purchase workflow
invokes. Activities run OUTSIDE the workflow sandbox, so they may do I/O.

Both are safe to re-run after a crash:
  - authorize_payment goes through the idempotent execution plane (ON CONFLICT),
    so a retry never creates a second payment link or a double charge.
  - expire_session only transitions a session still in NEEDS_HUMAN."""

from __future__ import annotations

import os

from services.agent.mcp_client import HttpMcpClient
from temporalio import activity


@activity.defn
def authorize_payment(session_id: str, cart_id: str) -> dict:
    """Resume after human approval: checkout with afa_approved=True (clears the
    AFA gate). The execution plane creates the payment link idempotently."""
    mcp = HttpMcpClient(os.environ.get("STOREFRONT_URL", "http://localhost:8081"))
    return mcp.call_tool(
        "checkout", {"session_id": session_id, "cart_id": cart_id, "afa_approved": True}
    )


@activity.defn
def expire_session(session_id: str) -> None:
    """The mandate's TTL fired before approval — end the authority (REVOKED)."""
    import psycopg

    dsn = (os.environ.get("DATABASE_URL", "")).replace("postgres://", "postgresql://", 1)
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE purchase_session SET state='REVOKED', updated_at=now() "
            "WHERE session_id=%s AND state='NEEDS_HUMAN'",
            (session_id,),
        )
        conn.commit()
