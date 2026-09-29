import { describe, expect, it } from "vitest";
import type { GraphRow } from "../git/types";
import { graphLanes, laneColor, MAX_LANES } from "./CommitGraph";

const row = (col: number, extra: Partial<GraphRow> = {}): GraphRow => ({ col, color: 0, through: [], up: [], down: [], ...extra });

describe("commit graph", () => {
  it("sizes the graph to the widest lane any row uses", () => {
    expect(graphLanes([])).toBe(1);
    expect(graphLanes([row(0), row(0, { down: [{ col: 2, color: 1 }] })])).toBe(3);
    expect(graphLanes([row(1, { through: [{ col: 0, color: 0 }] })])).toBe(2);
  });

  it("caps the width so subjects keep their room", () => {
    expect(graphLanes([row(0, { through: [{ col: 20, color: 0 }] })])).toBe(MAX_LANES);
  });

  it("cycles lane colors through the palette", () => {
    expect(laneColor(0)).toBe("var(--accent)");
    expect(laneColor(5)).toBe(laneColor(0));
  });
});
