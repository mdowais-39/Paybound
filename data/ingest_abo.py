"""Ingest a curated product catalog from Amazon Berkeley Objects (ABO) into the
`catalog_item` table.

ABO (public AWS Open Data, no login) ships rich product metadata — title,
product type, brand, colour, materials, variants — but **no price**. So prices
here are SYNTHESIZED per category from plausible ₹ ranges, deterministically
seeded per item so re-runs are stable. This is stated openly (Part F honesty):
the catalog's attributes/variants are real ABO data; the ₹ prices are generated.

Usage:
    python data/ingest_abo.py            # ~1000 items, one demo merchant
    python data/ingest_abo.py --limit 500
"""

from __future__ import annotations

import argparse
import gzip
import json
import os
import random
import sys
from pathlib import Path

import psycopg
import requests

ABO_SHARD_URL = (
    "https://amazon-berkeley-objects.s3.amazonaws.com/listings/metadata/listings_{n}.json.gz"
)
RAW_DIR = Path(__file__).parent / "raw"
MERCHANT_NAME = "Paybound Demo Store"

# Synthesized ₹ price ranges (in rupees) keyed by a normalized category. Whole
# rupees; converted to paise on insert (money is always integer paise).
PRICE_RANGES = {
    "shoes": (1200, 6000),
    "sandal": (600, 2500),
    "boot": (2000, 8000),
    "shirt": (500, 2500),
    "dress": (900, 4000),
    "pants": (700, 3500),
    "watch": (1500, 20000),
    "backpack": (800, 4500),
    "sunglasses": (900, 6000),
    "headphones": (1000, 15000),
    "speaker": (1500, 12000),
    "chair": (2500, 15000),
    "lamp": (600, 4000),
    "bottle": (300, 1500),
    "bag": (700, 4000),
    "cable": (200, 1200),
    "cover": (300, 2000),
    "toy": (400, 3000),
}
DEFAULT_RANGE = (500, 5000)


def normalize_category(product_type: str) -> str:
    """Map an ABO product_type to a coarse, shopper-friendly category."""
    pt = product_type.lower()
    for key in PRICE_RANGES:
        if key in pt:
            return key
    # Common ABO product_type values → friendlier buckets.
    if "shoe" in pt:
        return "shoes"
    return pt.replace("_", " ").strip() or "misc"


def english_value(field: list | None) -> str | None:
    """Pull the first English (or first available) value from an ABO i18n field."""
    if not field:
        return None
    for entry in field:
        tag = entry.get("language_tag", "")
        if tag.startswith("en"):
            return entry.get("value")
    return field[0].get("value")


def synth_price_paise(category: str, seed_key: str) -> int:
    lo, hi = PRICE_RANGES.get(category, DEFAULT_RANGE)
    rng = random.Random(seed_key)  # deterministic per item
    rupees = rng.randint(lo, hi)
    return rupees * 100  # paise


def build_variants(item: dict, base_price_paise: int) -> list[dict]:
    """Derive up to a few colour variants from ABO colour metadata."""
    colors = item.get("color") or []
    values = []
    for c in colors:
        v = c.get("value")
        if v and v not in values:
            values.append(v)
    if not values:
        values = ["Default"]
    variants = []
    for i, color in enumerate(values[:3]):
        variants.append(
            {
                "sku": f"{item.get('item_id', 'sku')}-{i}",
                "color": color,
                "size": "Std",
                "price_paise": base_price_paise,
            }
        )
    return variants


def download_shard(n: int) -> Path:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    dest = RAW_DIR / f"listings_{n}.json.gz"
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    url = ABO_SHARD_URL.format(n=n)
    print(f"downloading {url} ...", flush=True)
    with requests.get(url, stream=True, timeout=120) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_content(chunk_size=1 << 20):
                f.write(chunk)
    return dest


def iter_items(shard_path: Path):
    with gzip.open(shard_path, "rt", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                yield json.loads(line)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=1000, help="max items to ingest")
    ap.add_argument("--shards", type=int, default=2, help="ABO shards to scan")
    args = ap.parse_args()

    db_url = os.environ.get("DATABASE_URL") or os.environ.get("PAYBOUND_DATABASE_URL")
    if not db_url:
        print("ERROR: set DATABASE_URL (or PAYBOUND_DATABASE_URL) in the environment/.env", file=sys.stderr)
        return 1
    # psycopg wants the scheme 'postgresql://'
    db_url = db_url.replace("postgres://", "postgresql://", 1)

    curated: list[dict] = []
    for n in range(args.shards):
        if len(curated) >= args.limit:
            break
        shard = download_shard(n)
        for item in iter_items(shard):
            if len(curated) >= args.limit:
                break
            title = english_value(item.get("item_name"))
            ptypes = item.get("product_type") or []
            product_type = ptypes[0].get("value") if ptypes else None
            if not title or not product_type:
                continue  # skip items without a usable name/category
            category = normalize_category(product_type)
            price_paise = synth_price_paise(category, item.get("item_id", title))
            curated.append(
                {
                    "title": title[:300],
                    "category": category,
                    "price_paise": price_paise,
                    "variants": json.dumps(build_variants(item, price_paise)),
                }
            )

    print(f"curated {len(curated)} items; writing to DB ...", flush=True)

    with psycopg.connect(db_url) as conn:
        with conn.cursor() as cur:
            # One demo merchant; clear its catalog so re-runs are clean/idempotent.
            cur.execute("SELECT merchant_id FROM merchant WHERE name = %s", (MERCHANT_NAME,))
            row = cur.fetchone()
            if row:
                merchant_id = row[0]
                cur.execute("DELETE FROM catalog_item WHERE merchant_id = %s", (merchant_id,))
            else:
                cur.execute(
                    "INSERT INTO merchant (name, allowed_methods) VALUES (%s, %s::jsonb) RETURNING merchant_id",
                    (MERCHANT_NAME, json.dumps(["upi", "card"])),
                )
                merchant_id = cur.fetchone()[0]

            cur.executemany(
                """INSERT INTO catalog_item
                     (merchant_id, title, category, price_paise, currency, availability, variants)
                   VALUES (%s, %s, %s, %s, 'INR', true, %s::jsonb)""",
                [
                    (merchant_id, c["title"], c["category"], c["price_paise"], c["variants"])
                    for c in curated
                ],
            )
        conn.commit()

    print(f"done: merchant '{MERCHANT_NAME}' now has {len(curated)} catalog items.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
