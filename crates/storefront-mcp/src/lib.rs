//! MCP storefront (merchant side): the typed, bounded tool surface an external
//! agent shops through. Five tools — `search_catalog`, `get_availability`,
//! `get_variants`, `create_cart`, and `checkout`. **`checkout` does NOT pay**:
//! it assembles the exact cart, submits it to the Mandate & Consent Kernel, and
//! returns the kernel's decision. The agent has no tool that spends money.

pub mod discovery;
pub mod mcp;

use domain::{Cart, CartLineItem, Paise};
use execution::ExecutionPlane;
use kernel::{evaluate, KernelDecision, KernelInput};
use ledger::{repos, AuditLedger, Db};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use time::OffsetDateTime;
use uuid::Uuid;

use common::AppError;

/// The storefront, backed by the catalog/ledger database. Optionally holds an
/// execution plane so an approved `checkout` triggers the PSP charge server-
/// side (the ACP merchant→PSP pattern) — the agent never gets a money tool.
#[derive(Clone)]
pub struct Storefront {
    pool: Db,
    exec: Option<Arc<ExecutionPlane>>,
}

// ---- Tool I/O views ---------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct CatalogItemView {
    pub item_id: Uuid,
    pub merchant_id: Uuid,
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
    /// Present so a caller can validate a chosen item against a mandate's
    /// allowed_categories/allowed_merchants without a second lookup (used by
    /// the agent's product-choice flow — see Orchestrator.select).
    pub title: String,
    pub category: String,
    pub merchant_id: Uuid,
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
    /// Present only when approved AND the storefront has an execution plane: the
    /// real Razorpay payment link the human pays. The agent never creates this.
    pub payment_link: Option<String>,
    pub razorpay_ref: Option<String>,
}

impl Storefront {
    /// Gate-only storefront (checkout returns the kernel verdict; no payment).
    pub fn new(pool: Db) -> Self {
        Self { pool, exec: None }
    }

    /// Storefront whose approved checkouts also trigger the PSP charge.
    pub fn with_execution(pool: Db, exec: Arc<ExecutionPlane>) -> Self {
        Self {
            pool,
            exec: Some(exec),
        }
    }

    /// Search the catalog. **Hybrid retrieval**: when a `query_embedding` is
    /// supplied (the discovery worker computes it with MiniLM), we take the
    /// semantic nearest-neighbours by pgvector cosine distance AND the lexical
    /// keyword matches, then merge them — so a query like "office chair" finds
    /// real office chairs even when they're filed under "home furniture" and
    /// share no literal words, while exact keyword hits are never lost. With no
    /// embedding (tests / older callers) it falls back to the keyword-only path.
    /// Either way this query's job is RECALL; the discovery worker's trained
    /// relevance ranker reranks the merged pool for precision.
    pub async fn search_catalog(
        &self,
        query: &str,
        limit: i64,
        query_embedding: Option<&[f32]>,
    ) -> Result<Vec<CatalogItemView>, AppError> {
        // 1. Semantic nearest-neighbours (only when an embedding is provided and
        //    items have been embedded). pgvector reads the text form '[..]'
        //    cast to ::vector; sqlx's checked macro doesn't know the vector
        //    type, so this arm uses the runtime query API.
        let mut items: Vec<CatalogItemView> = Vec::new();
        if let Some(emb) = query_embedding {
            let literal = vector_literal(emb);
            let semantic = sqlx::query_as::<_, (Uuid, Uuid, String, String, i64, bool)>(
                "SELECT item_id, merchant_id, title, category, price_paise, availability
                 FROM catalog_item
                 WHERE embedding IS NOT NULL
                 ORDER BY embedding <=> $1::vector
                 LIMIT $2",
            )
            .bind(&literal)
            .bind(limit)
            .fetch_all(&self.pool)
            .await
            .map_err(db)?;
            items.extend(semantic.into_iter().map(
                |(item_id, merchant_id, title, category, price_paise, availability)| {
                    CatalogItemView {
                        item_id,
                        merchant_id,
                        title,
                        category,
                        price_paise,
                        availability,
                    }
                },
            ));
        }

        // 2. Lexical keyword matches (always) — union'd in after the semantic
        //    hits, deduped by item_id, capped at `limit`.
        let pattern = format!("%{query}%");
        let tsquery = or_tsquery(query);
        let rows = sqlx::query!(
            "SELECT item_id, merchant_id, title, category, price_paise, availability
             FROM catalog_item
             WHERE to_tsvector('english', title || ' ' || category)
                     @@ to_tsquery('english', $1)
                OR title ILIKE $3
             ORDER BY ts_rank(to_tsvector('english', title || ' ' || category),
                              to_tsquery('english', $1)) DESC,
                      price_paise
             LIMIT $2",
            tsquery,
            limit,
            pattern,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(db)?;

        let mut seen: std::collections::HashSet<Uuid> = items.iter().map(|i| i.item_id).collect();
        for r in rows {
            if seen.insert(r.item_id) {
                items.push(CatalogItemView {
                    item_id: r.item_id,
                    merchant_id: r.merchant_id,
                    title: r.title,
                    category: r.category,
                    price_paise: r.price_paise,
                    availability: r.availability,
                });
            }
        }
        items.truncate(limit.max(0) as usize);
        Ok(items)
    }

    /// Live availability + price for one item.
    pub async fn get_availability(&self, item_id: Uuid) -> Result<AvailabilityView, AppError> {
        let r = sqlx::query!(
            "SELECT availability, price_paise, title, category, merchant_id
             FROM catalog_item WHERE item_id = $1",
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
            title: r.title,
            category: r.category,
            merchant_id: r.merchant_id,
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
    #[tracing::instrument(name = "storefront.create_cart", level = "info", skip(self, items), fields(%session_id))]
    pub async fn create_cart(
        &self,
        session_id: Uuid,
        items: &[CartItemReq],
    ) -> Result<CartView, AppError> {
        if items.is_empty() {
            return Err(AppError::InvalidInput("cart is empty".into()));
        }

        let mut line_items = Vec::with_capacity(items.len());
        //: The audit trail's own record of what was actually in the cart —
        //: title included, unlike `CartLineItem` below (the SIGNED envelope,
        //: kept intentionally minimal since it's part of the cart-hash/kernel
        //: money path). This is a separate, display-only structure, so
        //: enriching it can never change what the kernel gates on.
        let mut audit_items = Vec::with_capacity(items.len());
        let mut merchant_id: Option<Uuid> = None;
        let mut total: Paise = 0;

        for req in items {
            if req.qty <= 0 {
                return Err(AppError::InvalidInput("qty must be positive".into()));
            }
            let r = sqlx::query!(
                "SELECT merchant_id, category, price_paise, title FROM catalog_item WHERE item_id = $1",
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
            audit_items.push(json!({
                "item_id": req.item_id,
                "title": r.title,
                "category": r.category,
                "qty": req.qty,
                "price_paise": r.price_paise,
            }));
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

        AuditLedger::new(&self.pool)
            .append(
                session_id,
                domain::AuditEventType::CartBuilt,
                json!({
                    "cart_id": cart_id,
                    "total_paise": total,
                    "n_items": line_items.len(),
                    "line_items": audit_items,
                }),
            )
            .await?;
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
    #[tracing::instrument(name = "storefront.checkout", level = "info", skip(self), fields(%session_id, %cart_id))]
    pub async fn checkout(
        &self,
        session_id: Uuid,
        cart_id: Uuid,
        afa_approved: bool,
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
        let revoked = repos::is_mandate_revoked(&self.pool, session.mandate_id).await?;

        let decision = evaluate(&KernelInput {
            mandate: &mandate,
            cart: &cart,
            running_spend_paise: session.running_spend_paise,
            now: OffsetDateTime::now_utc(),
            expected_cart_hash: None,
            afa_approved,
            revoked,
        });

        let (verdict, rule_cited, human_message, new_state) = match &decision {
            KernelDecision::Approved(_) => ("approved", None, None, "AUTHORIZED"),
            KernelDecision::Refused(reason) => {
                let verdict = reason.verdict();
                let state = match (verdict, reason) {
                    (domain::Verdict::NeedsHuman, _) => "NEEDS_HUMAN",
                    (_, kernel::RefusalReason::MandateRevoked) => "REVOKED",
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
        // Titles are display-only (the signed `CartLineItem` envelope above
        // never carries them, by design), so they're looked up separately
        // here purely to enrich the audit record — this can never affect the
        // kernel decision already made or the cart_hash it was checked against.
        let item_ids: Vec<Uuid> = cart.line_items.iter().map(|li| li.item_id).collect();
        let titles = sqlx::query!(
            "SELECT item_id, title FROM catalog_item WHERE item_id = ANY($1)",
            &item_ids
        )
        .fetch_all(&self.pool)
        .await
        .map_err(db)?;
        let title_by_id: std::collections::HashMap<Uuid, String> =
            titles.into_iter().map(|r| (r.item_id, r.title)).collect();
        let audit_line_items: Vec<serde_json::Value> = cart
            .line_items
            .iter()
            .map(|li| {
                json!({
                    "item_id": li.item_id,
                    "title": title_by_id.get(&li.item_id),
                    "category": li.category,
                    "qty": li.qty,
                    "price_paise": li.price_paise,
                })
            })
            .collect();
        AuditLedger::new(&self.pool)
            .append(
                session_id,
                domain::AuditEventType::GateDecision,
                json!({
                    "verdict": verdict,
                    "rule_cited": rule_cited,
                    "amount_paise": cart.total_paise,
                    "cart_hash": cart.cart_hash(),
                    "line_items": audit_line_items,
                }),
            )
            .await?;
        repos::set_session_state(&self.pool, session_id, new_state).await?;

        // On approval, trigger the PSP charge server-side (if wired). The agent
        // has no money tool; checkout is the only spending path and the kernel
        // has already approved this exact cart.
        let (payment_link, razorpay_ref) = match (&decision, &self.exec) {
            (KernelDecision::Approved(auth), Some(exec)) => {
                let authd = exec.authorize(session_id, auth).await?;
                (Some(authd.short_url), Some(authd.razorpay_ref))
            }
            _ => (None, None),
        };

        Ok(CheckoutResult {
            verdict: verdict.to_string(),
            rule_cited,
            human_message,
            amount_paise: cart.total_paise,
            cart_hash: cart.cart_hash(),
            payment_link,
            razorpay_ref,
        })
    }
}

fn db(e: sqlx::Error) -> AppError {
    AppError::Internal(format!("db: {e}"))
}

/// Build a `to_tsquery`-safe OR-of-terms string from free text: alphanumeric
/// words joined by `|`, so ANY term matching is enough (recall over
/// precision — see `search_catalog`). `to_tsquery` requires well-formed
/// syntax (unlike `plainto_tsquery`, it errors on stray punctuation), so
/// terms are sanitized before joining; an all-punctuation/empty query falls
/// back to a token that can't match anything, leaving the ILIKE fallback in
/// `search_catalog` as the only path.
/// Format an embedding as the pgvector text literal `[f1,f2,...]` (bound as a
/// text param and cast to `::vector` in SQL).
fn vector_literal(emb: &[f32]) -> String {
    let mut s = String::with_capacity(emb.len() * 8 + 2);
    s.push('[');
    for (i, x) in emb.iter().enumerate() {
        if i > 0 {
            s.push(',');
        }
        s.push_str(&format!("{x:.6}"));
    }
    s.push(']');
    s
}

fn or_tsquery(query: &str) -> String {
    let terms: Vec<String> = query
        .split_whitespace()
        .map(|w| {
            w.chars()
                .filter(|c| c.is_alphanumeric())
                .collect::<String>()
        })
        .filter(|w| !w.is_empty())
        .collect();
    if terms.is_empty() {
        "zzz_no_match_zzz".to_string()
    } else {
        terms.join(" | ")
    }
}
