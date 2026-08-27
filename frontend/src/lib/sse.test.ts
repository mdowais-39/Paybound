import { describe, it, expect, vi } from "vitest";
import { consumeOrchestratorStream, StageEvent } from "./api";

// Build a ReadableStream that emits the given string chunks — used to simulate
// the agent API's SSE response, including chunk boundaries that fall in the
// middle of an event (the case most likely to break naive parsing).
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(enc.encode(chunks[i++]));
      else controller.close();
    },
  });
}

const RESULT = { state: "CHOOSE", message: "pick one", options: [] };

describe("consumeOrchestratorStream", () => {
  it("forwards stage events and resolves with the terminal result", async () => {
    const stages: StageEvent[] = [];
    const stream = streamOf([
      `data: {"type":"stage","id":"pre_checks","status":"active"}\n\n`,
      `data: {"type":"stage","id":"pre_checks","status":"success"}\n\n`,
      `data: {"type":"stage","id":"searching","status":"success"}\n\n`,
      `data: {"type":"result","result":${JSON.stringify(RESULT)}}\n\n`,
    ]);

    const result = await consumeOrchestratorStream(stream, (e) => stages.push(e), "runAgent");

    expect(stages).toEqual([
      { id: "pre_checks", status: "active" },
      { id: "pre_checks", status: "success" },
      { id: "searching", status: "success" },
    ]);
    expect(result).toEqual(RESULT);
  });

  it("reassembles events split across chunk boundaries", async () => {
    const stages: StageEvent[] = [];
    // The first event and the framing blank line are split across 3 chunks.
    const stream = streamOf([
      `data: {"type":"stage","id":"pars`,
      `ing","status":"success"}\n`,
      `\ndata: {"type":"result","result":${JSON.stringify(RESULT)}}\n\n`,
    ]);

    const result = await consumeOrchestratorStream(stream, (e) => stages.push(e), "runAgent");

    expect(stages).toEqual([{ id: "parsing", status: "success" }]);
    expect(result).toEqual(RESULT);
  });

  it("throws with the backend detail on an error event", async () => {
    const onStage = vi.fn();
    const stream = streamOf([
      `data: {"type":"stage","id":"kernel_gate","status":"active"}\n\n`,
      `data: {"type":"error","detail":"razorpay 429"}\n\n`,
    ]);

    await expect(consumeOrchestratorStream(stream, onStage, "selectOption")).rejects.toThrow(
      /selectOption failed: razorpay 429/,
    );
    expect(onStage).toHaveBeenCalledOnce();
  });

  it("throws if the stream ends without a result", async () => {
    const stream = streamOf([`data: {"type":"stage","id":"pre_checks","status":"success"}\n\n`]);
    await expect(consumeOrchestratorStream(stream, () => {}, "runAgent")).rejects.toThrow(
      /ended without a result/,
    );
  });
});
