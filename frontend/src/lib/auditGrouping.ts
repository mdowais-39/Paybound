// One purchase SESSION persists across many separate purchase ATTEMPTS (runs)
// — that's deliberate, it's how cumulative-budget tracking works across a
// mandate's whole lifetime. But "one cart" in the user's mental model is one
// RUN, not the whole session: grouping audit entries by session_id alone
// merges unrelated purchase attempts (possibly hours apart) into one card.
//
// This attributes each audit entry to the real run that produced it, using
// the run's OWN authoritative [created_at, updated_at] window from the
// agent_run table (not a guessed time-gap heuristic) — the window during
// which that run's HTTP request(s) actually executed, so every audit entry
// Rust appended during that call necessarily falls inside it.

import { AgentRun } from "./types";

/** Which run's window a timestamp (ms since epoch) belongs to. An exact
 * window match wins outright. Otherwise, attach to whichever run's window is
 * TEMPORALLY NEAREST (by distance to the closer edge) — not blindly the
 * earliest or the latest run in the whole list.
 *
 * That "nearest" fallback is deliberate defense-in-depth, not just a tidier
 * default: `created_at`/`updated_at` come from the Python API's `now()`
 * (Postgres's own clock), while each audit entry's own `ts` was, until a
 * backend fix, stamped from the Rust process's HOST clock — a different
 * clock that measurably drifts from Postgres's (observed ~1s on this stack,
 * commonly Docker Desktop's containerized-Postgres-vs-host skew). That drift
 * let a run's own late-stage entries (token_issued, payment_effect) land a
 * few hundred ms past their own `updated_at`, and the old "no match → latest
 * run" rule then dumped them onto whatever run happened to be newest in the
 * mandate — a completely unrelated cart. The backend now sources `ts` from
 * Postgres too, which should make near-misses rare going forward, but any
 * entry that still lands just outside its true run's window (residual
 * skew, or older data written before the backend fix) is still one edge
 * away from the RIGHT run, and light-years from "whatever cart is newest" —
 * so nearest-by-distance degrades gracefully where the old rule failed
 * catastrophically. Returns null only when there are no runs at all to
 * attribute to (e.g. a session created but never actually used). */
export function attributeTimestampToRun(tsMs: number, runs: AgentRun[]): string | null {
  if (runs.length === 0) return null;
  let bestId: string | null = null;
  let bestDist = Infinity;
  for (const r of runs) {
    const start = Date.parse(r.created_at);
    const end = Date.parse(r.updated_at);
    const dist = tsMs < start ? start - tsMs : tsMs > end ? tsMs - end : 0;
    if (dist < bestDist) {
      bestDist = dist;
      bestId = r.run_id;
    }
  }
  return bestId;
}
