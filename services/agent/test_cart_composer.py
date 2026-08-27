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

import numpy as np

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


# --- semantic bridge: an unseen catalog category still finds complements ----

class FakeEmbedder:
    """Deterministic stand-in for MiniLM: fixed vectors for a tiny vocabulary,
    so the nearest-key math is exercised without loading a real model. Anything
    unknown maps to an orthogonal 'nothing-close' vector."""

    VECS = {
        "footwear": [1.0, 0.0, 0.0],
        "sporting goods": [0.0, 1.0, 0.0],
        "sneakers": [0.95, 0.05, 0.0],  # semantically near 'footwear'
        "paperclips": [0.0, 0.0, 1.0],  # near nothing in the table
    }

    def encode(self, texts, normalize_embeddings=True, show_progress_bar=False):
        out = []
        for t in texts:
            v = np.asarray(self.VECS.get(t, [0.0, 0.0, 1.0]), dtype=float)
            n = np.linalg.norm(v)
            out.append(v / n if n else v)
        return np.asarray(out)


class FakeRelevance:
    """Exposes just the two hooks the composer uses from a relevance ranker."""

    def __init__(self, embedder):
        self.embedder = embedder

    def embed_query(self, q):
        return [float(x) for x in self.embedder.encode([q])[0]]


def test_find_upsell_bridges_an_unseen_category_to_the_nearest_trained_key():
    """The whole point of the embedding upgrade: 'sneakers' is NOT a key in the
    trained table, but it's semantically 'footwear' — so its complements
    (sporting goods) are still found, no hand-curated 'sneakers' entry needed."""
    mcp = FakeMcp(CATALOG)
    upsell = UpsellModel(category_complements={"footwear": ["sporting goods"]},
                         embedder=FakeEmbedder())
    composer = CartComposer(mcp, upsell=upsell, relevance=FakeRelevance(FakeEmbedder()))
    sneaker = Candidate(item_id="snk-1", title="Sneaker", category="sneakers",
                        price_paise=285000, merchant_id="m1")

    addon = composer.find_upsell(sneaker, None, Intent(query="sneakers"))
    assert addon is not None and addon["category"] == "sporting goods"


def test_find_upsell_returns_none_when_no_trained_key_is_close_enough():
    mcp = FakeMcp(CATALOG)
    upsell = UpsellModel(category_complements={"footwear": ["sporting goods"]},
                         embedder=FakeEmbedder())
    composer = CartComposer(mcp, upsell=upsell, relevance=FakeRelevance(FakeEmbedder()))
    junk = Candidate(item_id="j-1", title="Paperclips", category="paperclips",
                     price_paise=1000, merchant_id="m1")

    assert composer.find_upsell(junk, None, Intent(query="paperclips")) is None
