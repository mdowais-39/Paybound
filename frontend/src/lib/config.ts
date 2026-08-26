// Backend service base URLs. The frontend calls the real Rust/Python backend
// directly (the backend sets permissive CORS for test-mode demo data). Override
// via Vite env vars when the backend runs somewhere other than localhost.
//
// Gateway (:8080)   — identity, mandates, sessions, audit, revoke, categories
// Agent API (:8092) — run / select / approve a session, plus the SSE progress stream

const env = (import.meta as any).env ?? {};

export const GATEWAY_URL: string = env.VITE_GATEWAY_URL ?? "http://localhost:8080";
export const AGENT_URL: string = env.VITE_AGENT_URL ?? "http://localhost:8092";
