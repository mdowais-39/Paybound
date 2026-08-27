"""Backfill the `catalog_item.embedding` vector(384) column with MiniLM
sentence embeddings of each item's "title + category", so the storefront can
do semantic (meaning-based) search instead of only literal keyword matching.

Uses the SAME model the relevance ranker uses (all-MiniLM-L6-v2, 384-dim,
normalized) — so the query embeddings the discovery worker computes at search
time live in the same space as these item embeddings, and pgvector's cosine
distance (`<=>`) is directly meaningful.

Idempotent and safe to re-run (recomputes and overwrites). Run after ingesting
the catalog (data/ingest_abo.py / ingest_instacart.py):

    python data/embed_catalog.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import psycopg

# Allow `python data/embed_catalog.py` from the repo root to import `services`.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.relevance.model import EMBED_MODEL  # noqa: E402


def main() -> int:
    dsn = (os.environ.get("DATABASE_URL") or os.environ.get("PAYBOUND_DATABASE_URL") or "").replace(
        "postgres://", "postgresql://", 1
    )
    if not dsn:
        print("ERROR: set DATABASE_URL (or PAYBOUND_DATABASE_URL)", file=sys.stderr)
        return 1

    print(f"loading embedder {EMBED_MODEL} ...", flush=True)
    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer(EMBED_MODEL)

    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT item_id, title, category FROM catalog_item ORDER BY item_id")
            rows = cur.fetchall()
        if not rows:
            print("no catalog items to embed", flush=True)
            return 0

        texts = [f"{title} {category}" for _id, title, category in rows]
        print(f"embedding {len(texts)} items ...", flush=True)
        vecs = model.encode(
            texts, normalize_embeddings=True, batch_size=256, show_progress_bar=False
        )

        # pgvector accepts the text form '[f1,f2,...]' cast to ::vector.
        updates = [
            ("[" + ",".join(f"{x:.6f}" for x in vec) + "]", row[0])
            for row, vec in zip(rows, vecs)
        ]
        with conn.cursor() as cur:
            cur.executemany(
                "UPDATE catalog_item SET embedding = %s::vector WHERE item_id = %s",
                updates,
            )
        conn.commit()

    print(f"done: embedded {len(rows)} catalog items.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
