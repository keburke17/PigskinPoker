import { describe, expect, it } from "vitest";
import { PAGE, selectAll } from "../src/storage/selectAll.js";

/* A stand-in for a supabase-js select: it remembers the range asked for and, like
 * PostgREST, never hands back more than max_rows however wide the range. */
function fakeTable(count, { maxRows = PAGE, failOnPage = null } = {}) {
  const rows = Array.from({ length: count }, (_, i) => ({ id: i }));
  const calls = [];
  const build = () => ({
    range(from, to) {
      calls.push([from, to]);
      if (failOnPage === calls.length) return Promise.resolve({ data: null, error: { message: "boom" } });
      const end = Math.min(to + 1, from + maxRows, rows.length);
      return Promise.resolve({ data: rows.slice(from, end), error: null });
    },
  });
  return { build, calls };
}

describe("selectAll - every row past the server's 1000-row cap (Scott, 2026-10-19)", () => {
  it("reads a table bigger than one page completely, in order", async () => {
    const { build, calls } = fakeTable(2500);
    const { data, error } = await selectAll(build);
    expect(error).toBeNull();
    expect(data).toHaveLength(2500);
    expect(data.map((r) => r.id)).toEqual(Array.from({ length: 2500 }, (_, i) => i));
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("asks once for a small table", async () => {
    const { build, calls } = fakeTable(224);
    const { data } = await selectAll(build);
    expect(data).toHaveLength(224);
    expect(calls).toHaveLength(1);
  });

  it("asks once more when the table is an exact multiple of a page", async () => {
    const { build, calls } = fakeTable(2000);
    const { data } = await selectAll(build);
    expect(data).toHaveLength(2000);
    expect(calls).toHaveLength(3);
  });

  it("hands back the error rather than a partial list", async () => {
    const { build } = fakeTable(2500, { failOnPage: 2 });
    const { data, error } = await selectAll(build);
    expect(data).toBeNull();
    expect(error.message).toBe("boom");
  });
});
