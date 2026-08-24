"""Purchase Confidence Scorer — a trained, inspectable gradient-boosted classifier
that replaces the earlier heuristic 'low confidence' with a real signal on the
same footing as the ₹15,000 AFA rule. Below a tuned threshold, the session routes
to NEEDS_HUMAN — a deterministic model output, not the LLM grading itself.

Features (named + inspectable):
  cart_to_goal_match   — semantic match of the cart to the stated goal [0,1]
  price_variance       — |cart_total - budget| / budget                [0,1+]
  category_ambiguity   — how ambiguous the category was                 [0,1]
  clarification_turns  — how many follow-ups were needed                int
  upsell_accepted      — was an upsell taken                            0/1
"""

from __future__ import annotations

from pathlib import Path

import joblib
import numpy as np

ARTIFACT = Path(__file__).parent / "artifacts" / "confidence.joblib"
FEATURES = [
    "cart_to_goal_match",
    "price_variance",
    "category_ambiguity",
    "clarification_turns",
    "upsell_accepted",
]
DEFAULT_THRESHOLD = 0.5


def _vec(feat: dict) -> np.ndarray:
    return np.array([[float(feat.get(k, 0.0)) for k in FEATURES]])


class ConfidenceScorer:
    def __init__(self, booster=None, threshold: float = DEFAULT_THRESHOLD):
        self.booster = booster
        self.threshold = threshold

    def fit(self, x: np.ndarray, y: np.ndarray) -> None:
        import xgboost as xgb

        self.booster = xgb.XGBClassifier(
            n_estimators=200, max_depth=4, learning_rate=0.1, subsample=0.9,
            eval_metric="logloss", n_jobs=-1, random_state=42,
        )
        self.booster.fit(x, y)

    def score_purchase(self, feat: dict) -> float:
        """Return the purchase-confidence probability in [0,1]."""
        if self.booster is None:
            return 1.0
        return float(self.booster.predict_proba(_vec(feat))[0, 1])

    def needs_human(self, feat: dict) -> bool:
        return self.score_purchase(feat) < self.threshold

    def save(self, path: Path = ARTIFACT) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump({"booster": self.booster, "threshold": self.threshold}, path)

    @classmethod
    def load(cls, path: Path = ARTIFACT) -> ConfidenceScorer:
        data = joblib.load(path)
        return cls(booster=data["booster"], threshold=data.get("threshold", DEFAULT_THRESHOLD))
