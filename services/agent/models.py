"""Typed objects passed between the orchestrator and its workers. Workers return
these structured objects — never free text the orchestrator could misread (the
hand-off contract)."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Intent:
    """The parsed shopping goal. `ambiguous` routes to the Clarification worker."""

    query: str
    max_price_paise: int | None = None
    category: str | None = None
    ambiguous: bool = False
    clarification_question: str | None = None


@dataclass
class Candidate:
    item_id: str
    title: str
    category: str
    price_paise: int
    merchant_id: str | None = None
    score: float = 0.0


@dataclass
class ComposedCart:
    cart_id: str
    total_paise: int
    line_items: list[dict] = field(default_factory=list)
    confidence: float = 1.0
    #: Human-readable line items for display (title + price + category), built
    #: from the real catalog data the composer already had. Kept separate from
    #: `line_items` (the signed cart envelope, which is intentionally minimal).
    display_items: list[dict] = field(default_factory=list)


@dataclass
class OrchestratorResult:
    """The outcome of running one purchase session."""

    state: str  # COMPLETED | REFUSED | NEEDS_HUMAN | CLARIFY | CHOOSE | PRE_CHECK_FAILED | AUTHORIZED
    message: str
    verdict: str | None = None
    rule_cited: str | None = None
    payment_link: str | None = None
    clarification_question: str | None = None
    cart_id: str | None = None
    #: Present only in state=CHOOSE — the candidates a human must pick between
    #: (the agent found more than one plausible match and refuses to guess
    #: which one the human actually wants). Each is {item_id, title, category,
    #: price_paise, merchant_id}. Resolve with POST /sessions/{id}/select.
    options: list[dict] | None = None
    #: The composed cart total in paise (when a cart was built), for display.
    amount_paise: int | None = None
    #: Human-readable cart line items for display (title/price/category), when
    #: a cart was built. Sourced from the real catalog — not fabricated.
    cart: dict | None = None
