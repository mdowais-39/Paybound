"""Ingest a real grocery catalog from the Instacart Market Basket dataset
(public, already downloaded to data/raw/instacart/ for the Phase 7 upsell
model — this reuses the same local files as a second dataset, not a re-split
of ABO) into `catalog_item`, as a genuinely different merchant/vertical from
the ABO-derived stores.

Instacart ships real product names + real aisle/department taxonomy but no
prices (it's an order-history dataset). Prices here are SYNTHESIZED per
department from plausible ₹ ranges, deterministic per item — same honesty
disclosure as ingest_abo.py: the product names/categories are real, the ₹
prices are generated.

Usage:
    python data/ingest_instacart.py                 # ~1000 items
    python data/ingest_instacart.py --limit 500
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import random
import sys
from pathlib import Path

import psycopg

RAW_DIR = Path(__file__).parent / "raw" / "instacart"
MERCHANT_NAME = "Paybound Fresh Grocery"

# Departments with no real products (Instacart's own catch-all buckets).
EXCLUDE_DEPARTMENTS = {"other", "missing"}

# Synthesized ₹ price ranges (whole rupees) keyed by Instacart department.
# Groceries are a genuinely low-ticket category by nature — no attempt here
# to inflate anything toward the ₹15,000 AFA threshold (that story already
# has real coverage from the ABO furniture/electronics/jewelry stores).
DEPT_PRICE_RANGES = {
    "alcohol": (300, 3500),
    "meat seafood": (150, 1400),
    "personal care": (80, 1200),
    "babies": (100, 1500),
    "household": (60, 1800),
    "pets": (100, 1600),
    "international": (60, 900),
    "frozen": (80, 700),
    "dairy eggs": (30, 500),
    "produce": (20, 400),
    "bakery": (40, 600),
}
DEFAULT_RANGE = (40, 800)


def load_lookup(filename: str) -> dict[int, str]:
    path = RAW_DIR / filename
    out: dict[int, str] = {}
    with open(path, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            key = int(next(v for k, v in row.items() if k.endswith("_id")))
            name = next(v for k, v in row.items() if not k.endswith("_id"))
            out[key] = name
    return out


def synth_price_paise(department: str, seed_key: str) -> int:
    lo, hi = DEPT_PRICE_RANGES.get(department, DEFAULT_RANGE)
    rng = random.Random(seed_key)  # deterministic per item
    rupees = rng.randint(lo, hi)
    return rupees * 100  # paise


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=1000, help="max items to ingest")
    ap.add_argument("--seed", type=int, default=42, help="sampling seed (deterministic)")
    args = ap.parse_args()

    if not (RAW_DIR / "products.csv").exists():
        print(f"ERROR: {RAW_DIR}/products.csv not found", file=sys.stderr)
        return 1

    db_url = os.environ.get("DATABASE_URL") or os.environ.get("PAYBOUND_DATABASE_URL")
    if not db_url:
        print("ERROR: set DATABASE_URL (or PAYBOUND_DATABASE_URL) in the environment/.env", file=sys.stderr)
        return 1
    db_url = db_url.replace("postgres://", "postgresql://", 1)

    aisles = load_lookup("aisles.csv")
    departments = load_lookup("departments.csv")

    with open(RAW_DIR / "products.csv", encoding="utf-8") as f:
        all_products = list(csv.DictReader(f))

    eligible = [
        p
        for p in all_products
        if departments.get(int(p["department_id"]), "other") not in EXCLUDE_DEPARTMENTS
    ]
    rng = random.Random(args.seed)
    rng.shuffle(eligible)  # spread the sample across departments, not just product_id order
    sample = eligible[: args.limit]

    curated = []
    for p in sample:
        dept = departments.get(int(p["department_id"]), "misc")
        category = aisles.get(int(p["aisle_id"]), dept)
        price_paise = synth_price_paise(dept, p["product_id"])
        curated.append(
            {
                "title": p["product_name"][:300],
                "category": category,
                "price_paise": price_paise,
                "variants": json.dumps([{"sku": p["product_id"], "size": "Std", "price_paise": price_paise}]),
            }
        )

    print(f"curated {len(curated)} items for '{MERCHANT_NAME}'; writing to DB ...", flush=True)

    with psycopg.connect(db_url) as conn:
        with conn.cursor() as cur:
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
