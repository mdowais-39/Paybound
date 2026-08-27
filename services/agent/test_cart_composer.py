"""CartComposer tests — deterministic, no trained artifact required (a small
UpsellModel is constructed directly).

Two things are guarded here:
  1. The regression fixed earlier: an UNRESTRICTED mandate (empty/absent
     allowed_categories, the current default) must still be eligible for a
     proposed upsell — empty means "no restriction", the same convention the
     Rust kernel uses, not "nothing is allowed".
  2. The human-decides split: `find_upsell` only PROPOSES a complement — it
     never touches the cart. `compose` only adds one when the caller
     explicitly passes back `addon_item_id` (i.e. the human accepted it via
     POST /sessions/{id}/upsell). Composing without that argument must never
     silently include a complement, even when one is available."""

from services.agent.models import Candidate, Intent
from services.agent.workers.cart_composer import CartComposer
from services.upsell.model import UpsellModel


class FakeMcp:
    """search_catalog / get_availability return query- or id-specific results;
    create_cart totals the requested items from `catalog`."""

    def __init__(self, catalog: dict[str, list[dict]]):
        # catalog: query string -> list of item dicts
        self.catalog = catalog
        self.calls: list[str] = []

    def _all_items(self) -> dict[str, dict]:
        items = {it["item_id"]: it for items in self.catalog.values() for it in items}
        items[SHOE.item_id] = {
            "item_id": SHOE.item_id, "title": SHOE.title, "category": SHOE.category,
            "price_paise": SHOE.price_paise, "merchant_id": SHOE.merchant_id,
        }
        return items

    def call_tool(self, name: str, arguments: dict) -> dict:
        self.calls.append(name)
        if name == "search_catalog":
            return {"items": self.catalog.get(arguments["query"], [])}
        if name == "get_availability":
            return {**self._all_items()[arguments["item_id"]], "available": True}
        if name == "create_cart":
            all_items = self._all_items()
            total = sum(all_items[i["item_id"]]["price_paise"] for i in arguments["items"])
            return {"cart_id": "cart-1", "total_paise": total,
                    "line_items": [{"item_id": i["item_id"], "qty": 1} for i in arguments["items"]]}
        raise AssertionError(f"unexpected tool {name}")


SHOE = Candidate(item_id="shoe-1", title="Trail Runner", category="shoes",
                  price_paise=285000, merchant_id="m1")
SPORT = {"item_id": "sport-1", "title": "Running Belt", "category": "sporting goods",
         "price_paise": 45000, "merchant_id": "m1"}
CATALOG = {"sporting goods": [SPORT]}


def _composer() -> tuple[CartComposer, FakeMcp]:
    mcp = FakeMcp(CATALOG)
    upsell = UpsellModel(category_complements={"shoes": ["sporting goods"]})
    return CartComposer(mcp, upsell=upsell), mcp


# --- find_upsell: proposes only, never touches the cart --------------------

def test_find_upsell_is_unrestricted_when_allow_list_is_empty():
    """The regression: an empty allow-list (marketplace-wide mandate, the
    default since the single-merchant-default fix) used to disable upsell
    entirely instead of meaning 'any category qualifies'."""
    composer, mcp = _composer()
    addon = composer.find_upsell(SHOE, [], Intent(query="running shoes"))
    assert addon is not None and addon["category"] == "sporting goods"
    assert "create_cart" not in mcp.calls  # read-only — no cart was touched


def test_find_upsell_is_unrestricted_when_allow_list_is_none():
    composer, mcp = _composer()
    addon = composer.find_upsell(SHOE, None, Intent(query="running shoes"))
    assert addon is not None


def test_find_upsell_excludes_a_complement_outside_an_explicit_allow_list():
    """When the mandate DOES restrict categories and the complement isn't in
    the allow-list, it must still be excluded — the fix only changes what an
    EMPTY list means, not the scoping check itself."""
    composer, _mcp = _composer()
    addon = composer.find_upsell(SHOE, ["shoes"], Intent(query="running shoes"))
    assert addon is None


def test_find_upsell_includes_a_complement_explicitly_allowed():
    composer, _mcp = _composer()
    addon = composer.find_upsell(SHOE, ["shoes", "sporting goods"], Intent(query="running shoes"))
    assert addon is not None


# --- compose: never adds a complement unless the human already accepted ----

def test_compose_never_auto_adds_even_when_a_complement_is_available():
    composer, _mcp = _composer()
    cart = composer.compose("sess-1", SHOE, Intent(query="running shoes"))
    assert len(cart.display_items) == 1
    assert cart.total_paise == SHOE.price_paise


def test_compose_adds_the_addon_only_when_explicitly_accepted():
    composer, _mcp = _composer()
    cart = composer.compose(
        "sess-1", SHOE, Intent(query="running shoes"), addon_item_id=SPORT["item_id"]
    )
    assert len(cart.display_items) == 2
    assert cart.display_items[0]["is_upsell"] is False
    assert cart.display_items[1]["is_upsell"] is True
    assert cart.display_items[1]["item_id"] == SPORT["item_id"]
    assert cart.total_paise == SHOE.price_paise + SPORT["price_paise"]
