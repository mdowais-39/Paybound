"""Best-effort loader for the trained Phase 7 models. Returns None for any model
whose artifact is missing, so the agent gracefully falls back to heuristics
(and CI, which has no artifacts, still runs)."""

from __future__ import annotations


def load_relevance():
    try:
        from services.relevance.model import RelevanceRanker

        return RelevanceRanker.load()
    except Exception:  # noqa: BLE001
        return None


def load_upsell():
    try:
        from services.upsell.model import UpsellModel

        return UpsellModel.load()
    except Exception:  # noqa: BLE001
        return None


def load_confidence():
    try:
        from services.confidence.model import ConfidenceScorer

        return ConfidenceScorer.load()
    except Exception:  # noqa: BLE001
        return None
