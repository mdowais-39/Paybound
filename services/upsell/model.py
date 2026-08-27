"""Upsell / cross-sell model. Built from three real sources (see train.py):
  - Instacart Market Basket  -> product- and aisle-level 'bought together' (lift)
  - Amazon Reviews 2023       -> category 'also-bought' pairs (fashion domain)
  - Amazon ESCI 'C' labels    -> explicit complement signal

The agent shops OUR catalog (a different product space from Instacart/ESCI), so
the signal the Cart-Composer actually consumes is a CATEGORY -> complement-
category table (domain-general), applied over the live catalog. The Instacart
product associations and ESCI-C pairs are demonstrated + evaluated in train.py."""

from __future__ import annotations

from pathlib import Path

import joblib
import numpy as np

ARTIFACT = Path(__file__).parent / "artifacts" / "upsell.joblib"


class UpsellModel:
    def __init__(self, category_complements: dict[str, list[str]] | None = None,
                 product_complements: dict | None = None, embedder=None):
        # category -> ranked complement categories
        self.category_complements = category_complements or {}
        # instacart product_id -> ranked complement product_ids (demonstration)
        self.product_complements = product_complements or {}
        # Optional shared MiniLM embedder (the SAME one the relevance ranker
        # uses). When present, `complement_categories_for` can bridge a catalog
        # category the trained table was never literally keyed on to its
        # nearest trained key by meaning — so the co-purchase signal generalises
        # to any catalog instead of needing an exact category-string match.
        self._embedder = embedder
        self._key_embeddings: np.ndarray | None = None
        self._keys: list[str] | None = None

    def set_embedder(self, embedder) -> None:
        self._embedder = embedder
        self._key_embeddings = None  # invalidate cache

    def complement_categories(self, category: str) -> list[str]:
        """Exact-match lookup only (no semantic bridge) — the raw trained/
        curated table. Kept for tests and callers that want the table as-is."""
        return self.category_complements.get(category, [])

    def _ensure_key_embeddings(self):
        """Cache one MiniLM embedding per trained category KEY. Computed once
        (lazily) since the table is fixed for a running process."""
        if self._embedder is None:
            return None
        if self._key_embeddings is None:
            self._keys = list(self.category_complements.keys())
            if not self._keys:
                return None
            self._key_embeddings = np.asarray(
                self._embedder.encode(self._keys, normalize_embeddings=True, show_progress_bar=False)
            )
        return self._key_embeddings

    def complement_categories_for(self, category: str, min_similarity: float = 0.55) -> list[str]:
        """Ranked complement categories for `category`. An exact table hit wins
        (fast + precise); otherwise, when a shared embedder is available, fall
        back to the complements of the semantically NEAREST trained key (if it
        is close enough), so an unseen catalog category still gets a real,
        co-purchase-derived suggestion. Returns [] when nothing is close."""
        exact = self.category_complements.get(category)
        if exact:
            return exact
        mat = self._ensure_key_embeddings()
        if mat is None:
            return []
        v = np.asarray(self._embedder.encode([category], normalize_embeddings=True))[0]
        sims = mat @ v  # normalized → dot = cosine
        best = int(np.argmax(sims))
        if float(sims[best]) < min_similarity:
            return []
        return self.category_complements[self._keys[best]]

    def suggest_for_cart(self, cart_items: list[dict], catalog: list[dict]) -> dict | None:
        """Given the cart (items with a 'category') and the available catalog
        (items with item_id/category/title/price_paise), return the single best
        complement item not already in the cart, or None."""
        in_cart = {it.get("item_id") for it in cart_items}
        cart_cats = {it.get("category") for it in cart_items}
        # Ranked complement categories for anything in the cart.
        wanted: list[str] = []
        for cat in cart_cats:
            for comp in self.complement_categories(cat):
                if comp not in cart_cats and comp not in wanted:
                    wanted.append(comp)
        if not wanted:
            return None
        by_cat: dict[str, list[dict]] = {}
        for item in catalog:
            if item.get("item_id") in in_cart:
                continue
            by_cat.setdefault(item.get("category"), []).append(item)
        for comp in wanted:  # first (highest-ranked) complement category with stock
            items = by_cat.get(comp)
            if items:
                return min(items, key=lambda i: i.get("price_paise", 0))
        return None

    def save(self, path: Path = ARTIFACT) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(
            {"category_complements": self.category_complements,
             "product_complements": self.product_complements},
            path,
        )

    @classmethod
    def load(cls, path: Path = ARTIFACT) -> UpsellModel:
        d = joblib.load(path)
        return cls(d.get("category_complements"), d.get("product_complements"))
