// The bridge between Firebase login (human identity) and the backend's
// bearer-token identity (mandate/session ownership). Firebase says WHO the
// user is; the backend token says WHICH mandates are theirs. We mint ONE
// backend token per user/browser and reuse it, so a user always sees their
// own mandates.
//
//  - Logged in:  the token is stored in Firestore at users/{uid}.paybound_token
//                so it's stable across devices/sessions. Minted once on first
//                login, reused thereafter.
//  - Anonymous:  a token lives in localStorage only (ephemeral, per-browser),
//                and MUST stay stable across page loads — otherwise a mandate
//                created under one token is "not yours" to the next (a 403).
//
// Concurrency: `tokenPromise` is a module-level singleton. The first caller
// starts resolution and every other concurrent caller awaits the SAME promise,
// so exactly one identity is ever minted per page load no matter how many
// requests fire at once.

import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import { GATEWAY_URL } from "./config";

const LS_KEY = "paybound_backend_token";
let tokenPromise: Promise<string> | null = null;

function readStored(): string | null {
  try {
    return localStorage.getItem(LS_KEY);
  } catch {
    return null;
  }
}

function writeStored(token: string): void {
  try {
    localStorage.setItem(LS_KEY, token);
  } catch {
    /* private mode / storage disabled — the in-memory promise still holds it */
  }
}

async function mintToken(): Promise<string> {
  const res = await fetch(`${GATEWAY_URL}/identity`, { method: "POST" });
  if (!res.ok) throw new Error(`POST /identity failed: ${res.status}`);
  const data = await res.json();
  if (!data?.token) throw new Error("POST /identity returned no token");
  return data.token as string;
}

// Resolve the anonymous token exactly once: prefer a stored one, else mint and
// persist — re-reading storage after the mint so that if anything else won the
// race we converge on the same value.
async function resolveAnonymous(): Promise<string> {
  const stored = readStored();
  if (stored) return stored;
  const minted = await mintToken();
  const raced = readStored();
  if (raced) return raced;
  writeStored(minted);
  return minted;
}

/** Ensure a bearer token exists and return it. Idempotent and race-safe. */
export function ensureToken(): Promise<string> {
  if (!tokenPromise) tokenPromise = resolveAnonymous();
  return tokenPromise;
}

/** Bind a stable backend token to a logged-in Firebase user. Prefers the token
 * already stored in Firestore for this uid (stable across devices); mints and
 * persists one on first login. Falls back to the anonymous token if Firestore
 * is unreachable, so the app still works. Replaces the active token singleton. */
export function bindTokenToUser(uid: string): Promise<string> {
  tokenPromise = (async () => {
    try {
      const ref = doc(db, "users", uid);
      const snap = await getDoc(ref);
      const existing = snap.exists() ? (snap.data() as any).paybound_token : null;
      if (existing) {
        writeStored(existing);
        return existing as string;
      }
      const token = await mintToken();
      await setDoc(ref, { paybound_token: token }, { merge: true });
      writeStored(token);
      return token;
    } catch (err) {
      console.warn("bindTokenToUser fell back to anonymous token:", err);
      return resolveAnonymous();
    }
  })();
  return tokenPromise;
}

/** Drop the cached token (on explicit logout only). */
export function clearToken(): void {
  tokenPromise = null;
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}

/** fetch() with the backend bearer token attached. */
export async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await ensureToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}
