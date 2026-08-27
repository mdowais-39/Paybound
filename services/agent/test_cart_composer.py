"""CartComposer upsell tests — deterministic, no trained artifact required (a
small UpsellModel is constructed directly). These guard the specific bug fixed
here: an UNRESTRICTED mandate (empty/absent allowed_categories, the current
default) must still be eligible for an upsell — empty means "no restriction",
the same convention the Rust kernel uses, not "nothing is allowed"."""

from services.agent.models import Candidate, Intent
from services.agent.workers.cart_composer import CartComposer
from services.upsell.model import UpsellModel


class FakeMcp:
    """search_catalog returns query-specific results; create_cart totals the
    chosen items from `catalog`."""

    def __init__(self, catalog: dict[str, list[dict]]):
        # catalog: query string -> list of item dicts
        self.catalog = catalog
        self.calls: list[str] = []

    def call_tool(self, name: str, arguments: dict) -> dict:
        self.calls.append(name)
        if name == "search_catalog":
            return {"items": self.catalog.get(arguments["query"], [])}
        if name == "create_cart":
            # The chosen item itself was never returned via search_catalog in
            # this fake (it's passed directly as `chosen`), so fall back to its
            # known price for any item_id not found among the complement hits.
            all_items = {it["item_id"]: it for items in self.catalog.values() for it in items}
            total = sum(
                all_items[i["item_id"]]["price_paise"] if i["item_id"] in all_items else SHOE.price_paise
                for i in arguments["items"]
            )
            return {"cart_id": "cart-1", "total_paise": total,
                    "line_items": [{"item_id": i["item_id"], "qty": 1} for i in arguments["items"]]}
        raise AssertionError(f"unexpected tool {name}")


SHOE = Candidate(item_id="shoe-1", title="Trail Runner", category="shoes",
                  price_paise=285000, merchant_id="m1")
SPORT = {"item_id": "sport-1", "title": "Running Belt", "category": "sporting goods",
         "price_paise": 45000, "merchant_id": "m1"}
CATALOG = {"sporting goods": [SPORT]}


def _composer() -> CartComposer:
    mcp = FakeMcp(CATALOG)
    upsell = UpsellModel(category_complements={"shoes": ["sporting goods"]})
    return CartComposer(mcp, upsell=upsell), mcp


def test_unrestricted_mandate_still_gets_an_upsell():
    """The regression: an empty allow-list (marketplace-wide mandate, the
    default since the single-merchant-default fix) used to disable upsell
    entirely instead of meaning 'any category qualifies'."""
    composer, mcp = _composer()
    cart = composer.compose("sess-1", SHOE, Intent(query="running shoes"), allowed_categories=[])
    assert len(cart.display_items) == 2
    assert cart.display_items[1]["category"] == "sporting goods"
    assert cart.total_paise == 285000 + 45000


def test_none_allowed_categories_also_gets_an_upsell():
    composer, mcp = _composer()
    cart = composer.compose("sess-1", SHOE, Intent(query="running shoes"), allowed_categories=None)
    assert len(cart.display_items) == 2


def test_mandate_scoped_away_from_the_complement_excludes_it():
    """When the mandate DOES restrict categories and the complement isn't in
    the allow-list, it must still be excluded — the fix only changes what an
    EMPTY list means, not the scoping check itself."""
    composer, mcp = _composer()
    cart = composer.compose(
        "sess-1", SHOE, Intent(query="running shoes"), allowed_categories=["shoes"]
    )
    assert len(cart.display_items) == 1


def test_mandate_that_explicitly_allows_the_complement_includes_it():
    composer, mcp = _composer()
    cart = composer.compose(
        "sess-1", SHOE, Intent(query="running shoes"),
        allowed_categories=["shoes", "sporting goods"],
    )
    assert len(cart.display_items) == 2
