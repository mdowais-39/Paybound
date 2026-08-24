"""OpenTelemetry setup for the Python agent, so a purchase is ONE distributed
trace: the agent's spans + the `traceparent` header auto-injected into the MCP
HTTP calls, which the Rust storefront extracts and continues (agent -> MCP ->
kernel -> execution -> Razorpay in a single Grafana trace)."""

from __future__ import annotations

import os

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.requests import RequestsInstrumentor
from opentelemetry.propagate import set_global_textmap
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

_provider: TracerProvider | None = None


def init_tracing(service_name: str = "paybound-agent"):
    global _provider
    endpoint = os.environ.get("OTLP_HTTP_ENDPOINT", "http://localhost:4318/v1/traces")
    _provider = TracerProvider(resource=Resource.create({"service.name": service_name}))
    _provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=endpoint)))
    trace.set_tracer_provider(_provider)
    # W3C trace-context, matching the Rust services' propagator.
    set_global_textmap(TraceContextTextMapPropagator())
    # Auto-inject `traceparent` into outgoing requests (the MCP calls).
    RequestsInstrumentor().instrument()
    return trace.get_tracer(service_name)


def flush() -> None:
    if _provider is not None:
        _provider.force_flush()
        _provider.shutdown()
