//! Exhaustive tests for the Mandate & Consent Kernel: a PASS and a FAIL case
//! for every `RefusalReason`, plus the ₹15,000 AFA boundary. This suite is
//! itself a deliverable — it is the evidence that the bounds are real.

use common::signing::{generate_keypair, Ed25519SigningKey};
use domain::{Cart, CartLineItem, IntentMandate};
use kernel::{evaluate, KernelDecision, KernelInput, RefusalReason};
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

const MERCHANT: &str = "11111111-1111-1111-1111-111111111111";

fn merchant_id() -> Uuid {
    Uuid::parse_str(MERCHANT).unwrap()
}

/// A mandate that authorizes footwear from one merchant, ₹3,000 budget and
/// per-transaction cap, valid for an hour.
fn valid_mandate(key: &Ed25519SigningKey) -> IntentMandate {
    IntentMandate::new_signed(
        key,
        Uuid::new_v4(),
        "user_owais",
        300_000, // budget ₹3,000
        300_000, // per-txn ₹3,000
        vec!["footwear".into()],
        vec![merchant_id()],
        OffsetDateTime::now_utc() + Duration::hours(1),
        "buy running shoes under ₹3,000",
    )
}

/// A cart of `total` paise for a single footwear item at the authorized merchant,
/// internally consistent (claimed total == item total).
fn cart(total: i64) -> Cart {
    Cart {
        merchant_id: merchant_id(),
        line_items: vec![CartLineItem {
            item_id: Uuid::new_v4(),
            qty: 1,
            price_paise: total,
            category: "footwear".into(),
        }],
        total_paise: total,
    }
}

fn input<'a>(
    m: &'a IntentMandate,
    c: &'a Cart,
    running_spend: i64,
    now: OffsetDateTime,
) -> KernelInput<'a> {
    KernelInput {
        mandate: m,
        cart: c,
        running_spend_paise: running_spend,
        now,
        expected_cart_hash: None,
        afa_approved: false,
    }
}

fn now() -> OffsetDateTime {
    OffsetDateTime::now_utc()
}

fn refusal(d: KernelDecision) -> RefusalReason {
    match d {
        KernelDecision::Refused(r) => r,
        KernelDecision::Approved(_) => panic!("expected a refusal, got Approved"),
    }
}

// --- The happy path (the adjacent PASS shared by several cases) ---------------

#[test]
fn approves_an_in_bounds_cart() {
    let key = generate_keypair();
    let m = valid_mandate(&key);
    let c = cart(285_000); // ₹2,850, within all bounds
    match evaluate(&input(&m, &c, 0, now())) {
        KernelDecision::Approved(auth) => {
            assert_eq!(auth.amount_paise, 285_000);
            assert_eq!(auth.mandate_id, m.mandate_id);
        }
        other => panic!("expected Approved, got {other:?}"),
    }
}

// --- 1. SignatureInvalid ------------------------------------------------------

#[test]
fn signature_invalid_when_mandate_tampered_after_signing() {
    let key = generate_keypair();
    let mut m = valid_mandate(&key);
    m.budget_total_paise = 9_999_999; // tamper an authorized field post-signature
    let c = cart(285_000);
    assert_eq!(
        refusal(evaluate(&input(&m, &c, 0, now()))),
        RefusalReason::SignatureInvalid
    );
    // adjacent pass: the same cart under an untampered mandate approves
    let good = valid_mandate(&key);
    assert!(matches!(
        evaluate(&input(&good, &c, 0, now())),
        KernelDecision::Approved(_)
    ));
}

// --- 2. MandateExpired --------------------------------------------------------

#[test]
fn mandate_expired_when_now_after_ttl() {
    let key = generate_keypair();
    let m = valid_mandate(&key);
    let c = cart(285_000);
    let later = m.ttl + Duration::seconds(1);
    assert_eq!(
        refusal(evaluate(&input(&m, &c, 0, later))),
        RefusalReason::MandateExpired
    );
    // adjacent pass: exactly at ttl is still valid
    assert!(matches!(
        evaluate(&input(&m, &c, 0, m.ttl)),
        KernelDecision::Approved(_)
    ));
}

// --- 3. OverPerTxnCap ---------------------------------------------------------

#[test]
fn over_per_txn_cap() {
    let key = generate_keypair();
    // per-txn cap ₹2,000, budget ₹10,000 so only the per-txn cap fires
    let m = IntentMandate::new_signed(
        &key,
        Uuid::new_v4(),
        "user_owais",
        1_000_000,
        200_000,
        vec!["footwear".into()],
        vec![merchant_id()],
        OffsetDateTime::now_utc() + Duration::hours(1),
        "goal",
    );
    let over = cart(285_000); // ₹2,850 > ₹2,000 cap
    assert_eq!(
        refusal(evaluate(&input(&m, &over, 0, now()))),
        RefusalReason::OverPerTxnCap
    );
    let ok = cart(150_000); // ₹1,500 ≤ cap
    assert!(matches!(
        evaluate(&input(&m, &ok, 0, now())),
        KernelDecision::Approved(_)
    ));
}

// --- 4. OverCumulativeBudget --------------------------------------------------

#[test]
fn over_cumulative_budget() {
    let key = generate_keypair();
    let m = valid_mandate(&key); // budget ₹3,000, per-txn ₹3,000
    let c = cart(285_000); // ₹2,850
                           // running spend ₹1,000 → 2,850 + 1,000 = 3,850 > 3,000
    assert_eq!(
        refusal(evaluate(&input(&m, &c, 100_000, now()))),
        RefusalReason::OverCumulativeBudget
    );
    // adjacent pass: running spend ₹100 → 2,950 ≤ 3,000
    assert!(matches!(
        evaluate(&input(&m, &c, 10_000, now())),
        KernelDecision::Approved(_)
    ));
}

// --- 5. CategoryNotAllowed ----------------------------------------------------

#[test]
fn category_not_allowed() {
    let key = generate_keypair();
    let m = valid_mandate(&key); // allows "footwear"
    let mut c = cart(285_000);
    c.line_items[0].category = "electronics".into();
    assert_eq!(
        refusal(evaluate(&input(&m, &c, 0, now()))),
        RefusalReason::CategoryNotAllowed
    );
    // adjacent pass: an allowed category approves
    let ok = cart(285_000); // category "footwear"
    assert!(matches!(
        evaluate(&input(&m, &ok, 0, now())),
        KernelDecision::Approved(_)
    ));
}

// --- 6. MerchantNotAllowed ----------------------------------------------------

#[test]
fn merchant_not_allowed() {
    let key = generate_keypair();
    let m = valid_mandate(&key); // allows only `merchant_id()`
    let mut c = cart(285_000);
    c.merchant_id = Uuid::new_v4(); // a different merchant
    assert_eq!(
        refusal(evaluate(&input(&m, &c, 0, now()))),
        RefusalReason::MerchantNotAllowed
    );
    // adjacent pass: the authorized merchant approves
    let ok = cart(285_000); // merchant_id() is authorized
    assert!(matches!(
        evaluate(&input(&m, &ok, 0, now())),
        KernelDecision::Approved(_)
    ));
}

// --- 7. CartIntegrityMismatch -------------------------------------------------

#[test]
fn cart_integrity_mismatch_on_claimed_total() {
    let key = generate_keypair();
    let m = valid_mandate(&key);
    let mut c = cart(285_000);
    c.total_paise = 200_000; // claim ₹2,000 but the item is ₹2,850
    assert_eq!(
        refusal(evaluate(&input(&m, &c, 0, now()))),
        RefusalReason::CartIntegrityMismatch
    );
}

#[test]
fn cart_integrity_mismatch_on_expected_hash_drift() {
    let key = generate_keypair();
    let m = valid_mandate(&key);
    let c = cart(285_000);
    let stale_hash = "0000000000000000000000000000000000000000000000000000000000000000";
    let inp = KernelInput {
        mandate: &m,
        cart: &c,
        running_spend_paise: 0,
        now: now(),
        expected_cart_hash: Some(stale_hash),
        afa_approved: false,
    };
    assert_eq!(
        refusal(evaluate(&inp)),
        RefusalReason::CartIntegrityMismatch
    );
    // adjacent pass: the cart's own hash matches
    let good = c.cart_hash();
    let inp_ok = KernelInput {
        mandate: &m,
        cart: &c,
        running_spend_paise: 0,
        now: now(),
        expected_cart_hash: Some(&good),
        afa_approved: false,
    };
    assert!(matches!(evaluate(&inp_ok), KernelDecision::Approved(_)));
}

// --- 8. RequiresHumanAFA + the ₹15,000 boundary -------------------------------

#[test]
fn afa_threshold_routes_above_15k_to_human_and_passes_at_or_below() {
    let key = generate_keypair();
    // Wide caps so only the AFA rule can fire.
    let m = IntentMandate::new_signed(
        &key,
        Uuid::new_v4(),
        "user_owais",
        5_000_000,
        5_000_000,
        vec!["footwear".into()],
        vec![merchant_id()],
        OffsetDateTime::now_utc() + Duration::hours(1),
        "goal",
    );

    // ₹15,001 → RequiresHumanAFA
    assert_eq!(
        refusal(evaluate(&input(&m, &cart(1_500_100), 0, now()))),
        RefusalReason::RequiresHumanAFA
    );
    // ₹14,999 → Approved
    assert!(matches!(
        evaluate(&input(&m, &cart(1_499_900), 0, now())),
        KernelDecision::Approved(_)
    ));
    // exactly ₹15,000 is AFA-exempt → Approved
    assert!(matches!(
        evaluate(&input(&m, &cart(1_500_000), 0, now())),
        KernelDecision::Approved(_)
    ));
}

// --- Verdict mapping ----------------------------------------------------------

#[test]
fn requires_human_afa_maps_to_needs_human_verdict_others_to_refused() {
    use domain::Verdict;
    assert_eq!(
        RefusalReason::RequiresHumanAFA.verdict(),
        Verdict::NeedsHuman
    );
    for r in [
        RefusalReason::SignatureInvalid,
        RefusalReason::MandateExpired,
        RefusalReason::OverPerTxnCap,
        RefusalReason::OverCumulativeBudget,
        RefusalReason::CategoryNotAllowed,
        RefusalReason::MerchantNotAllowed,
        RefusalReason::CartIntegrityMismatch,
    ] {
        assert_eq!(r.verdict(), Verdict::Refused, "{:?} should be refused", r);
    }
}

// --- AFA resume: human approval clears the ₹15,000 gate ----------------------

#[test]
fn afa_approved_by_human_allows_above_15k() {
    let key = generate_keypair();
    let m = IntentMandate::new_signed(
        &key,
        Uuid::new_v4(),
        "user_owais",
        5_000_000,
        5_000_000,
        vec!["footwear".into()],
        vec![merchant_id()],
        OffsetDateTime::now_utc() + Duration::hours(1),
        "goal",
    );
    let c = cart(2_000_000); // ₹20,000 — above AFA
                             // Without approval → needs human.
    assert_eq!(
        refusal(evaluate(&input(&m, &c, 0, now()))),
        RefusalReason::RequiresHumanAFA
    );
    // With human approval → approved (other bounds still enforced).
    let approved = KernelInput {
        mandate: &m,
        cart: &c,
        running_spend_paise: 0,
        now: now(),
        expected_cart_hash: None,
        afa_approved: true,
    };
    assert!(matches!(evaluate(&approved), KernelDecision::Approved(_)));
}
