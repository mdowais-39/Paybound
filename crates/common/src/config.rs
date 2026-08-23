//! Configuration loading via figment: defaults < optional `paybound.toml` <
//! environment variables (prefix `PAYBOUND_`). Secrets (Razorpay keys, the
//! ed25519 signing key, the LLM API key) come from the environment / `.env`,
//! never from committed config — see Part F #7 and Phase 10.

use crate::error::AppError;
use figment::{
    providers::{Env, Format, Toml},
    Figment,
};
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    /// Port the gateway HTTP server binds to.
    #[serde(default = "default_gateway_port")]
    pub gateway_port: u16,

    /// Postgres connection string.
    #[serde(default = "default_database_url")]
    pub database_url: String,

    /// Redis connection string (idempotency keys, spend counters).
    #[serde(default = "default_redis_url")]
    pub redis_url: String,

    /// OTLP collector endpoint for OpenTelemetry traces.
    #[serde(default = "default_otlp_endpoint")]
    pub otlp_endpoint: String,

    /// Service name reported in traces.
    #[serde(default = "default_service_name")]
    pub service_name: String,
}

fn default_gateway_port() -> u16 {
    8080
}
fn default_database_url() -> String {
    "postgres://paybound:paybound@localhost:5432/paybound".to_string()
}
fn default_redis_url() -> String {
    "redis://localhost:6379".to_string()
}
fn default_otlp_endpoint() -> String {
    "http://localhost:4317".to_string()
}
fn default_service_name() -> String {
    "paybound-gateway".to_string()
}

impl Config {
    /// Load configuration from `paybound.toml` (optional) overlaid with
    /// `PAYBOUND_*` environment variables.
    pub fn load() -> Result<Self, AppError> {
        Figment::new()
            .merge(Toml::file("paybound.toml"))
            .merge(Env::prefixed("PAYBOUND_"))
            .extract()
            .map_err(|e| AppError::Config(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_load_without_any_file_or_env() {
        // With no toml and no env overrides, defaults must produce a valid config.
        let cfg = Figment::new()
            .merge(Env::prefixed("PAYBOUND_NONEXISTENT_"))
            .extract::<Config>()
            .expect("defaults should extract");
        assert_eq!(cfg.gateway_port, 8080);
        assert!(cfg.database_url.contains("paybound"));
    }
}
