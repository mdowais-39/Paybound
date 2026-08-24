//! The adversarial battery — the "bounds hold" evidence. It deliberately tries
//! every way to make the agent misbehave and asserts each is blocked at the
//! kernel gate with the correct typed reason. Prints a Markdown table and
//! writes it to docs/BOUNDS_HOLD.md. Exits non-zero if any bound fails to hold.
//!
//! Run: cargo run -p harness --bin adversarial

use common::signing::{generate_keypair, Ed25519SigningKey};
use domain::{Cart, CartLineItem, IntentMandate};
use kernel::{evaluate, KernelDecision, KernelInput, RefusalReason};
use std::fmt::Write as _;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

const MERCHANT: Uuid = Uuid::from_u128(0x1111_1111_1111_1111_1111_1111_1111_1111);

fn mandate(key: &Ed25519SigningKey, budget: i64, per_txn: i64) -> IntentMandate {
    IntentMandate::new_signed(
        key,
        Uuid::new_v4(),
        "user_owais",
        budget,
        per_txn,
        vec!["footwear".into()],
        vec![MERCHANT],
        OffsetDateTime::now_utc() + Duration::hours(1),
        "buy running shoes under ₹3,000",
    )
}

fn cart(total: i64, category: &str, merchant: Uuid) -> Cart {
    Cart {
        merchant_id: merchant,
        line_items: vec![CartLineItem {
            item_id: Uuid::new_v4(),
            qty: 1,
            price_paise: total,
            category: category.into(),
        }],
        total_paise: total,
    }
}

fn base_input<'a>(m: &'a IntentMandate, c: &'a Cart) -> KernelInput<'a> {
    KernelInput {
        mandate: m,
        cart: c,
        running_spend_paise: 0,
        now: OffsetDateTime::now_utc(),
        expected_cart_hash: None,
        afa_approved: false,
        revoked: false,
    }
}

/// The outcome we describe in the table.
fn outcome(d: &KernelDecision) -> (String, String) {
    match d {
        KernelDecision::Approved(_) => ("approved".into(), "—".into()),
        KernelDecision::Refused(r) => (r.verdict().as_db_str().into(), r.as_str().into()),
    }
}

fn main() {
    let key = generate_keypair();

    // Each row: (attack description, the decision, expected outcome predicate).
    let mut rows: Vec<(String, KernelDecision, bool)> = Vec::new();
    let mut all_hold = true;

    // 0. Baseline: a legitimate in-bounds cart must be APPROVED.
    {
        let m = mandate(&key, 300_000, 300_000);
        let c = cart(285_000, "footwear", MERCHANT);
        let d = evaluate(&base_input(&m, &c));
        let ok = matches!(d, KernelDecision::Approved(_));
        all_hold &= ok;
        rows.push(("(baseline) a legitimate ₹2,850 footwear cart".into(), d, ok));
    }

    // A little helper for refusal scenarios.
    let mut check = |desc: &str, d: KernelDecision, expect: RefusalReason| {
        let ok = matches!(&d, KernelDecision::Refused(r) if *r == expect);
        all_hold &= ok;
        rows.push((desc.into(), d, ok));
    };

    // 1. Tampered mandate (signature).
    {
        let mut m = mandate(&key, 300_000, 300_000);
        m.budget_total_paise = 9_999_999; // tamper after signing
        let c = cart(285_000, "footwear", MERCHANT);
        check(
            "tamper the signed budget to ₹99,999",
            evaluate(&base_input(&m, &c)),
            RefusalReason::SignatureInvalid,
        );
    }
    // 2. Expired mandate.
    {
        let m = mandate(&key, 300_000, 300_000);
        let c = cart(285_000, "footwear", MERCHANT);
        let mut inp = base_input(&m, &c);
        inp.now = m.ttl + Duration::seconds(1);
        check(
            "buy after the mandate's TTL expired",
            evaluate(&inp),
            RefusalReason::MandateExpired,
        );
    }
    // 3. Over per-transaction cap.
    {
        let m = mandate(&key, 1_000_000, 200_000); // cap ₹2,000
        let c = cart(285_000, "footwear", MERCHANT); // ₹2,850
        check(
            "a ₹2,850 cart against a ₹2,000 per-txn cap",
            evaluate(&base_input(&m, &c)),
            RefusalReason::OverPerTxnCap,
        );
    }
    // 4. Over cumulative budget.
    {
        let m = mandate(&key, 300_000, 300_000);
        let c = cart(285_000, "footwear", MERCHANT);
        let mut inp = base_input(&m, &c);
        inp.running_spend_paise = 100_000; // 2,850 + 1,000 > 3,000
        check(
            "a cart that breaches the ₹3,000 cumulative budget",
            evaluate(&inp),
            RefusalReason::OverCumulativeBudget,
        );
    }
    // 5. Out-of-category.
    {
        let m = mandate(&key, 300_000, 300_000);
        let c = cart(285_000, "electronics", MERCHANT);
        check(
            "buy an out-of-category (electronics) item",
            evaluate(&base_input(&m, &c)),
            RefusalReason::CategoryNotAllowed,
        );
    }
    // 6. Out-of-merchant.
    {
        let m = mandate(&key, 300_000, 300_000);
        let c = cart(285_000, "footwear", Uuid::new_v4());
        check(
            "buy from an unauthorized merchant",
            evaluate(&base_input(&m, &c)),
            RefusalReason::MerchantNotAllowed,
        );
    }
    // 7. Cart integrity / price drift.
    {
        let m = mandate(&key, 300_000, 300_000);
        let mut c = cart(285_000, "footwear", MERCHANT);
        c.total_paise = 200_000; // claim ₹2,000 but the item is ₹2,850
        check(
            "price-drift: claim ₹2,000 for a ₹2,850 item",
            evaluate(&base_input(&m, &c)),
            RefusalReason::CartIntegrityMismatch,
        );
    }
    // 8. Above the ₹15,000 AFA gate → needs human.
    {
        let m = mandate(&key, 5_000_000, 5_000_000);
        let c = cart(2_000_000, "footwear", MERCHANT); // ₹20,000
        check(
            "a ₹20,000 cart above the ₹15,000 AFA gate",
            evaluate(&base_input(&m, &c)),
            RefusalReason::RequiresHumanAFA,
        );
    }
    // 9. Revoked mandate.
    {
        let m = mandate(&key, 300_000, 300_000);
        let c = cart(285_000, "footwear", MERCHANT);
        let mut inp = base_input(&m, &c);
        inp.revoked = true;
        check(
            "buy after the human revoked the mandate",
            evaluate(&inp),
            RefusalReason::MandateRevoked,
        );
    }

    // Render the table.
    let mut table = String::new();
    writeln!(table, "# Paybound — Bounds Hold\n").unwrap();
    writeln!(
        table,
        "Every attempted violation is blocked at the kernel gate with a typed reason.\n"
    )
    .unwrap();
    writeln!(
        table,
        "| # | Attempted action | Verdict | Rule cited | Bound holds |"
    )
    .unwrap();
    writeln!(table, "|---|---|---|---|---|").unwrap();
    for (i, (desc, d, ok)) in rows.iter().enumerate() {
        let (verdict, rule) = outcome(d);
        writeln!(
            table,
            "| {} | {} | `{}` | `{}` | {} |",
            i,
            desc,
            verdict,
            rule,
            if *ok { "✅" } else { "❌" }
        )
        .unwrap();
    }
    writeln!(
        table,
        "\n**{} / {} bounds hold.**",
        rows.iter().filter(|r| r.2).count(),
        rows.len()
    )
    .unwrap();

    print!("{table}");
    let _ = std::fs::write("docs/BOUNDS_HOLD.md", &table);

    if !all_hold {
        eprintln!("\nFAIL: at least one bound did not hold.");
        std::process::exit(1);
    }
    println!("\nAll bounds hold. (wrote docs/BOUNDS_HOLD.md)");
}
