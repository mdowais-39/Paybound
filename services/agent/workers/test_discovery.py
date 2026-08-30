"""DiscoveryWorker tests — deterministic, no network/LLM/trained artifact (a
tiny fake relevance ranker with scripted scores stands in for the real
ESCI-trained model). These prove the margin filter: reranking alone doesn't
stop an only-vaguely-related result from landing in the human's CHOOSE list
if the genuinely relevant pool is smaller than the options cap — dropping it
does."""

from services.agent.models import Intent
from services.agent.workers.discovery import DiscoveryWorker


class FakeMcp:
    def __init__(self, items: list[dict]):
        self.items = items
        self.calls: list[str] = []

    def call_tool(self, name: str, arguments: dict) -> dict:
        self.calls.append(name)
        assert name == "search_catalog"
        return {"items": self.items}


class FakeRelevance:
    """Mirrors RelevanceRanker.rank's contract (sorted, each dict carries
    `_relevance_score`) with scores keyed by title, scripted per test — so the
    filter is tested against exact, known gaps instead of the real model's
    (well-tested elsewhere) actual scores."""

    def __init__(self, scores_by_title: dict[str, float]):
        self.scores_by_title = scores_by_title

    def embed_query(self, query: str) -> list[float]:
        return [0.0]

    def rank(self, query: str, candidates: list[dict], title_key: str = "title") -> list[dict]:
        scored = [
            {**c, "_relevance_score": self.scores_by_title[c[title_key]]} for c in candidates
        ]
        scored.sort(key=lambda c: c["_relevance_score"], reverse=True)
        return scored


KEYBOARD = {"item_id": "k1", "title": "AmazonBasics Gaming Keyboard", "category": "keyboards",
            "price_paise": 423500, "merchant_id": "m1"}
MOUSE = {"item_id": "k2", "title": "AmazonBasics Wired Mouse", "category": "computer input device",
         "price_paise": 297600, "merchant_id": "m1"}
PHONE_CASE = {"item_id": "k3", "title": "Solimo Phone Case for Note 10", "category": "cellular phone case",
              "price_paise": 195600, "merchant_id": "m1"}
TABLE = {"item_id": "k4", "title": "Rivet TV Media Console Table", "category": "table",
         "price_paise": 340300, "merchant_id": "m2"}


def test_a_mismatched_category_close_in_score_order_is_still_dropped():
    """The exact reported bug: a phone case and a table both rank BELOW the
    real keyboard/mouse matches (correct ORDER), but close enough in absolute
    score that a plain sort still lets them into the top-N CHOOSE list. The
    margin filter must remove them, not just place them last."""
    mcp = FakeMcp([KEYBOARD, MOUSE, PHONE_CASE, TABLE])
    relevance = FakeRelevance({
        KEYBOARD["title"]: 2.811,
        MOUSE["title"]: 2.720,
        PHONE_CASE["title"]: 2.629,  # only 0.182 below the top — a real gap, but a plain top-N cutoff misses it
        TABLE["title"]: 2.572,       # 0.239 below the top
    })
    worker = DiscoveryWorker(mcp, relevance=relevance)

    outcome = worker.search(Intent(query="keyboard"))

    assert [c.item_id for c in outcome.candidates] == [KEYBOARD["item_id"], MOUSE["item_id"]]


def test_candidates_within_the_margin_are_all_kept():
    """Several genuinely close matches (all within RELEVANCE_MARGIN of the
    top) must all survive — the filter targets a real gap, not just 'keep the
    single best result'."""
    mcp = FakeMcp([KEYBOARD, MOUSE])
    relevance = FakeRelevance({KEYBOARD["title"]: 2.80, MOUSE["title"]: 2.75})
    worker = DiscoveryWorker(mcp, relevance=relevance)

    outcome = worker.search(Intent(query="keyboard"))

    assert {c.item_id for c in outcome.candidates} == {KEYBOARD["item_id"], MOUSE["item_id"]}


def test_top_candidate_always_survives_even_when_alone():
    """A single real match is never filtered against itself (zero gap) —
    search never returns empty just because nothing else was close enough."""
    mcp = FakeMcp([KEYBOARD])
    relevance = FakeRelevance({KEYBOARD["title"]: 1.9})
    worker = DiscoveryWorker(mcp, relevance=relevance)

    outcome = worker.search(Intent(query="keyboard"))

    assert [c.item_id for c in outcome.candidates] == [KEYBOARD["item_id"]]


def test_heuristic_fallback_unaffected_when_no_relevance_model():
    """Without a trained ranker, there's no relevance score to filter by —
    the heuristic price-based fallback keeps every affordable candidate,
    unchanged from before this fix."""
    mcp = FakeMcp([KEYBOARD, MOUSE, PHONE_CASE, TABLE])
    worker = DiscoveryWorker(mcp, relevance=None)

    outcome = worker.search(Intent(query="keyboard"))

    assert len(outcome.candidates) == 4
