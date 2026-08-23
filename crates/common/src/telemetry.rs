//! Telemetry initialisation: structured `tracing` logs + OTLP trace export to
//! the collector (which forwards to Tempo/Grafana). One purchase becomes one
//! distributed trace across agent → MCP → kernel → execution → Razorpay
//! (fully wired in Phase 10; the transport is stood up here in Phase 0).
//!
//! If the OTLP exporter cannot be constructed (e.g. the collector isn't up),
//! initialisation degrades to logs-only rather than crashing the service.

use opentelemetry::trace::TracerProvider as _;
use opentelemetry::KeyValue;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::runtime;
use opentelemetry_sdk::trace::TracerProvider as SdkTracerProvider;
use opentelemetry_sdk::Resource;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

/// A handle that flushes and shuts down the tracer provider on drop.
pub struct TelemetryGuard {
    provider: Option<SdkTracerProvider>,
}

impl Drop for TelemetryGuard {
    fn drop(&mut self) {
        if let Some(provider) = self.provider.take() {
            let _ = provider.shutdown();
        }
    }
}

/// Initialise global tracing with OTLP export to `otlp_endpoint`. Honours
/// `RUST_LOG` (falls back to `info,paybound=debug`). Keep the returned guard
/// alive for the lifetime of the process so spans are flushed on exit.
pub fn init(service_name: &str, otlp_endpoint: &str) -> TelemetryGuard {
    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,paybound=debug"));
    let fmt_layer = fmt::layer().with_target(true).with_level(true);

    let provider = build_provider(service_name, otlp_endpoint);

    match &provider {
        Some(p) => {
            let tracer = p.tracer("paybound");
            let otel_layer = tracing_opentelemetry::layer().with_tracer(tracer);
            tracing_subscriber::registry()
                .with(filter)
                .with(fmt_layer)
                .with(otel_layer)
                .init();
            tracing::info!(
                service = service_name,
                endpoint = otlp_endpoint,
                "telemetry initialised (OTLP + logs)"
            );
        }
        None => {
            tracing_subscriber::registry()
                .with(filter)
                .with(fmt_layer)
                .init();
            tracing::warn!(
                service = service_name,
                "OTLP exporter unavailable; telemetry is logs-only"
            );
        }
    }

    TelemetryGuard { provider }
}

fn build_provider(service_name: &str, otlp_endpoint: &str) -> Option<SdkTracerProvider> {
    let exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_tonic()
        .with_endpoint(otlp_endpoint.to_string())
        .build()
        .ok()?;

    let resource = Resource::new(vec![KeyValue::new(
        "service.name",
        service_name.to_string(),
    )]);

    Some(
        SdkTracerProvider::builder()
            .with_batch_exporter(exporter, runtime::Tokio)
            .with_resource(resource)
            .build(),
    )
}
