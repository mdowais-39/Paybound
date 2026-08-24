"""Train the search-relevance ranker on Amazon ESCI and report NDCG@10 against a
keyword baseline (the before/after the Phase 7 DoD asks for).

ESCI graded relevance: Exact=3, Substitute=2, Complement=1, Irrelevant=0.

Run: python -m services.relevance.train
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import ndcg_score

from .model import RelevanceRanker, token_overlap

ESCI = Path("data/raw/esci-data/shopping_queries_dataset")
GRADE = {"E": 3.0, "S": 2.0, "C": 1.0, "I": 0.0}

N_TRAIN_QUERIES = 4000
N_TEST_QUERIES = 2000
SEED = 42


def load_us() -> pd.DataFrame:
    ex = pd.read_parquet(
        ESCI / "shopping_queries_dataset_examples.parquet",
        columns=["query", "query_id", "product_id", "esci_label", "product_locale", "split"],
    )
    ex = ex[ex["product_locale"] == "us"].copy()
    prod = pd.read_parquet(
        ESCI / "shopping_queries_dataset_products.parquet",
        columns=["product_id", "product_title", "product_locale"],
    )
    prod = prod[prod["product_locale"] == "us"][["product_id", "product_title"]]
    df = ex.merge(prod, on="product_id", how="inner")
    df["grade"] = df["esci_label"].map(GRADE)
    df = df.dropna(subset=["product_title", "grade"])
    return df


def sample_queries(df: pd.DataFrame, split: str, n: int) -> pd.DataFrame:
    ids = df[df["split"] == split]["query_id"].drop_duplicates()
    rng = np.random.RandomState(SEED)
    chosen = set(rng.choice(ids.values, size=min(n, len(ids)), replace=False))
    return df[df["query_id"].isin(chosen) & (df["split"] == split)].copy()


def ndcg_for(df: pd.DataFrame, score_col: str, k: int = 10) -> float:
    scores = []
    for _, g in df.groupby("query_id"):
        if len(g) < 2:
            continue
        true = g["grade"].to_numpy().reshape(1, -1)
        pred = g[score_col].to_numpy().reshape(1, -1)
        scores.append(ndcg_score(true, pred, k=k))
    return float(np.mean(scores))


def main() -> int:
    print("loading ESCI (US) ...", flush=True)
    df = load_us()
    train = sample_queries(df, "train", N_TRAIN_QUERIES)
    test = sample_queries(df, "test", N_TEST_QUERIES)
    print(f"train pairs: {len(train)} ({train['query_id'].nunique()} queries) | "
          f"test pairs: {len(test)} ({test['query_id'].nunique()} queries)", flush=True)

    ranker = RelevanceRanker()
    print("training ...", flush=True)
    ranker.fit(train["query"].tolist(), train["product_title"].tolist(), train["grade"].tolist())

    # Score the held-out test set with the model and the keyword baseline.
    print("scoring held-out test ...", flush=True)
    test["model"] = ranker.score(test["query"].tolist(), test["product_title"].tolist())
    test["keyword"] = [token_overlap(q, t) for q, t in zip(test["query"], test["product_title"])]

    base = ndcg_for(test, "keyword")
    trained = ndcg_for(test, "model")
    lift = (trained - base) / base * 100 if base else float("nan")

    print("\n=== ESCI held-out NDCG@10 (before/after) ===")
    print(f"  keyword baseline : {base:.4f}")
    print(f"  trained ranker   : {trained:.4f}")
    print(f"  relative lift    : +{lift:.1f}%")

    ranker.save()
    print(f"\nsaved model -> {RelevanceRanker.load.__self__ if False else 'services/relevance/artifacts/relevance.joblib'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
