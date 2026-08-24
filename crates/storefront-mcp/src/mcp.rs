//! A minimal, compliant MCP JSON-RPC 2.0 surface over HTTP POST: `initialize`,
//! `tools/list`, and `tools/call`. Non-streaming tool calls return an
//! `application/json` JSON-RPC response — valid MCP Streamable-HTTP behaviour.
//! (If a fuller SDK is wanted later, this is a drop-in-replaceable seam; the
//! tool *semantics* live in `Storefront`, not here.)

use crate::{CartItemReq, Storefront};
use serde_json::{json, Value};
use uuid::Uuid;

const PROTOCOL_VERSION: &str = "2025-06-18";

/// Handle one JSON-RPC request and produce the response value.
pub async fn handle(store: &Storefront, req: &Value) -> Value {
    let id = req.get("id").cloned().unwrap_or(Value::Null);
    let method = req.get("method").and_then(|m| m.as_str()).unwrap_or("");

    match method {
        "initialize" => ok(
            id,
            json!({
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "paybound-storefront", "version": "0.1.0" }
            }),
        ),
        "tools/list" => ok(id, json!({ "tools": tool_specs() })),
        "tools/call" => {
            let params = req.get("params").cloned().unwrap_or(Value::Null);
            let name = params.get("name").and_then(|n| n.as_str()).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(json!({}));
            match call_tool(store, name, &args).await {
                Ok(value) => ok(id, tool_result(value, false)),
                Err(msg) => ok(id, tool_result(json!({ "error": msg }), true)),
            }
        }
        other => err(id, -32601, &format!("method not found: {other}")),
    }
}

async fn call_tool(store: &Storefront, name: &str, args: &Value) -> Result<Value, String> {
    match name {
        "search_catalog" => {
            let query = str_arg(args, "query")?;
            let limit = args.get("limit").and_then(|v| v.as_i64()).unwrap_or(10);
            let items = store.search_catalog(&query, limit).await.map_err(estr)?;
            Ok(json!({ "items": items }))
        }
        "get_availability" => {
            let item_id = uuid_arg(args, "item_id")?;
            let v = store.get_availability(item_id).await.map_err(estr)?;
            serde_json::to_value(v).map_err(estr)
        }
        "get_variants" => {
            let item_id = uuid_arg(args, "item_id")?;
            let v = store.get_variants(item_id).await.map_err(estr)?;
            serde_json::to_value(v).map_err(estr)
        }
        "create_cart" => {
            let session_id = uuid_arg(args, "session_id")?;
            let items: Vec<CartItemReq> =
                serde_json::from_value(args.get("items").cloned().unwrap_or(json!([])))
                    .map_err(|e| format!("invalid items: {e}"))?;
            let cart = store.create_cart(session_id, &items).await.map_err(estr)?;
            serde_json::to_value(cart).map_err(estr)
        }
        "checkout" => {
            let session_id = uuid_arg(args, "session_id")?;
            let cart_id = uuid_arg(args, "cart_id")?;
            let afa_approved = args
                .get("afa_approved")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let result = store
                .checkout(session_id, cart_id, afa_approved)
                .await
                .map_err(estr)?;
            serde_json::to_value(result).map_err(estr)
        }
        other => Err(format!("unknown tool: {other}")),
    }
}

fn tool_specs() -> Value {
    json!([
        {
            "name": "search_catalog",
            "description": "Search products by natural-language query.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string" },
                    "limit": { "type": "integer", "default": 10 }
                },
                "required": ["query"]
            }
        },
        {
            "name": "get_availability",
            "description": "Live stock and price for one item.",
            "inputSchema": {
                "type": "object",
                "properties": { "item_id": { "type": "string", "format": "uuid" } },
                "required": ["item_id"]
            }
        },
        {
            "name": "get_variants",
            "description": "Size/colour variants for one item.",
            "inputSchema": {
                "type": "object",
                "properties": { "item_id": { "type": "string", "format": "uuid" } },
                "required": ["item_id"]
            }
        },
        {
            "name": "create_cart",
            "description": "Assemble a cart from catalog items (single merchant).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "session_id": { "type": "string", "format": "uuid" },
                    "items": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "item_id": { "type": "string", "format": "uuid" },
                                "qty": { "type": "integer", "default": 1 }
                            },
                            "required": ["item_id"]
                        }
                    }
                },
                "required": ["session_id", "items"]
            }
        },
        {
            "name": "checkout",
            "description": "Submit a cart to the mandate kernel. Does NOT pay; returns the gate decision.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "session_id": { "type": "string", "format": "uuid" },
                    "cart_id": { "type": "string", "format": "uuid" }
                },
                "required": ["session_id", "cart_id"]
            }
        }
    ])
}

// ---- helpers ----------------------------------------------------------------

fn ok(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn err(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// Wrap a value as an MCP tool result: human-readable `content` plus
/// machine-readable `structuredContent`.
fn tool_result(value: Value, is_error: bool) -> Value {
    json!({
        "content": [ { "type": "text", "text": value.to_string() } ],
        "structuredContent": value,
        "isError": is_error
    })
}

fn str_arg(args: &Value, key: &str) -> Result<String, String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("missing string arg: {key}"))
}

fn uuid_arg(args: &Value, key: &str) -> Result<Uuid, String> {
    let s = str_arg(args, key)?;
    Uuid::parse_str(&s).map_err(|e| format!("invalid uuid for {key}: {e}"))
}

fn estr<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}
