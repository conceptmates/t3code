import { describe, expect, it } from "vite-plus/test";

import { layoutCommitGraph } from "./commitGraphLayout";

function commit(sha: string, ...parents: string[]) {
  return { sha, parents };
}

describe("layoutCommitGraph", () => {
  it("keeps a linear history in one lane", () => {
    const layout = layoutCommitGraph([commit("c", "b"), commit("b", "a"), commit("a")]);

    expect(layout.laneCount).toBe(1);
    expect(layout.rows.map((row) => row.lane)).toEqual([0, 0, 0]);
    expect(layout.rows[1]?.topEdges).toEqual([{ from: 0, to: 0, colorIndex: 0 }]);
    // The root commit has no parent, so nothing leaves the bottom of its row.
    expect(layout.rows[2]?.bottomEdges).toEqual([]);
  });

  it("gives a merge's second parent its own lane and merges it back", () => {
    // m ── merges b (lane 0) and c (lane 1), both on top of a.
    const layout = layoutCommitGraph([
      commit("m", "b", "c"),
      commit("b", "a"),
      commit("c", "a"),
      commit("a"),
    ]);

    expect(layout.laneCount).toBe(2);
    expect(layout.rows.map((row) => row.lane)).toEqual([0, 0, 1, 0]);
    // The merge fans out to both parent lanes.
    expect(layout.rows[0]?.bottomEdges).toEqual([
      { from: 0, to: 0, colorIndex: 0 },
      { from: 0, to: 1, colorIndex: 1 },
    ]);
    // `c` shares `a` with lane 0, so lane 1 folds back in on `c`'s own row.
    expect(layout.rows[2]?.bottomEdges).toEqual([
      { from: 0, to: 0, colorIndex: 0 },
      { from: 1, to: 0, colorIndex: 0 },
    ]);
    // By the time `a` is drawn only one lane is left.
    expect(layout.rows[3]?.topEdges).toEqual([{ from: 0, to: 0, colorIndex: 0 }]);
  });

  it("draws a lane straight past a commit that is not on it", () => {
    // `side` sits between two commits of the main lane and must not absorb it.
    const layout = layoutCommitGraph([
      commit("head", "base"),
      commit("side", "base"),
      commit("base"),
    ]);

    const sideRow = layout.rows[1];
    expect(sideRow?.lane).toBe(1);
    expect(sideRow?.topEdges).toContainEqual({ from: 0, to: 0, colorIndex: 0 });
    expect(sideRow?.bottomEdges).toContainEqual({ from: 0, to: 0, colorIndex: 0 });
  });

  it("reuses a freed lane instead of growing forever", () => {
    const layout = layoutCommitGraph([
      commit("m", "b", "c"),
      commit("b", "a"),
      commit("c", "a"),
      commit("a", "z"),
      commit("z"),
      commit("y"),
    ]);

    expect(layout.rows.at(-1)?.lane).toBe(0);
    expect(layout.laneCount).toBe(2);
  });

  it("caps the lane count on a pathological fan-out", () => {
    const commits = [
      commit("root", ...Array.from({ length: 40 }, (_, index) => `p${index}`)),
      ...Array.from({ length: 40 }, (_, index) => commit(`p${index}`)),
    ];

    const layout = layoutCommitGraph(commits);

    expect(layout.laneCount).toBeLessThanOrEqual(12);
  });
});
