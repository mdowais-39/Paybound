"""Behavioural checks on the trained Phase 7 artifacts. Skipped when an artifact
is missing (e.g. in CI, which does not train), so these never break the build."""

import pytest

from services.confidence.model import ARTIFACT as CONF_ART
from services.confidence.model import ConfidenceScorer
from services.relevance.model import ARTIFACT as REL_ART
from services.relevance.model import RelevanceRanker
from services.upsell.model import ARTIFACT as UP_ART
from services.upsell.model import UpsellModel


@pytest.mark.skipif(not CONF_ART.exists(), reason="confidence artifact not trained")
def test_confidence_separates_clear_from_ambiguous():
    scorer = ConfidenceScorer.load()
    clear = {"cart_to_goal_match": 0.95, "price_variance": 0.05,
             "category_ambiguity": 0.05, "clarification_turns": 0, "upsell_accepted": 1}
    ambiguous = {"cart_to_goal_match": 0.25, "price_variance": 0.8,
                 "category_ambiguity": 0.9, "clarification_turns": 3, "upsell_accepted": 0}
    assert scorer.score_purchase(clear) > 0.5
    assert scorer.score_purchase(ambiguous) < 0.5
    assert scorer.needs_human(ambiguous) and not scorer.needs_human(clear)


@pytest.mark.skipif(not REL_ART.exists(), reason="relevance artifact not trained")
def test_relevance_ranks_relevant_above_irrelevant():
    ranker = RelevanceRanker.load()
    candidates = [
        {"title": "Stainless Steel Water Bottle 1L"},
        {"title": "Mens Trail Running Shoe, breathable"},
    ]
    ranked = ranker.rank("running shoes", candidates)
    assert "Running Shoe" in ranked[0]["title"]


@pytest.mark.skipif(not UP_ART.exists(), reason="upsell artifact not trained")
def test_upsell_suggests_a_footwear_complement():
    model = UpsellModel.load()
    comps = model.complement_categories("footwear")
    assert "socks" in comps
    cart = [{"item_id": "shoe", "category": "footwear"}]
    catalog = [
        {"item_id": "shoe", "category": "footwear", "price_paise": 285000},
        {"item_id": "sock", "category": "socks", "price_paise": 45000},
    ]
    suggestion = model.suggest_for_cart(cart, catalog)
    assert suggestion is not None and suggestion["category"] == "socks"


@pytest.mark.skipif(not UP_ART.exists(), reason="upsell artifact not trained")
def test_upsell_covers_categories_the_live_catalog_actually_stocks():
    """The trained artifact's category vocabulary (Instacart aisles + Amazon
    Reviews fashion) barely overlaps this deployment's live catalog (a general
    Amazon marketplace export: jewelry, home furniture, phone cases — no
    apparel). These pairs were hand-curated against `SELECT DISTINCT category`
    on the live catalog so upsell has something real to suggest today, not just
    in a future catalog that happens to stock socks."""
    model = UpsellModel.load()
    assert "earring" in model.complement_categories("ring")
    assert "rug" in model.complement_categories("sofa")
    assert "charging adapter" in model.complement_categories("cellular phone case")
    assert "sporting goods" in model.complement_categories("shoes")
