"""Search-relevance ranker (trained on Amazon ESCI). A small gradient-boosted
model over lexical + semantic features — enough to clearly beat keyword search
without chasing a leaderboard. It reranks the storefront's candidate results;
the discovery worker calls `rank`. Kept in-process (loads a MiniLM embedder +
an XGBoost booster) — the plan allows in-process serving over a network hop."""

from __future__ import annotations

import re
from pathlib import Path

import joblib
import numpy as np

ARTIFACT = Path(__file__).parent / "artifacts" / "relevance.joblib"
EMBED_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
_TOKEN = re.compile(r"[a-z0-9]+")


def _tokens(text: str) -> set[str]:
    return set(_TOKEN.findall((text or "").lower()))


def token_overlap(query: str, title: str) -> float:
    q, t = _tokens(query), _tokens(title)
    if not q:
        return 0.0
    return len(q & t) / len(q)


class RelevanceRanker:
    """Features: semantic cosine (MiniLM), token overlap, and length ratios."""

    def __init__(self, embedder=None, booster=None):
        self._embedder = embedder
        self.booster = booster

    @property
    def embedder(self):
        if self._embedder is None:
            from sentence_transformers import SentenceTransformer

            self._embedder = SentenceTransformer(EMBED_MODEL)
        return self._embedder

    def _embed(self, texts: list[str]) -> np.ndarray:
        return np.asarray(
            self.embedder.encode(texts, normalize_embeddings=True, batch_size=256, show_progress_bar=False)
        )

    def features(self, queries: list[str], titles: list[str]) -> np.ndarray:
        q_emb = self._embed(queries)
        t_emb = self._embed(titles)
        cosine = np.sum(q_emb * t_emb, axis=1)  # normalized → dot = cosine
        overlap = np.array([token_overlap(q, t) for q, t in zip(queries, titles)])
        qlen = np.array([len(_tokens(q)) for q in queries], dtype=float)
        tlen = np.array([len(_tokens(t)) for t in titles], dtype=float)
        return np.column_stack([cosine, overlap, qlen, tlen, np.minimum(tlen, 30)])

    def fit(self, queries: list[str], titles: list[str], grades: list[float]) -> None:
        import xgboost as xgb

        x = self.features(queries, titles)
        self.booster = xgb.XGBRegressor(
            n_estimators=300, max_depth=6, learning_rate=0.1, subsample=0.8,
            colsample_bytree=0.8, n_jobs=-1, random_state=42,
        )
        self.booster.fit(x, np.asarray(grades, dtype=float))

    def score(self, queries: list[str], titles: list[str]) -> np.ndarray:
        return self.booster.predict(self.features(queries, titles))

    def rank(self, query: str, candidates: list[dict], title_key: str = "title") -> list[dict]:
        """Return candidates sorted by predicted relevance (highest first)."""
        if not candidates or self.booster is None:
            return candidates
        titles = [c.get(title_key, "") for c in candidates]
        scores = self.score([query] * len(titles), titles)
        order = np.argsort(-scores)
        return [candidates[i] for i in order]

    def save(self, path: Path = ARTIFACT) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump({"booster": self.booster}, path)

    @classmethod
    def load(cls, path: Path = ARTIFACT) -> RelevanceRanker:
        data = joblib.load(path)
        return cls(booster=data["booster"])
