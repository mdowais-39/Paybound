import { defineConfig } from "vitest/config";

// Unit tests for the frontend's pure logic (money math, the auth-token
// singleton, the SSE stream parser). jsdom gives us localStorage for the
// token tests; Node's global ReadableStream/TextDecoder cover the SSE tests.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
