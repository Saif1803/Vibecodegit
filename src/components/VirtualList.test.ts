import { describe, expect, it } from "vitest";

describe("VirtualList math and windowing logic", () => {
  it("calculates window range correctly with overscan", () => {
    const itemHeight = 40;
    const overscan = 5;
    const scrollTop = 400; // item 10 is at the top
    const clientHeight = 400; // 10 items fit in view (items 10 to 19)
    const totalItems = 100;

    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const endIndex = Math.min(
      totalItems,
      Math.ceil((scrollTop + clientHeight) / itemHeight) + overscan,
    );

    // Math.floor(400/40) = 10; 10 - 5 = 5
    expect(startIndex).toBe(5);
    // Math.ceil(800/40) = 20; 20 + 5 = 25
    expect(endIndex).toBe(25);

    const topPadding = startIndex * itemHeight;
    const bottomPadding = Math.max(0, (totalItems - endIndex) * itemHeight);

    expect(topPadding).toBe(200);
    expect(bottomPadding).toBe(3000);
    expect(topPadding + (endIndex - startIndex) * itemHeight + bottomPadding).toBe(totalItems * itemHeight);
  });

  it("handles edge cases at top and bottom of scroll", () => {
    const itemHeight = 30;
    const overscan = 10;
    const totalItems = 20;

    // At scrollTop = 0
    const startTop = Math.max(0, Math.floor(0 / itemHeight) - overscan);
    expect(startTop).toBe(0);

    // At extreme bottom
    const scrollTop = 10000;
    const clientHeight = 600;
    const endBottom = Math.min(
      totalItems,
      Math.ceil((scrollTop + clientHeight) / itemHeight) + overscan,
    );
    expect(endBottom).toBe(totalItems);
  });
});
