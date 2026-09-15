import type { CommitGraphEdge, CommitGraphRow } from "./commitGraphLayout";

/**
 * One row's worth of graph lines. Static SVG with no transitions: these paint
 * on every scroll frame, and an animated stroke here pegs the GPU.
 */

export const LANE_WIDTH = 12;
export const LANE_INSET = 8;
export const GRAPH_ROW_HEIGHT = 28;

/** Static strings so Tailwind's scanner keeps these classes. */
const LANE_STROKE = [
  "stroke-blue-500",
  "stroke-emerald-500",
  "stroke-amber-500",
  "stroke-violet-500",
  "stroke-rose-500",
  "stroke-cyan-500",
] as const;

const LANE_FILL = [
  "fill-blue-500",
  "fill-emerald-500",
  "fill-amber-500",
  "fill-violet-500",
  "fill-rose-500",
  "fill-cyan-500",
] as const;

function laneX(lane: number): number {
  return lane * LANE_WIDTH + LANE_INSET;
}

function edgePath(edge: CommitGraphEdge, fromY: number, toY: number): string {
  const fromX = laneX(edge.from);
  const toX = laneX(edge.to);
  if (fromX === toX) {
    return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  }
  const midY = (fromY + toY) / 2;
  return `M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`;
}

export function graphWidth(laneCount: number): number {
  return Math.max(laneCount, 1) * LANE_WIDTH + LANE_INSET;
}

export function CommitGraphLanes({
  row,
  laneCount,
  isHead,
}: {
  readonly row: CommitGraphRow;
  readonly laneCount: number;
  readonly isHead: boolean;
}) {
  const middle = GRAPH_ROW_HEIGHT / 2;
  return (
    <svg
      aria-hidden
      className="shrink-0"
      width={graphWidth(laneCount)}
      height={GRAPH_ROW_HEIGHT}
      viewBox={`0 0 ${graphWidth(laneCount)} ${GRAPH_ROW_HEIGHT}`}
    >
      {row.topEdges.map((edge) => (
        <path
          key={`top:${edge.from}:${edge.to}`}
          d={edgePath(edge, 0, middle)}
          fill="none"
          strokeWidth={1.5}
          className={LANE_STROKE[edge.colorIndex]}
        />
      ))}
      {row.bottomEdges.map((edge) => (
        <path
          key={`bottom:${edge.from}:${edge.to}`}
          d={edgePath(edge, middle, GRAPH_ROW_HEIGHT)}
          fill="none"
          strokeWidth={1.5}
          className={LANE_STROKE[edge.colorIndex]}
        />
      ))}
      {/* HEAD reads as a ring so it stands out without another colour. */}
      <circle
        cx={laneX(row.lane)}
        cy={middle}
        r={isHead ? 4.5 : 3.5}
        strokeWidth={isHead ? 2 : 0}
        className={
          isHead ? `fill-background ${LANE_STROKE[row.colorIndex]}` : LANE_FILL[row.colorIndex]
        }
      />
    </svg>
  );
}
