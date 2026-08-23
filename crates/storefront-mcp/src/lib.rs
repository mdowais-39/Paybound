//! MCP storefront (merchant side): the typed, bounded tool surface an external
//! agent shops through. Five tools — `search_catalog`, `get_availability`,
//! `get_variants`, `create_cart`, and `checkout`. **`checkout` does NOT pay**:
//! it assembles the exact cart, submits it to the Mandate & Consent Kernel, and
//! returns the kernel's decision. The agent has no tool that spends money.

pub mod discovery;
pub mod mcp;

use domain::{Cart, CartLineItem, Paise};
use kernel::{evaluate, KernelDecision, KernelInput};
use ledger::{repos, AuditLedger, Db};
use serde::{Deserialize, Serialize};
use serde_json::json;
use time::OffsetDateTime;
use uuid::Uuid;

use common::AppError;

/// The storefront, backed by the catalog/ledger database.
#[derive(Clone)]
pub struct Storefront {
    pool: Db,
}

// ---- Tool I/O views ---------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct CatalogItemView {
    pub item_id: Uuid,
    pub title: String,
    pub category: String,
    pub price_paise: Paise,
    pub availability: bool,
}

#[derive(Debug, Serialize)]
pub struct AvailabilityView {
    pub item_id: Uuid,
    pub available: bool,
    pub price_paise: Paise,
}

#[derive(Debug, Serialize)]
pub struct VariantsView {
    pub item_id: Uuid,
    pub variants: serde_json::Value,
}

#[derive(Debug, Deserialize)]
pub struct CartItemReq {
    pub item_id: Uuid,
    #[serde(default = "one")]
    pub qty: i64,
}
fn one() -> i64 {
    1
}

#[derive(Debug, Serialize)]
pub struct CartView {
    pub cart_id: Uuid,
    pub session_id: Uuid,
    pub merchant_id: Uuid,
    pub line_items: Vec<CartLineItem>,
    pub total_paise: Paise,
}

#[derive(Debug, Serialize)]
pub struct CheckoutResult {
    /// "approved" | "refused" | "needs_human"
    pub verdict: String,
    pub rule_cited: Option<String>,
    pub human_message: Option<String>,
    pub amount_paise: Paise,
    pub cart_hash: String,
}

impl Storefront {
    pub fn new(pool: Db) -> Self {
        Self { pool }
    }

    /// Search the catalog. Placeholder ranking (category match first, then
    /// cheaper): the Phase 7 trained ranker swaps in behind this same signature.
    pub async fn search_catalog(
        &self,
        query: &str,
        limit: i64,
    ) -> Result<Vec<CatalogItemView>, AppError> {
        let pattern = format!("%{query}%");
        let rows = sqlx::query!(
            "SELECT item_id, title, category, price_paise, availability
             FROM catalog_item
             WHERE title ILIKE $1 OR category ILIKE $1
             ORDER BY (CASE WHEN category ILIKE $1 THEN 0 ELSE 1 END), price_paise
             LIMIT $2",
            pattern,
            limit,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(db)?;

        Ok(rows
            .into_iter()
            .map(|r| CatalogItemView {
                item_id: r.item_id,
                title: r.title,
                category: r.category,
                price_paise: r.price_paise,
                availability: r.availability,
            })
            .collect())
    }

    /// Live availability + price for one item.
    pub async fn get_availability(&self, item_id: Uuid) -> Result<AvailabilityView, AppError> {
        let r = sqlx::query!(
            "SELECT availability, price_paise FROM catalog_item WHERE item_id = $1",
            item_id
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(db)?
        .ok_or_else(|| AppError::NotFound(format!("item {item_id}")))?;
        Ok(AvailabilityView {
            item_id,
            available: r.availability,
            price_paise: r.price_paise,
        })
    }

    /// Variant resolution (size/colour) for one item.
    pub async fn get_variants(&self, item_id: Uuid) -> Result<VariantsView, AppError> {
        let variants = sqlx::query_scalar!(
            "SELECT variants FROM catalog_item WHERE item_id = $1",
            item_id
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(db)?
        .ok_or_else(|| AppError::NotFound(format!("item {item_id}")))?;
        Ok(VariantsView { item_id, variants })
    }

    /// Assemble a cart from catalog items (single merchant), persist it as a
    /// Cart Mandate bound to the session, and return it. Prices/categories come
    /// from the catalog — the agent cannot invent them.
    pub async fn create_cart(
        &self,
        session_id: Uuid,
        items: &[CartItemReq],
    ) -> Result<CartView, AppError> {
        if items.is_empty() {
            return Err(AppError::InvalidInput("cart is empty".into()));
        }

        let mut line_items = Vec::with_capacity(items.len());
        let mut merchant_id: Option<Uuid> = None;
        let mut total: Paise = 0;

        for req in items {
            if req.qty <= 0 {
                return Err(AppError::InvalidInput("qty must be positive".into()));
            }
            let r = sqlx::query!(
                "SELECT merchant_id, category, price_paise FROM catalog_item WHERE item_id = $1",
                req.item_id
            )
            .fetch_optional(&self.pool)
            .await
            .map_err(db)?
            .ok_or_else(|| AppError::NotFound(format!("item {}", req.item_id)))?;

            match merchant_id {
                None => merchant_id = Some(r.merchant_id),
                Some(m) if m != r.merchant_id => {
                    return Err(AppError::InvalidInput(
                        "all cart items must be from one merchant".into(),
                    ));
                }
                _ => {}
            }

            total += r.price_paise.saturating_mul(req.qty);
            line_items.push(CartLineItem {
                item_id: req.item_id,
                qty: req.qty,
                price_paise: r.price_paise,
                category: r.category,
            });
        }

        let merchant_id = merchant_id.expect("non-empty cart has a merchant");

        // Tie the cart to its intent mandate via the mandate's signature.
        let session = repos::get_session(&self.pool, session_id).await?;
        let mandate = repos::get_intent_mandate(&self.pool, session.mandate_id).await?;
        let intent_hash = mandate.signature.clone();

        let line_items_json = serde_json::to_value(&line_items)?;
        let cart_id = sqlx::query_scalar!(
            "INSERT INTO cart_mandate (session_id, line_items, total_paise, merchant_id, intent_hash)
             VALUES ($1, $2, $3, $4, $5) RETURNING cart_id",
            session_id,
            line_items_json,
            total,
            merchant_id,
            intent_hash,
        )
        .fetch_one(&self.pool)
        .await
        .map_err(db)?;

        repos::set_session_state(&self.pool, session_id, "CART_BUILT").await?;

        Ok(CartView {
            cart_id,
            session_id,
            merchant_id,
            line_items,
            total_paise: total,
        })
    }

    /// Submit a built cart to the kernel. **Does not pay.** Returns the kernel's
    /// decision, records a gate_decision + audit entry, and transitions the
    /// session to AUTHORIZED / NEEDS_HUMAN / REFUSED.
    pub async fn checkout(
        &self,
        session_id: Uuid,
        cart_id: Uuid,
    ) -> Result<CheckoutResult, AppError> {
        // Reconstruct the exact cart from the persisted Cart Mandate.
        let row = sqlx::query!(
            "SELECT line_items, total_paise, merchant_id
             FROM cart_mandate WHERE cart_id = $1 AND session_id = $2",
            cart_id,
            session_id
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(db)?
        .ok_or_else(|| AppError::NotFound(format!("cart {cart_id}")))?;

        let line_items: Vec<CartLineItem> = serde_json::from_value(row.line_items)?;
        let cart = Cart {
            merchant_id: row.merchant_id,
            line_items,
            total_paise: row.total_paise,
        };

        let session = repos::get_session(&self.pool, session_id).await?;
        let mandate = repos::get_intent_mandate(&self.pool, session.mandate_id).await?;

        let decision = evaluate(&KernelInput {
            mandate: &mandate,
            cart: &cart,
            running_spend_paise: session.running_spend_paise,
            now: OffsetDateTime::now_utc(),
            expected_cart_hash: None,
        });

        let (verdict, rule_cited, human_message, new_state) = match &decision {
            KernelDecision::Approved(_) => ("approved", None, None, "AUTHORIZED"),
            KernelDecision::Refused(reason) => {
                let verdict = reason.verdict();
                let state = match verdict {
                    domain::Verdict::NeedsHuman => "NEEDS_HUMAN",
                    _ => "REFUSED",
                };
                (
                    verdict.as_db_str(),
                    Some(reason.as_str().to_string()),
                    Some(reason.human_message().to_string()),
                    state,
                )
            }
        };

        // Record the decision (gate_decision) and append to the audit chain.
        repos::record_gate_decision(
            &self.pool,
            session_id,
            Some(cart_id),
            verdict,
            rule_cited.as_deref(),
        )
        .await?;
        AuditLedger::new(&self.pool)
            .append(
                session_id,
                domain::AuditEventType::GateDecision,
                json!({
                    "verdict": verdict,
                    "rule_cited": rule_cited,
                    "amount_paise": cart.total_paise,
                    "cart_hash": cart.cart_hash(),
                }),
            )
            .await?;
        repos::set_session_state(&self.pool, session_id, new_state).await?;

        Ok(CheckoutResult {
            verdict: verdict.to_string(),
            rule_cited,
            human_message,
            amount_paise: cart.total_paise,
            cart_hash: cart.cart_hash(),
        })
    }
}

fn db(e: sqlx::Error) -> AppError {
    AppError::Internal(format!("db: {e}"))
}
