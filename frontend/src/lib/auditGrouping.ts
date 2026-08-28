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

/** Which run's window a timestamp (ms since epoch) falls into. Runs happen
 * sequentially within a session (never meaningfully overlap), so: an exact
 * window match wins; a timestamp before every run (e.g. the session's own
 * creation event, which precedes any run) attaches to the EARLIEST run; a
 * timestamp after every run's window attaches to the LATEST run. Returns
 * null only when there are no runs at all to attribute to (e.g. a session
 * that was created but never actually used for a purchase). */
export function attributeTimestampToRun(tsMs: number, runs: AgentRun[]): string | null {
  if (runs.length === 0) return null;
  const sorted = [...runs].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const exact = sorted.find((r) => {
    const start = Date.parse(r.created_at);
    const end = Date.parse(r.updated_at);
    return tsMs >= start && tsMs <= end;
  });
  if (exact) return exact.run_id;
  if (tsMs < Date.parse(sorted[0].created_at)) return sorted[0].run_id;
  return sorted[sorted.length - 1].run_id;
}
