import type { CommitGraphCommit } from "@t3tools/contracts";

/**
 * Assigns commits to lanes and works out the line segments between them, the
 * way VS Code's graph draws branches. Pure so the panel can recompute it after
 * appending a page without another round trip.
 */

/** Wider than this and the rows stop being readable, so lanes collapse instead. */
const MAX_LANES = 12;
/** Lane colours cycle; the renderer maps an index to a CSS variable. */
export const COMMIT_GRAPH_LANE_COLORS = 6;

export interface CommitGraphEdge {
  /** Lane the segment enters from. */
  readonly from: number;
  /** Lane the segment leaves at. */
  readonly to: number;
  readonly colorIndex: number;
}

export interface CommitGraphRow {
  readonly sha: string;
  /** Lane the commit dot sits in. */
  readonly lane: number;
  readonly colorIndex: number;
  /** Lanes this row needs room for. */
  readonly laneCount: number;
  /** Segments from the top of the row down to the dot. */
  readonly topEdges: ReadonlyArray<CommitGraphEdge>;
  /** Segments from the dot down to the bottom of the row. */
  readonly bottomEdges: ReadonlyArray<CommitGraphEdge>;
}

export interface CommitGraphLayout {
  readonly rows: ReadonlyArray<CommitGraphRow>;
  /** Widest row, so every row can share one column width. */
  readonly laneCount: number;
}

function laneColor(lane: number): number {
  return lane % COMMIT_GRAPH_LANE_COLORS;
}

export function layoutCommitGraph(
  commits: ReadonlyArray<Pick<CommitGraphCommit, "sha" | "parents">>,
): CommitGraphLayout {
  // Each slot holds the sha the lane is waiting to draw next, or null if free.
  const lanes: (string | null)[] = [];
  const rows: CommitGraphRow[] = [];
  let widest = 1;

  const claimFreeLane = (): number => {
    const free = lanes.indexOf(null);
    if (free >= 0) {
      return free;
    }
    if (lanes.length >= MAX_LANES) {
      // Beyond this the graph is unreadable anyway; share the last lane.
      return MAX_LANES - 1;
    }
    lanes.push(null);
    return lanes.length - 1;
  };

  for (const commit of commits) {
    const expecting: number[] = [];
    for (const [index, sha] of lanes.entries()) {
      if (sha === commit.sha) {
        expecting.push(index);
      }
    }

    const lane = expecting[0] ?? claimFreeLane();
    const before = [...lanes];

    // Every lane waiting on this commit merges into its dot.
    for (const index of expecting) {
      lanes[index] = null;
    }
    lanes[lane] = null;

    const parentLanes: number[] = [];
    for (const [parentIndex, parent] of commit.parents.entries()) {
      const existing = lanes.indexOf(parent);
      if (existing >= 0) {
        parentLanes.push(existing);
        continue;
      }
      // The first parent continues the commit's own lane; the rest branch out.
      const target = parentIndex === 0 ? lane : claimFreeLane();
      lanes[target] = parent;
      parentLanes.push(target);
    }

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop();
    }
    const after = [...lanes];

    const topEdges: CommitGraphEdge[] = [];
    for (const [index, sha] of before.entries()) {
      if (sha === null) {
        continue;
      }
      topEdges.push(
        sha === commit.sha
          ? { from: index, to: lane, colorIndex: laneColor(index) }
          : { from: index, to: index, colorIndex: laneColor(index) },
      );
    }

    const bottomEdges: CommitGraphEdge[] = [];
    for (const [index, sha] of after.entries()) {
      if (sha === null) {
        continue;
      }
      const passesThrough = before[index] === sha && sha !== commit.sha;
      if (passesThrough) {
        bottomEdges.push({ from: index, to: index, colorIndex: laneColor(index) });
      }
      if (parentLanes.includes(index)) {
        bottomEdges.push({ from: lane, to: index, colorIndex: laneColor(index) });
      }
    }

    const laneCount = Math.max(before.length, after.length, lane + 1);
    widest = Math.max(widest, laneCount);
    rows.push({
      sha: commit.sha,
      lane,
      colorIndex: laneColor(lane),
      laneCount,
      topEdges,
      bottomEdges,
    });
  }

  return { rows, laneCount: widest };
}
