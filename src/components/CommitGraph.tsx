import type { Commit, GraphRow } from "../git/types";

/** Lane colors: the accent first, then status colors, so the graph stays in the Claude palette. */
const PALETTE = ["var(--accent)", "var(--st-renamed)", "var(--st-added)", "var(--st-modified)", "var(--graph-violet)"];
export const laneColor = (i: number) => PALETTE[i % PALETTE.length];

export const LANE_W = 12;
/** Lanes beyond this are clipped so the subject keeps its room. */
export const MAX_LANES = 6;

/** Columns the loaded rows need (at least 1, at most MAX_LANES). */
export function graphLanes(rows: GraphRow[]): number {
  let max = 0;
  for (const r of rows) {
    max = Math.max(max, r.col);
    for (const l of r.through) max = Math.max(max, l.col);
    for (const l of r.up) max = Math.max(max, l.col);
    for (const l of r.down) max = Math.max(max, l.col);
  }
  return Math.min(max + 1, MAX_LANES);
}

const x = (col: number) => col * LANE_W + LANE_W / 2 + 2;

/**
 * One row of the lane graph. Rows are stacked flush, so a lane drawn to this row's bottom
 * edge continues from the next row's top edge.
 */
export function GraphCell({ commit, lanes, height }: { commit: Commit; lanes: number; height: number }) {
  const g = commit.graph;
  const mid = height / 2;
  const dot = x(g.col);
  const width = lanes * LANE_W + 4;
  // Diagonals bend smoothly between the dot and a neighbouring lane.
  const curve = (x1: number, y1: number, x2: number, y2: number) =>
    x1 === x2 ? `M${x1} ${y1}V${y2}` : `M${x1} ${y1}C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`;

  return (
    <svg width={width} height={height} className="shrink-0 overflow-hidden" aria-hidden>
      <g fill="none" strokeWidth={1.6} strokeLinecap="round">
        {g.through.map((l) => (
          <path key={`t${l.col}`} d={`M${x(l.col)} 0V${height}`} stroke={laneColor(l.color)} />
        ))}
        {g.up.map((l) => (
          <path key={`u${l.col}`} d={curve(x(l.col), 0, dot, mid)} stroke={laneColor(l.color)} />
        ))}
        {g.down.map((l) => (
          <path key={`d${l.col}`} d={curve(dot, mid, x(l.col), height)} stroke={laneColor(l.color)} />
        ))}
      </g>
      {commit.isHead ? (
        // HEAD: a ring around a dot, like the checked-out marker elsewhere.
        <>
          <circle cx={dot} cy={mid} r={5} fill="var(--surface)" stroke={laneColor(g.color)} strokeWidth={1.6} />
          <circle cx={dot} cy={mid} r={2} fill={laneColor(g.color)} />
        </>
      ) : commit.incoming ? (
        // Not pulled yet: hollow.
        <circle cx={dot} cy={mid} r={3.5} fill="var(--surface)" stroke={laneColor(g.color)} strokeWidth={1.6} />
      ) : (
        <circle cx={dot} cy={mid} r={commit.parents.length > 1 ? 3 : 3.5} fill={laneColor(g.color)} />
      )}
    </svg>
  );
}
