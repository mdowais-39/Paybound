//! A thin, typed Razorpay REST client for the calls Paybound makes in test
//! mode, plus HMAC-SHA256 webhook verification.
//!
//! Real vs simulated (Part F #7): order/payment-link creation and fetch are
//! REAL test-mode Razorpay calls. The account has no S2S UPI enabled, so a
//! payment completes when its link is paid (real `payment_link.paid` webhook);
//! automated tests drive that webhook with a correctly-signed synthetic event.

pub mod webhook;

use async_trait::async_trait;
use common::AppError;
use serde::{Deserialize, Serialize};

pub use webhook::verify_webhook_signature;

const API_BASE: &str = "https://api.razorpay.com/v1";

/// Request to create a payment link.
#[derive(Debug, Clone, Serialize)]
pub struct PaymentLinkRequest {
    /// Amount in paise.
    pub amount: i64,
    pub currency: String,
    pub description: String,
    pub reference_id: String,
    pub customer_name: String,
    pub customer_contact: String,
    pub customer_email: String,
}

/// A created/fetched payment link.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentLink {
    pub id: String,
    pub status: String,
    pub short_url: String,
    pub amount: i64,
}

/// A created order.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Order {
    pub id: String,
    pub status: String,
    pub amount: i64,
}

/// The payment operations the execution plane depends on. A trait so the
/// execution plane can be tested against a fake without hitting the network.
#[async_trait]
pub trait PaymentGateway: Send + Sync {
    async fn create_order(&self, amount_paise: i64, receipt: &str) -> Result<Order, AppError>;
    async fn create_payment_link(&self, req: &PaymentLinkRequest) -> Result<PaymentLink, AppError>;
    async fn fetch_payment_link(&self, id: &str) -> Result<PaymentLink, AppError>;
}

/// The real Razorpay REST client (HTTP basic auth with test keys).
#[derive(Clone)]
pub struct RazorpayClient {
    http: reqwest::Client,
    key_id: String,
    key_secret: String,
}

impl RazorpayClient {
    pub fn new(key_id: impl Into<String>, key_secret: impl Into<String>) -> Self {
        Self {
            http: reqwest::Client::new(),
            key_id: key_id.into(),
            key_secret: key_secret.into(),
        }
    }

    async fn post(
        &self,
        path: &str,
        body: serde_json::Value,
    ) -> Result<serde_json::Value, AppError> {
        let resp = self
            .http
            .post(format!("{API_BASE}{path}"))
            .basic_auth(&self.key_id, Some(&self.key_secret))
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("razorpay request: {e}")))?;
        parse(resp).await
    }
}

async fn parse(resp: reqwest::Response) -> Result<serde_json::Value, AppError> {
    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| AppError::Internal(format!("razorpay body: {e}")))?;
    let value: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| AppError::Internal(format!("razorpay json ({status}): {e}: {text}")))?;
    if !status.is_success() || value.get("error").is_some() {
        let desc = value
            .pointer("/error/description")
            .and_then(|d| d.as_str())
            .unwrap_or("unknown error");
        return Err(AppError::Internal(format!("razorpay {status}: {desc}")));
    }
    Ok(value)
}

#[async_trait]
impl PaymentGateway for RazorpayClient {
    async fn create_order(&self, amount_paise: i64, receipt: &str) -> Result<Order, AppError> {
        let v = self
            .post(
                "/orders",
                serde_json::json!({ "amount": amount_paise, "currency": "INR", "receipt": receipt }),
            )
            .await?;
        Ok(Order {
            id: str_field(&v, "id")?,
            status: str_field(&v, "status")?,
            amount: v
                .get("amount")
                .and_then(|a| a.as_i64())
                .unwrap_or(amount_paise),
        })
    }

    #[tracing::instrument(name = "razorpay.create_payment_link", level = "info", skip(self, req), fields(amount_paise = req.amount))]
    async fn create_payment_link(&self, req: &PaymentLinkRequest) -> Result<PaymentLink, AppError> {
        let body = serde_json::json!({
            "amount": req.amount,
            "currency": req.currency,
            "accept_partial": false,
            "description": req.description,
            "reference_id": req.reference_id,
            "customer": {
                "name": req.customer_name,
                "contact": req.customer_contact,
                "email": req.customer_email
            },
            "notify": { "sms": false, "email": false },
            "reminder_enable": false
        });
        let v = self.post("/payment_links", body).await?;
        Ok(PaymentLink {
            id: str_field(&v, "id")?,
            status: str_field(&v, "status")?,
            short_url: str_field(&v, "short_url")?,
            amount: v
                .get("amount")
                .and_then(|a| a.as_i64())
                .unwrap_or(req.amount),
        })
    }

    async fn fetch_payment_link(&self, id: &str) -> Result<PaymentLink, AppError> {
        let resp = self
            .http
            .get(format!("{API_BASE}/payment_links/{id}"))
            .basic_auth(&self.key_id, Some(&self.key_secret))
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("razorpay request: {e}")))?;
        let v = parse(resp).await?;
        Ok(PaymentLink {
            id: str_field(&v, "id")?,
            status: str_field(&v, "status")?,
            short_url: str_field(&v, "short_url")?,
            amount: v.get("amount").and_then(|a| a.as_i64()).unwrap_or(0),
        })
    }
}

fn str_field(v: &serde_json::Value, key: &str) -> Result<String, AppError> {
    v.get(key)
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::Internal(format!("razorpay response missing '{key}'")))
}
