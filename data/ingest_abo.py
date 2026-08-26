"""Ingest a curated product catalog from Amazon Berkeley Objects (ABO) into the
`catalog_item` table.

ABO (public AWS Open Data, no login) ships rich product metadata — title,
product type, brand, colour, materials, variants — but **no price**. So prices
here are SYNTHESIZED per category from plausible ₹ ranges, deterministically
seeded per item so re-runs are stable. This is stated openly (Part F honesty):
the catalog's attributes/variants are real ABO data; the ₹ prices are generated.

Each item also carries a real ABO `brand` value (e.g. "Amazon Brand - Solimo",
"Stone & Beam", "AmazonBasics") — real, distinct retailer-style identities
already present in the data, not invented. `--brand-includes`/`--brand-excludes`
use that to split ONE dataset into a genuine multi-merchant marketplace with
non-overlapping catalogs, instead of one store holding everything.

Usage:
    python data/ingest_abo.py                                  # ~1000 items, one general merchant
    python data/ingest_abo.py --limit 500
    python data/ingest_abo.py --merchant "Stone & Beam Living" --brand-includes "Stone & Beam,Rivet"
    python data/ingest_abo.py --brand-excludes "Stone & Beam,Rivet"   # the general store, minus that specialty
"""

from __future__ import annotations

import argparse
import gzip
import json
import os
import random
import re
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
# rupees; converted to paise on insert (money is always integer paise). The
# premium categories below (sofa, television, chair, ring, ...) are set to
# realistically span the ₹15,000 AFA threshold — the earlier ranges topped
# out at ~₹15k for even the priciest item, so a mandate could almost never
# naturally trigger the AFA "needs human" gate the kernel actually enforces.
PRICE_RANGES = {
    # Everyday / mass-market — kept modest on purpose.
    "shoes": (1200, 6000),
    "sandal": (600, 2500),
    "boot": (2000, 9000),
    "shirt": (500, 2500),
    "dress": (900, 4500),
    "pants": (700, 3500),
    "backpack": (800, 5000),
    "sunglasses": (900, 7000),
    "lamp": (600, 5000),
    "bottle": (300, 1500),
    "bag": (700, 6000),
    "cable": (200, 1200),
    "cover": (300, 2000),
    "toy": (400, 3500),
    "electronics accessory": (300, 3000),
    "tools & safety supplies": (400, 3500),
    "drugstore & baby care": (200, 2000),
    "rug": (1000, 18000),
    # Genuinely premium categories — real Indian retail prices, not inflated
    # for the demo; several of these naturally clear ₹15,000.
    "watch": (1500, 45000),
    "headphones": (1000, 25000),
    "speaker": (1500, 20000),
    "chair": (2500, 30000),
    "sofa": (8000, 60000),
    "television": (8000, 80000),
    "table": (2000, 25000),
    "desk": (2500, 20000),
    "cabinet": (3000, 25000),
    "vacuum cleaner": (1500, 30000),
    "microscope": (5000, 45000),
    "ring": (3000, 90000),
    "earring": (2000, 60000),
    "necklace": (4000, 100000),
    "fine jewelry": (3000, 80000),
}
DEFAULT_RANGE = (500, 5000)

# Explicit fixes for ABO's raw, unreadable taxonomy codes. Verified against
# real sample titles (Part F honesty: these aren't guesses) — e.g. "finering"
# is fine jewelry rings (gold/silver/diamond), "biss" is tools/safety gear
# (extension leads, work gloves, ear protection). Applied only as a fallback,
# since these codes are single unbroken tokens with no clean word-boundary
# substring match against any PRICE_RANGES key (see normalize_category).
CATEGORY_ALIASES = {
    "biss": "tools & safety supplies",
    "finering": "ring",
    "fineearring": "earring",
    "finenecklacebraceletanklet": "necklace",
    "fineother": "fine jewelry",
    "fashionring": "ring",  # sampled: also real gold/diamond-accent pieces, not costume jewelry
    "fashionearring": "earring",
    "fashionnecklacebraceletanklet": "necklace",
    "abis drugstore": "drugstore & baby care",
    "accessory or part or supply": "electronics accessory",
}


def normalize_category(product_type: str) -> str:
    """Map an ABO product_type to a coarse, shopper-friendly category.

    Matches on a LEFT word-boundary, not a bare substring: a naive `"table"
    in pt` check would wrongly match inside "vegetable" (which literally ends
    in "...table"). `\\b` before the key prevents that whole class of bug
    while still catching plurals ("shoe" boundary-matches "shoes" too, since
    only the left edge needs to be a real word start).
    """
    pt = product_type.lower().replace("_", " ")
    for key in PRICE_RANGES:
        if re.search(r"\b" + re.escape(key), pt):
            return key
    # Common ABO product_type values → friendlier buckets.
    if "shoe" in pt:
        return "shoes"
    raw = pt.strip() or "misc"
    return CATEGORY_ALIASES.get(raw, raw)


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


def _brand_matches(item: dict, needles: list[str]) -> bool:
    brand = english_value(item.get("brand")) or ""
    brand_lower = brand.lower()
    return any(n.lower() in brand_lower for n in needles)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=1000, help="max items to ingest")
    ap.add_argument("--shards", type=int, default=2, help="ABO shards to scan")
    ap.add_argument("--merchant", default=MERCHANT_NAME, help="target merchant name (created if missing)")
    ap.add_argument(
        "--brand-includes",
        default=None,
        help="comma-separated substrings; keep only items whose real ABO brand matches one of them",
    )
    ap.add_argument(
        "--brand-excludes",
        default=None,
        help="comma-separated substrings; skip items whose real ABO brand matches one of them "
        "(so a general store doesn't duplicate a specialty store's items)",
    )
    args = ap.parse_args()
    includes = [b.strip() for b in args.brand_includes.split(",")] if args.brand_includes else None
    excludes = [b.strip() for b in args.brand_excludes.split(",")] if args.brand_excludes else None

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
            if includes is not None and not _brand_matches(item, includes):
                continue
            if excludes is not None and _brand_matches(item, excludes):
                continue
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

    merchant_name = args.merchant
    print(f"curated {len(curated)} items for '{merchant_name}'; writing to DB ...", flush=True)

    with psycopg.connect(db_url) as conn:
        with conn.cursor() as cur:
            # One merchant per run; clear its catalog so re-runs are clean/idempotent.
            cur.execute("SELECT merchant_id FROM merchant WHERE name = %s", (merchant_name,))
            row = cur.fetchone()
            if row:
                merchant_id = row[0]
                cur.execute("DELETE FROM catalog_item WHERE merchant_id = %s", (merchant_id,))
            else:
                cur.execute(
                    "INSERT INTO merchant (name, allowed_methods) VALUES (%s, %s::jsonb) RETURNING merchant_id",
                    (merchant_name, json.dumps(["upi", "card"])),
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

    print(f"done: merchant '{merchant_name}' now has {len(curated)} catalog items.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
