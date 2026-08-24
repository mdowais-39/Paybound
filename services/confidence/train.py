"""Train the Purchase Confidence Scorer on synthesised, labelled conversational-
shopping scenarios (stated openly, same honesty standard as the rest of the data
story): clear, single-interpretation goals -> high confidence; ambiguous / multi-
interpretation goals -> low confidence. Reports held-out separation.

Run: python -m services.confidence.train
"""

from __future__ import annotations

import numpy as np
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split

from .model import ConfidenceScorer

SEED = 42
N = 8000


def synthesise(n: int, rng: np.random.RandomState) -> tuple[np.ndarray, np.ndarray]:
    """Half clear (high-confidence), half ambiguous (low-confidence), with noise."""
    half = n // 2
    # Clear-intent purchases (ranges deliberately OVERLAP the ambiguous ones so
    # the classifier is non-trivial, not a perfectly separable toy).
    clear = np.column_stack([
        rng.uniform(0.50, 1.00, half),   # cart_to_goal_match (high, overlaps)
        rng.uniform(0.00, 0.45, half),   # price_variance (low, overlaps)
        rng.uniform(0.00, 0.45, half),   # category_ambiguity (low, overlaps)
        rng.poisson(0.4, half),          # clarification_turns (few)
        rng.binomial(1, 0.4, half),      # upsell_accepted
    ])
    # Ambiguous purchases.
    amb = np.column_stack([
        rng.uniform(0.20, 0.75, half),   # low-ish match (overlaps)
        rng.uniform(0.25, 1.20, half),   # higher price variance (overlaps)
        rng.uniform(0.35, 1.00, half),   # higher ambiguity (overlaps)
        rng.poisson(1.4, half),          # more clarification turns
        rng.binomial(1, 0.5, half),
    ])
    x = np.vstack([clear, amb])
    y = np.concatenate([np.ones(half), np.zeros(half)])
    # shuffle
    idx = rng.permutation(len(y))
    return x[idx], y[idx]


def main() -> int:
    rng = np.random.RandomState(SEED)
    x, y = synthesise(N, rng)
    xtr, xte, ytr, yte = train_test_split(x, y, test_size=0.25, random_state=SEED, stratify=y)

    scorer = ConfidenceScorer()
    scorer.fit(xtr, ytr)

    proba = scorer.booster.predict_proba(xte)[:, 1]
    auc = roc_auc_score(yte, proba)
    clear_mean = proba[yte == 1].mean()
    amb_mean = proba[yte == 0].mean()

    print("\n=== Purchase Confidence Scorer (held-out) ===")
    print(f"  ROC-AUC                        : {auc:.4f}")
    print(f"  mean confidence, CLEAR goals   : {clear_mean:.3f}")
    print(f"  mean confidence, AMBIGUOUS goals: {amb_mean:.3f}")
    print(f"  separation                     : {clear_mean - amb_mean:.3f}")

    scorer.save()
    print("\nsaved -> services/confidence/artifacts/confidence.joblib")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
