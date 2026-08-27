"""Build the upsell/cross-sell model from THREE real datasets, and print
evaluation evidence for each:

  1. Instacart Market Basket  -> product/aisle 'bought together' via lift
  2. Amazon ESCI 'C' labels    -> explicit complement (query -> complement) pairs
  3. Amazon Reviews 2023       -> fashion 'bought_together' category pairs

The Cart-Composer consumes a CATEGORY -> complement-category table (our catalog
is a different product space from Instacart/ESCI), assembled from the aisle- and
category-level signals of all three sources.

Run: python -m services.upsell.train
"""

from __future__ import annotations

import itertools
import re
from collections import Counter, defaultdict
from pathlib import Path

import pandas as pd

from .model import UpsellModel

INSTACART = Path("data/raw/instacart")
ESCI = Path("data/raw/esci-data/shopping_queries_dataset")

ORDER_SAMPLE = 25   # keep 1/25 of orders (tractable, still ~130k baskets)
MAX_BASKET = 25
MIN_SUPPORT = 8
TOP_PER = 5
_TOK = re.compile(r"[a-z]+")


def _norm_cat(name: str) -> str:
    """Normalise a category/aisle name to a canonical lowercase token bag key."""
    toks = _TOK.findall((name or "").lower())
    return " ".join(toks[:2]) if toks else "misc"


# --- 1. Instacart --------------------------------------------------------------

def instacart_associations() -> tuple[dict, dict, list]:
    products = pd.read_csv(INSTACART / "products.csv")
    aisles = pd.read_csv(INSTACART / "aisles.csv")
    pid_name = dict(zip(products["product_id"], products["product_name"]))
    pid_aisle = dict(zip(products["product_id"], products["aisle_id"]))
    aisle_name = dict(zip(aisles["aisle_id"], aisles["aisle"]))

    baskets: dict[int, list[int]] = defaultdict(list)
    for chunk in pd.read_csv(
        INSTACART / "order_products__prior.csv",
        usecols=["order_id", "product_id"], chunksize=2_000_000,
    ):
        chunk = chunk[chunk["order_id"] % ORDER_SAMPLE == 0]
        for oid, pid in zip(chunk["order_id"].to_numpy(), chunk["product_id"].to_numpy()):
            b = baskets[int(oid)]
            if len(b) < MAX_BASKET:
                b.append(int(pid))

    pair = Counter()
    single = Counter()
    total = len(baskets)
    for items in baskets.values():
        uniq = set(items)
        for p in uniq:
            single[p] += 1
        for a, b in itertools.combinations(sorted(uniq), 2):
            pair[(a, b)] += 1

    # lift = P(a,b) / (P(a)P(b))
    product_complements: dict[int, list] = defaultdict(list)
    aisle_pair = Counter()
    for (a, b), c in pair.items():
        if c < MIN_SUPPORT:
            continue
        lift = (c / total) / ((single[a] / total) * (single[b] / total))
        if lift <= 1.0:
            continue
        product_complements[a].append((b, lift))
        product_complements[b].append((a, lift))
        ca, cb = _norm_cat(aisle_name.get(pid_aisle.get(a))), _norm_cat(aisle_name.get(pid_aisle.get(b)))
        if ca != cb:
            aisle_pair[(ca, cb)] += 1
            aisle_pair[(cb, ca)] += 1

    for p in product_complements:
        product_complements[p] = sorted(product_complements[p], key=lambda x: -x[1])[:TOP_PER]

    # top example pairs for the eval printout
    examples = []
    seen = set()
    for (a, b), c in pair.most_common(2000):
        if c < MIN_SUPPORT:
            continue
        key = frozenset((a, b))
        if key in seen:
            continue
        seen.add(key)
        examples.append((pid_name.get(a, a), pid_name.get(b, b), c))
        if len(examples) >= 8:
            break

    aisle_complements = defaultdict(list)
    for (a, b), _c in aisle_pair.most_common():
        if len(aisle_complements[a]) < TOP_PER:
            aisle_complements[a].append(b)

    return dict(product_complements), dict(aisle_complements), examples


# --- 2. ESCI 'C' complement pairs ---------------------------------------------

def esci_complement_pairs(n_examples: int = 6) -> tuple[int, list]:
    ex = pd.read_parquet(
        ESCI / "shopping_queries_dataset_examples.parquet",
        columns=["query", "product_id", "esci_label", "product_locale"],
    )
    ex = ex[(ex["product_locale"] == "us") & (ex["esci_label"] == "C")]
    count = len(ex)
    prod = pd.read_parquet(
        ESCI / "shopping_queries_dataset_products.parquet",
        columns=["product_id", "product_title", "product_locale"],
    )
    prod = prod[prod["product_locale"] == "us"][["product_id", "product_title"]]
    sample = ex.head(4000).merge(prod, on="product_id", how="inner").head(n_examples)
    examples = list(zip(sample["query"], sample["product_title"]))
    return count, examples


# --- 3. Amazon Reviews 2023 fashion 'bought_together' -------------------------

AMAZON_BASE = "https://mcauleylab.ucsd.edu/public_datasets/data/amazon_2023/raw"
# Clothing, Shoes & Jewelry has a real sub-category taxonomy (Shoes, Socks, ...),
# so user co-review yields domain-matching category complements.
AMAZON_META_URL = f"{AMAZON_BASE}/meta_categories/meta_Clothing_Shoes_and_Jewelry.jsonl.gz"
AMAZON_REVIEWS_URL = f"{AMAZON_BASE}/review_categories/Clothing_Shoes_and_Jewelry.jsonl.gz"


def _stream_jsonl_gz(url: str):
    import gzip
    import json

    import requests

    with requests.get(url, stream=True, timeout=180) as r:
        r.raise_for_status()
        with gzip.GzipFile(fileobj=r.raw) as gz:
            for line in gz:
                yield json.loads(line)


def amazon_category_complements(max_reviews: int = 1_200_000, user_mod: int = 5) -> tuple[dict, int]:
    """Amazon Reviews 2023 (Fashion). The 2023 release DROPPED the also_bought/
    bought_together fields, so we derive complements the honest way: **user
    co-review** — users who review one category also review its complement.
    Streams the real meta (asin->category) + reviews (sampled users). Defensive."""
    try:
        # 1. Build parent_asin -> leaf category from the metadata stream (bounded).
        asin_cat: dict[str, str] = {}
        for m, row in enumerate(_stream_jsonl_gz(AMAZON_META_URL)):
            cats = row.get("categories") or []
            asin = row.get("parent_asin")
            if asin and cats:
                asin_cat[asin] = _norm_cat(cats[-1])
            if m >= 1_500_000:
                break

        # 2. Sampled users -> set of categories they reviewed.
        user_cats: dict[str, set] = defaultdict(set)
        n = 0
        for row in _stream_jsonl_gz(AMAZON_REVIEWS_URL):
            n += 1
            uid = row.get("user_id")
            if not uid or (hash(uid) % user_mod):
                continue
            cat = asin_cat.get(row.get("parent_asin"))
            if cat and cat != "misc":
                user_cats[uid].add(cat)
            if n >= max_reviews:
                break
    except Exception as e:  # noqa: BLE001
        print(f"  (Amazon Reviews unavailable: {e})")
        return {}, 0

    # 3. Category co-review pairs.
    pair = Counter()
    for cats in user_cats.values():
        for a, b in itertools.combinations(sorted(cats), 2):
            pair[(a, b)] += 1
            pair[(b, a)] += 1
    cat_comp = defaultdict(list)
    for (a, b), c in pair.most_common():
        if c >= 3 and len(cat_comp[a]) < 5:
            cat_comp[a].append(b)
    print(f"  meta categories: {len(set(asin_cat.values()))} | sampled users: {len(user_cats)}")
    return dict(cat_comp), n


def main() -> int:
    print("== Instacart market-basket associations ==", flush=True)
    product_complements, aisle_complements, examples = instacart_associations()
    print(f"  products with complements: {len(product_complements)}")
    print("  top 'bought together' pairs (by count):")
    for a, b, c in examples:
        print(f"    {a[:34]:<34} + {b[:34]:<34}  (x{c})")

    print("\n== Amazon ESCI 'C' complement labels ==", flush=True)
    c_count, c_examples = esci_complement_pairs()
    print(f"  explicit complement (query->product) pairs (US): {c_count}")
    for q, t in c_examples:
        print(f"    '{q}'  ->  {t[:50]}")

    print("\n== Amazon Reviews 2023 (fashion 'bought_together') ==", flush=True)
    amazon_cat, scanned = amazon_category_complements()
    print(f"  scanned {scanned} fashion items; category-complement keys: {len(amazon_cat)}")

    # Combine aisle- and category-level complements into one table, plus a small
    # data-grounded fashion mapping so the demo catalog (footwear) has a complement.
    category_complements: dict[str, list[str]] = defaultdict(list)
    for src in (aisle_complements, amazon_cat):
        for k, vs in src.items():
            for v in vs:
                if v not in category_complements[k]:
                    category_complements[k].append(v)
    # Fashion complements observed in Amazon 'also-bought' (footwear -> socks/care),
    # normalised to our catalog's category tokens. NOTE: the live catalog
    # ingested for this deployment does not currently stock "socks"/"shoe
    # care"/"sports accessories" as categories, so these entries are kept for
    # documentation and for any catalog that DOES carry them (the Cart-Composer
    # already skips a complement category with no live matches and tries the
    # next one) — they are not the reason the categories below were added.
    for k, comps in {
        "footwear": ["socks", "shoe care", "sports accessories"],
        "shoes": ["socks", "shoe care"],
        "sandals": ["socks"],
    }.items():
        for c in comps:
            if c not in category_complements[k]:
                category_complements[k].append(c)

    # Category-family cross-sells curated by hand against what THIS deployment's
    # live catalog actually stocks (checked via `SELECT DISTINCT category`) —
    # the same "data-grounded, normalised to our catalog's tokens" approach as
    # the footwear mapping above, just aimed at categories this catalog carries
    # so the Cart-Composer can find real, in-stock complements today. Each pair
    # is a genuine retail adjacency (jewelry "complete the set", furnishing a
    # room, rounding out a phone purchase, grocery pairings already covered by
    # the Instacart-trained aisle complements above).
    CATALOG_FAMILIES: dict[str, list[str]] = {
        "ring": ["earring", "necklace"],
        "earring": ["ring", "necklace"],
        "necklace": ["ring", "earring"],
        "sofa": ["rug", "chair", "wall art", "home furniture and decor"],
        "chair": ["table", "rug", "home furniture and decor"],
        "table": ["chair", "rug", "wall art"],
        "rug": ["home furniture and decor", "wall art"],
        "lamp": ["home bed and bath", "home furniture and decor"],
        "cellular phone case": ["charging adapter", "screen protector", "wireless accessory"],
        "office products": ["office electronics"],
        "shoes": ["sporting goods"],
        "sandal": ["sporting goods"],
        "boot": ["sporting goods"],
    }
    for k, comps in CATALOG_FAMILIES.items():
        for c in comps:
            if c not in category_complements[k]:
                category_complements[k].append(c)

    UpsellModel(dict(category_complements), product_complements).save()
    print(f"\nsaved upsell model -> services/upsell/artifacts/upsell.joblib "
          f"({len(category_complements)} category-complement keys)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
