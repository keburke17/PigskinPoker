import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createWriteQueue } from "../src/storage/writeQueue.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createWriteQueue", () => {
  it("coalesces repeated writes to the same key into one", async () => {
    const runs = [];
    const q = createWriteQueue({ debounceMs: 100 });
    // Simulates typing "127" - three onChange events in one box.
    q.enqueue("stat:t1:QB", async () => runs.push("1"));
    q.enqueue("stat:t1:QB", async () => runs.push("12"));
    q.enqueue("stat:t1:QB", async () => runs.push("127"));
    await vi.advanceTimersByTimeAsync(150);
    expect(runs).toEqual(["127"]); // one write, the final value
  });

  it("keeps writes to DIFFERENT keys separate", async () => {
    const runs = [];
    const q = createWriteQueue({ debounceMs: 100 });
    q.enqueue("stat:t1:QB", async () => runs.push("qb"));
    q.enqueue("stat:t1:WR", async () => runs.push("wr"));
    q.enqueue("stat:t2:QB", async () => runs.push("t2qb"));
    await vi.advanceTimersByTimeAsync(150);
    expect(runs.sort()).toEqual(["qb", "t2qb", "wr"]);
  });

  it("runs immediate writes without waiting for the debounce", async () => {
    const runs = [];
    const q = createWriteQueue({ debounceMs: 5000 });
    await q.enqueue("deal", async () => runs.push("dealt"), true);
    expect(runs).toEqual(["dealt"]);
  });

  it("flush() forces everything now - this is Save Now", async () => {
    const runs = [];
    const q = createWriteQueue({ debounceMs: 100000 });
    q.enqueue("a", async () => runs.push("a"));
    q.enqueue("b", async () => runs.push("b"));
    expect(runs).toEqual([]);
    await q.flush();
    expect(runs.sort()).toEqual(["a", "b"]);
  });

  it("reports saving then saved", async () => {
    const seen = [];
    const q = createWriteQueue({ debounceMs: 50, onStatus: (s) => seen.push(s.status) });
    q.enqueue("a", async () => {});
    await vi.advanceTimersByTimeAsync(100);
    expect(seen).toContain("saving");
    expect(seen[seen.length - 1]).toBe("saved");
    expect(q.hasPending()).toBe(false);
  });

  it("retries a failed write instead of dropping it - the save guarantee", async () => {
    let attempts = 0;
    const q = createWriteQueue({ debounceMs: 10 });
    q.enqueue("a", async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("network down");
      return { ok: true };
    });
    await vi.advanceTimersByTimeAsync(20);
    expect(attempts).toBe(1);
    expect(q.status()).toBe("error");

    await vi.advanceTimersByTimeAsync(4000); // first backoff
    await vi.advanceTimersByTimeAsync(8000); // second backoff
    expect(attempts).toBe(3);
    expect(q.status()).toBe("saved");
  });

  it("surfaces a stale rejection to the caller rather than retrying it forever", async () => {
    const results = [];
    const q = createWriteQueue({ debounceMs: 10, onResult: (k, r) => results.push([k, r.reason]) });
    q.enqueue("a", async () => ({ ok: false, reason: "stale" }));
    await vi.advanceTimersByTimeAsync(50);
    expect(results).toEqual([["a", "stale"]]);
    expect(q.hasPending()).toBe(false); // a conflict is not a retryable failure
  });

  it("does not lose a write enqueued while a batch is in flight", async () => {
    const runs = [];
    let release;
    const gate = new Promise((r) => (release = r));
    const q = createWriteQueue({ debounceMs: 10 });
    q.enqueue("slow", async () => {
      await gate;
      runs.push("slow");
    });
    await vi.advanceTimersByTimeAsync(20);
    q.enqueue("late", async () => runs.push("late"));
    release();
    await vi.advanceTimersByTimeAsync(50);
    expect(runs).toEqual(["slow", "late"]);
  });
});
