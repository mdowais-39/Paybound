"""Campaign rule-engine tests — deterministic, no DB/LLM. The engine is a pure
function over data (a fake mcp for catalog reads, plain dicts for the mandate
and agent_run history, and an explicit `now`), so every rule and every guard is
exercised in isolation — same style as test_cart_composer.py."""

from datetime import UTC, datetime, timedelta

from services.agent.workers.cart_composer import CartComposer
from services.campaign.engine import CampaignEngine
from services.upsell.model import UpsellModel

NOW = datetime(2026, 8, 28, 12, 0, tzinfo=UTC)
FUTURE_TTL = int((NOW + timedelta(hours=1)).timestamp())

SHOE = {"item_id": "shoe-1", "title": "Trail Runner", "category": "shoes",
        "price_paise": 285000, "merchant_id": "m1"}
SPORT = {"item_id": "sport-1", "title": "Running Belt", "category": "sporting goods",
         "price_paise": 45000, "merchant_id": "m1"}
ITEMS = {SHOE["item_id"]: SHOE, SPORT["item_id"]: SPORT}


class FakeMcp:
    """get_availability resolves a known item by id; search_catalog returns
    whatever `search_results` maps the query to (empty = 'nothing in stock')."""

    def __init__(self, search_results: dict | None = None):
        self.search_results = search_results or {}
        self.calls: list[str] = []

    def call_tool(self, name: str, args: dict) -> dict:
        self.calls.append(name)
        if name == "get_availability":
            return {**ITEMS[args["item_id"]], "available": True}
        if name == "search_catalog":
            return {"items": self.search_results.get(args["query"], [])}
        raise AssertionError(f"unexpected tool {name}")


def _engine(search_results: dict | None = None) -> CampaignEngine:
    mcp = FakeMcp(search_results)
    upsell = UpsellModel(category_complements={"shoes": ["sporting goods"]})
    composer = CartComposer(mcp, upsell=upsell)
    return CampaignEngine(composer, mcp)


def mandate(**over) -> dict:
    base = {
        "mandate_id": "m1",
        "budget_total_paise": 1_000_000,
        "per_txn_cap_paise": 1_000_000,
        "allowed_categories": [],  # unrestricted
        "allowed_merchants": [],
        "ttl_unix": FUTURE_TTL,
        "nl_goal": "shop",
    }
    base.update(over)
    return base


def run(state: str, item: dict, created_at: datetime, is_upsell: bool = False) -> dict:
    return {
        "state": state,
        "created_at": created_at,
        "result_json": {"cart": {"line_items": [
            {"item_id": item["item_id"], "category": item["category"],
             "price_paise": item["price_paise"], "is_upsell": is_upsell},
        ]}},
    }


# --- Rule A: complete the set (cross-sell) --------------------------------

def test_complete_the_set_fires_reusing_find_upsell():
    engine = _engine({"sporting goods": [SPORT]})
    runs = [run("AUTHORIZED", SHOE, NOW)]
    offer = engine.evaluate(mandate(), 0, runs, NOW)
    assert offer is not None
    assert offer.campaign_type == "complete_the_set"
    assert offer.suggested_goal == "buy sporting goods"
    assert offer.category == "sporting goods"
    assert "Running Belt" in offer.reason


def test_complete_the_set_suppressed_when_category_already_bought():
    """If the customer has already bought the complement category before, don't
    nudge it again — and the most recent purchase is fresh, so win-back stays
    silent too."""
    engine = _engine({"sporting goods": [SPORT]})
    runs = [run("AUTHORIZED", SHOE, NOW), run("COMPLETED", SPORT, NOW - timedelta(days=1))]
    assert engine.evaluate(mandate(), 0, runs, NOW) is None


def test_complete_the_set_does_not_re_propose_a_dismissed_item():
    """The 24h cooldown alone blocks a fresh nudge of ANY kind — this guards
    the sharper thing: don't re-offer the SAME item once it's been explicitly
    declined, even after the cooldown has passed. Falls through to win-back
    (silent here, since the purchase is fresh) rather than returning nothing."""
    engine = _engine({"sporting goods": [SPORT]})
    runs = [run("AUTHORIZED", SHOE, NOW)]
    assert engine.evaluate(mandate(), 0, runs, NOW, dismissed_item_ids={SPORT["item_id"]}) is None
    # Without the exclusion, the same setup DOES fire — proves the guard is real.
    assert engine.evaluate(mandate(), 0, runs, NOW) is not None


# --- Rule B: win-back ------------------------------------------------------

def test_win_back_fires_past_the_threshold():
    # No complement in stock (empty search) so Rule A can't fire — isolates B.
    engine = _engine({})
    runs = [run("COMPLETED", SHOE, NOW - timedelta(days=20))]
    offer = engine.evaluate(mandate(), 0, runs, NOW)
    assert offer is not None
    assert offer.campaign_type == "win_back"
    assert offer.suggested_goal == "buy shoes"


def test_win_back_silent_before_the_threshold():
    engine = _engine({})
    runs = [run("COMPLETED", SHOE, NOW - timedelta(days=2))]
    assert engine.evaluate(mandate(), 0, runs, NOW) is None


def test_win_back_does_not_re_propose_a_dismissed_category():
    """Same guard as complete_the_set's dismissed-item exclusion, but for
    win-back's category. Only one category in history, so once it's excluded
    there's no second-choice candidate left — the offer is None, not a retry
    of the same category."""
    engine = _engine({})
    runs = [run("COMPLETED", SHOE, NOW - timedelta(days=20))]
    assert (
        engine.evaluate(mandate(), 0, runs, NOW, dismissed_categories={SHOE["category"]})
        is None
    )
    # Without the exclusion, the same setup DOES fire — proves the guard is real.
    assert engine.evaluate(mandate(), 0, runs, NOW) is not None


def test_win_back_falls_back_to_the_next_ranked_category_when_top_is_dismissed():
    """When multiple categories exist, dismissing the top-ranked one still
    lets a real second-choice category through, instead of giving up entirely."""
    engine = _engine({})
    runs = [
        run("COMPLETED", SHOE, NOW - timedelta(days=20)),
        run("COMPLETED", SHOE, NOW - timedelta(days=25)),
        run("COMPLETED", SPORT, NOW - timedelta(days=30)),
    ]
    offer = engine.evaluate(mandate(), 0, runs, NOW, dismissed_categories={"shoes"})
    assert offer is not None
    assert offer.category == "sporting goods"


# --- Bound re-checks -------------------------------------------------------

def test_no_offer_when_budget_is_exhausted():
    engine = _engine({"sporting goods": [SPORT]})
    runs = [run("AUTHORIZED", SHOE, NOW)]
    # running_spend == budget → zero remaining headroom.
    assert engine.evaluate(mandate(), 1_000_000, runs, NOW) is None


def test_no_offer_when_mandate_expired():
    engine = _engine({"sporting goods": [SPORT]})
    runs = [run("AUTHORIZED", SHOE, NOW)]
    past_ttl = int((NOW - timedelta(hours=1)).timestamp())
    assert engine.evaluate(mandate(ttl_unix=past_ttl), 0, runs, NOW) is None


def test_no_offer_without_a_completed_purchase():
    engine = _engine({"sporting goods": [SPORT]})
    runs = [run("REFUSED", SHOE, NOW)]
    assert engine.evaluate(mandate(), 0, runs, NOW) is None
