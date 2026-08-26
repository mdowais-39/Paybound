# Paybound — Frontend ↔ Backend Integration Map (Phase 0 audit)

**Date:** 2026-08-27
**Status:** Phase 0 complete. This is the hard-gate deliverable — no wiring code written yet.

---

## 0. Headline finding — read this first

The integration prompt's mental model was "both halves individually strong; close the seams; some panels show static numbers." **The reality is more severe:** the frontend is a **complete, self-contained simulation that makes zero calls to the real backend.** It has *three separate mock backends* and a *different auth system*, and nearly every specific value a judge would see is fabricated client-side.

Concretely, verified by reading the source:

1. **The frontend has never been connected to — or even run alongside — the real backend.** `node_modules` isn't installed; the backend was down; the frontend is a Google AI Studio-generated app wired to **Firebase + its own Express mock server**.
2. **Three mock backends, zero real calls:**
   - `frontend/server/routes/orchestrator.ts` — a full **TypeScript reimplementation of the Rust kernel** ("9 bounds evaluator"), fabricating carts, payment links (`https://rzp.io/i/demo_pay_…`), and verdicts.
   - **Firestore** — where mandates and audit chains actually persist (`api.ts` reads/writes Firebase first).
   - **Inline fallbacks in `api.ts`** — keyword-matching simulation of `runAgent` that fabricates payment links, trace ids, hashes (`Math.random()`), amounts (₹18,500), and invented audit narratives.
   - The real backend (`:8080` gateway, `:8081` storefront, `:8092` agent API) is called by **none** of these. The `/api/*` paths the frontend fetches resolve to the Express mock, not the Rust/Python services.
3. **Two disconnected auth systems.** Frontend = Firebase (Google + email/password), keyed on Firebase UID. Backend = bearer-token identity (`POST /identity`, ownership by `owner_token_hash`). They do not connect. No backend call in the frontend sends an `Authorization` header at all.
4. **Pervasive fabrication** — exactly the prompt's #1 bug: the ShopPage pipeline stepper is a client-side `setTimeout` animation (220ms/stage) decoupled from real progress; 3 seed carts with fake `rzp.io` links, trace ids, and amounts are the default visible state; `createMandate` invents the mandate id, session id, and a fake "Ed25519 signature" narrative client-side instead of using the backend's real signed mandate.

**The good news** (why this is very doable, not a rebuild):
- `frontend/src/lib/types.ts` is **already well-aligned** with the real backend shapes (`OrchestratorResult`, `AuditEntry`, `AuditChain`, `Mandate`, `RefusalRule`, `SessionState`). It's only missing the new `CHOOSE` state + `options`.
- The component structure and design are strong and worth keeping. `MandateContext`/`AuthContext` are clean and delegate to `api.ts`.
- **The entire problem is concentrated in one file (`api.ts`) plus the mock-server layer.** Rewiring `api.ts` to the real backend + bridging auth fixes the data layer for the whole app without touching most components.

So the accurate framing: **this is a full data-layer replacement, not a seam-patching pass.** Mechanically contained, but much larger in intent than "wire a few panels."

---

## 1. Duplicate-frontend cleanup (blocking, trivial)

The frontend was extracted **twice** — once into `frontend/` (canonical, per the prompt) and once byte-identically at the **repo top level** (`src/`, `index.html`, `server.ts`, `server/`, `package.json`, `vite.config.ts`, firebase configs, `public/`, `assets/`, `bun.lock`). Both are untracked. The top-level copy pollutes the repo root alongside the Rust/Python backend and will confuse tooling.

**Decision (needs your OK): delete the top-level duplicate, keep `frontend/`.** Trivial to reverse (it's untracked and duplicated), but I won't delete files without a nod.

---

## 2. Real backend routes (verified from source, this is ground truth)

### Gateway `:8080` — all mandate/session endpoints require `Authorization: Bearer <token>`
| Method | Path | Auth | Returns |
|---|---|---|---|
| POST | `/identity` | none | `{ token }` (mint once, store client-side) |
| POST | `/mandates` | 🔒 | signed mandate + bound session |
| GET | `/mandates` | 🔒 | caller's own mandates + live spend/state |
| GET | `/sessions/{id}` | 🔒 | state, spend, bounds, latest_cart_id |
| GET | `/sessions/{id}/audit` | 🔒 | `{ verified, entry_count, entries[] }` hash chain |
| POST | `/mandates/{id}/revoke` | 🔒 | `{ mandate_id, revoked }` |
| GET | `/catalog/categories?merchant_id=` | none | `string[]` |
| POST | `/webhooks/razorpay` | HMAC | (Razorpay→backend, not frontend) |

### Agent API `:8092` — all require the same Bearer token
| Method | Path | Returns |
|---|---|---|
| POST | `/sessions/{id}/run` | `OrchestratorResult` (may be `CHOOSE` + `options[]`) |
| POST | `/sessions/{id}/select` | `OrchestratorResult` (resume a CHOOSE) |
| POST | `/sessions/{id}/approve` | `OrchestratorResult` (resume a NEEDS_HUMAN) |

### Storefront `:8081` — agent-facing; frontend generally doesn't call `/mcp` directly
`/mcp` (JSON-RPC), `/.well-known/agents.txt`, `/.well-known/ard.json`, `/feed.json`, `/schema/{item_id}`.

**No `/api/*` prefix anywhere. No `{success, data}` envelope anywhere — the backend returns the payload flat.** Every place the frontend expects `json.success && json.data`, `d.verdict_code`, `e.event_name`, or `e.hash` is wrong against the real contract.

---

## 3. The gap map (per frontend data need)

| Frontend location | What it needs | Real backend match | Decision |
|---|---|---|---|
| `api.getCategories` | category list | `GET /catalog/categories` — exists; frontend expects `{success,data}`, backend returns bare `string[]` | **ADAPT** (fix frontend) |
| `api.listMandates` | user's mandates | `GET /mandates` 🔒 — exists; frontend reads Firestore first, then wrong `/api/mandates` shape, no token | **ADAPT** (rewire + auth) |
| `api.createMandate` | create signed mandate | `POST /mandates` 🔒 — exists; frontend **fabricates** id/session/signature client-side, POSTs to wrong path, no token | **ADAPT** (use backend's real signed mandate as source of truth) |
| `api.revokeMandate` | kill switch | `POST /mandates/{id}/revoke` 🔒 — exists; frontend hits `/api/…`, no token | **ADAPT** |
| `api.getSession` | live state + spend | `GET /sessions/{id}` 🔒 — exists; frontend returns Firestore/local shape with fake `latest_cart_id:"crt_demo_active"` | **ADAPT** |
| `api.getAuditChain` | hash chain | `GET /sessions/{id}/audit` 🔒 — exists; frontend maps wrong fields (`e.hash`,`e.event_name`), falls back to hardcoded 2-entry chain with literal fake hashes | **ADAPT** |
| `api.runAgent` | run the goal | `POST /sessions/{id}/run` 🔒 — exists; frontend POSTs `/api/orchestrate`, else **full keyword simulation** with fake links/hashes/amounts | **ADAPT** (rip out simulation) |
| `api.approveSession` | resume NEEDS_HUMAN | `POST /sessions/{id}/approve` 🔒 — exists; frontend **fully fabricates** approval + fake payment link, never calls backend | **ADAPT** |
| ShopPage — product choice | pick among options | `POST /sessions/{id}/select` 🔒 + `state:CHOOSE`/`options[]` — **exists in backend, frontend has no concept of it** | **BUILD-FRONTEND** (CHOOSE picker) |
| ShopPage `INITIAL_CARTS` | default view | 3 hardcoded fake carts (fake links/trace/amounts) | **CUT** (replace with real empty/loaded state) |
| ShopPage pipeline stepper | live pipeline progress | `setTimeout` animation, not backend-driven; backend exposes no per-stage stream | **ADAPT** → drive from real `OrchestratorResult.state`; the stepwise stages are **HONEST-EMPTY** unless we add a real signal (see §5) |
| ShopPage LLM-call counter | `llm_calls` | `OrchestratorResult.llm_calls` — exists, real | **WIRE** (once runAgent is real) |
| ShopPage trace badge | `trace_id` | `OrchestratorResult.trace_id` — exists, real (OTel) | **WIRE** |
| Auth (Firebase) | who the user is | backend `POST /identity` bearer token — **different system** | **ADAPT** (bridge: see §4) |
| `LandingInteractiveConsole` | live console w/ `latency_ms:0.8` | fabricated demo widget | **HONEST-EMPTY** or **WIRE** to a real run — your call (§6) |
| Landing marketing sections | static copy | n/a — legitimate static content | **KEEP** (verify "9 bounds" claim matches kernel — it does) |
| AuditPage (780 lines) | rich audit viz | needs full read — likely extra viz panels beyond core chain; audited in Phase 3 | **TBD Phase 3** |
| `mockData.ts` (`INITIAL_MANDATES`, `DEMO_CATALOG`, `DEMO_AUDIT_CHAINS`) | seed/fallback data | all fabricated | **CUT** from default path (keep only behind an explicit, labeled dev-mock toggle if you want one) |

---

## 4. Auth reconciliation (a real decision, not mechanical)

The frontend has a genuinely nice Google/email login (Firebase). The backend owns mandates by bearer-token hash. To make backend calls real **and** keep the login UX, the bridge is:

> On Firebase login, call `POST /identity` **once**, store the returned bearer token (in Firestore keyed to the UID, and/or `localStorage`), and attach it as `Authorization: Bearer …` on every backend call thereafter.

This keeps Firebase as the human-facing identity and the backend token as the ownership key — one maps to the other. Recommended. The alternative (drop Firebase, use only backend tokens) throws away working login UX for no gain.

---

## 5. The pipeline stepper — the one genuinely honest-hard spot

The backend returns a **single final `OrchestratorResult`** — it does not stream per-stage progress (pre-check → parse → search → compose → gate). The frontend's animated stepper implies live progress that the backend doesn't emit. Options:
- **HONEST-EMPTY-ish:** keep the stepper but drive it from the *final* result — show all stages resolved at once, colored by outcome (gate = refused/approved/needs-human). Honest, less flashy. **(Recommended, low effort.)**
- **BUILD-BACKEND:** add a real streaming/SSE progress channel from the orchestrator. Higher effort, real payoff, riskier this close to the deadline.

---

## 6. Decisions I need from you before Phase 1

1. **Delete the top-level duplicate frontend?** (keep `frontend/` as canonical) — recommended yes.
2. **Auth bridge as in §4** (Firebase login → mint & store a backend token → Bearer on all calls)? — recommended yes.
3. **Firestore's role going forward:** keep it as a convenience cache/persistence layer *behind* the real backend, or go **backend-only** and treat the backend as the single source of truth? — I recommend **backend-only for all mandate/session/audit data** (that's where the real signed mandates, real hash chain, and real ownership live), keeping Firebase for **login only**. Using Firestore as a parallel store is how the fabrication crept in.
4. **Pipeline stepper:** honest final-state coloring (§5, recommended) or build a real streaming endpoint?
5. **`LandingInteractiveConsole`:** wire it to a real throwaway run, or mark it HONEST-EMPTY / cut it?

Once you answer these five, Phases 1–5 can run autonomously per the prompt's STOP-AND-TEST gates.
