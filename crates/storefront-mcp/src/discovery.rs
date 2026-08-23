//! Agent-discovery surface: schema.org JSON-LD, a product feed, and an
//! Agentic Resource Discovery (ARD) manifest at `/.well-known/agents.txt`.
//! The manifest declares the tools AND the authority an agent needs before it
//! can transact — itself part of the bounded/gated story.

use common::AppError;
use ledger::Db;
use serde_json::{json, Value};
use uuid::Uuid;

/// robots.txt-style discovery pointer served at `/.well-known/agents.txt`.
pub fn agents_txt(base_url: &str) -> String {
    format!(
        "# Paybound agent-transactable storefront\n\
         # This merchant is shoppable by AI buyers via MCP.\n\
         User-agent: *\n\
         Allow: /\n\
         MCP-Endpoint: {base_url}/mcp\n\
         ARD-Manifest: {base_url}/.well-known/ard.json\n\
         Product-Feed: {base_url}/feed.json\n\
         # Authority required before any purchase: a signed Intent Mandate\n\
         # (budget, allowed categories/merchants, per-transaction cap, TTL).\n"
    )
}

/// The ARD manifest: what this resource does, its tools, and the authority an
/// agent must present before transacting.
pub fn ard_manifest(base_url: &str) -> Value {
    json!({
        "name": "Paybound Storefront",
        "description": "An agent-transactable merchant storefront on Razorpay's rails.",
        "mcp_endpoint": format!("{base_url}/mcp"),
        "tools": [
            { "name": "search_catalog", "description": "Search products by query.",
              "inputs": { "query": "string", "limit": "integer?" } },
            { "name": "get_availability", "description": "Live stock + price for an item.",
              "inputs": { "item_id": "uuid" } },
            { "name": "get_variants", "description": "Size/colour variants for an item.",
              "inputs": { "item_id": "uuid" } },
            { "name": "create_cart", "description": "Assemble a cart (single merchant).",
              "inputs": { "session_id": "uuid", "items": "[{item_id, qty}]" } },
            { "name": "checkout", "description": "Submit a cart to the mandate kernel. Does NOT pay.",
              "inputs": { "session_id": "uuid", "cart_id": "uuid" } }
        ],
        "authority_required": {
            "type": "signed_intent_mandate",
            "fields": ["budget_total_paise", "per_txn_cap_paise",
                       "allowed_categories", "allowed_merchants", "ttl"],
            "note": "The kernel enforces these bounds before any money moves."
        }
    })
}

/// An OpenAI/Google-style product feed of the catalog (prices in minor units).
pub async fn product_feed(pool: &Db) -> Result<Value, AppError> {
    let rows = sqlx::query!(
        "SELECT item_id, title, category, price_paise, currency, availability
         FROM catalog_item ORDER BY title LIMIT 1000"
    )
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(format!("db: {e}")))?;

    let items: Vec<Value> = rows
        .into_iter()
        .map(|r| {
            json!({
                "id": r.item_id,
                "title": r.title,
                "category": r.category,
                "price": { "value_minor_units": r.price_paise, "currency": r.currency },
                "availability": if r.availability { "in_stock" } else { "out_of_stock" }
            })
        })
        .collect();

    Ok(json!({ "version": "1.0", "products": items }))
}

/// schema.org Product/Offer JSON-LD for one item (the static discovery snapshot
/// crawlers and LLMs already parse).
pub async fn product_jsonld(pool: &Db, item_id: Uuid) -> Result<Value, AppError> {
    let r = sqlx::query!(
        "SELECT title, category, price_paise, currency, availability
         FROM catalog_item WHERE item_id = $1",
        item_id
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(format!("db: {e}")))?
    .ok_or_else(|| AppError::NotFound(format!("item {item_id}")))?;

    // schema.org price is a decimal string in major units; derive from paise.
    let price_major = format!("{}.{:02}", r.price_paise / 100, r.price_paise % 100);
    Ok(json!({
        "@context": "https://schema.org",
        "@type": "Product",
        "sku": item_id,
        "name": r.title,
        "category": r.category,
        "offers": {
            "@type": "Offer",
            "price": price_major,
            "priceCurrency": r.currency,
            "availability": if r.availability {
                "https://schema.org/InStock"
            } else {
                "https://schema.org/OutOfStock"
            }
        }
    }))
}
