import { describe, it, expect, beforeEach, vi } from "vitest";

// token.ts imports firebase for the (untested) logged-in path; stub it so the
// module loads without a real Firebase app.
vi.mock("./firebase", () => ({ db: {} }));

import { ensureToken, clearToken, authFetch } from "./token";

// A fetch mock that mints a unique token each call, and counts calls — so we
// can prove exactly how many identities were minted.
function mockMintingFetch() {
  let n = 0;
  const fn = vi.fn(async (url: string) => {
    if (typeof url === "string" && url.endsWith("/identity")) {
      n += 1;
      return new Response(JSON.stringify({ token: `pb_mock_${n}` }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("ensureToken", () => {
  beforeEach(() => {
    localStorage.clear();
    clearToken();
    vi.unstubAllGlobals();
  });

  it("mints exactly once under concurrent calls (the race that caused 403s)", async () => {
    const fetchMock = mockMintingFetch();

    // Fire many callers before any mint resolves — the classic first-load burst.
    const tokens = await Promise.all(Array.from({ length: 8 }, () => ensureToken()));

    const mints = fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/identity")).length;
    expect(mints).toBe(1);
    // Every concurrent caller gets the same single identity.
    expect(new Set(tokens).size).toBe(1);
    expect(tokens[0]).toBe("pb_mock_1");
  });

  it("reuses a stored token without minting again", async () => {
    localStorage.setItem("paybound_backend_token", "pb_existing");
    const fetchMock = mockMintingFetch();

    const token = await ensureToken();

    expect(token).toBe("pb_existing");
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/identity"))).toHaveLength(0);
  });

  it("persists the minted token to localStorage for the next load", async () => {
    mockMintingFetch();
    const token = await ensureToken();
    expect(localStorage.getItem("paybound_backend_token")).toBe(token);
  });

  it("clearToken forces a fresh mint next time", async () => {
    const fetchMock = mockMintingFetch();
    const first = await ensureToken();
    clearToken();
    const second = await ensureToken();

    expect(first).toBe("pb_mock_1");
    expect(second).toBe("pb_mock_2");
    expect(localStorage.getItem("paybound_backend_token")).toBe("pb_mock_2");
  });
});

describe("authFetch", () => {
  beforeEach(() => {
    localStorage.clear();
    clearToken();
    vi.unstubAllGlobals();
  });

  it("attaches the bearer token to the request", async () => {
    localStorage.setItem("paybound_backend_token", "pb_bearer");
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response("{}", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await authFetch("http://x/thing", { method: "POST" });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer pb_bearer");
  });
});
