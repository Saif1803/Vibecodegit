import { useEffect, useRef, useState, type ReactNode } from "react";

export interface VirtualListProps<T> {
  items: T[];
  itemHeight: number;
  renderItem: (item: T, index: number) => ReactNode;
  keyExtractor?: (item: T, index: number) => string | number;
  overscan?: number;
  threshold?: number;
  className?: string;
}

/**
 * Windowed virtual list that only renders items visible in the scroll viewport (plus an overscan buffer).
 * For lists smaller than `threshold`, renders normally with zero virtualization overhead.
 */
export function VirtualList<T>({
  items,
  itemHeight,
  renderItem,
  keyExtractor = (_, index) => index,
  overscan = 10,
  threshold = 40,
  className,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState({ scrollTop: 0, clientHeight: 600 });

  useEffect(() => {
    if (items.length <= threshold) return;
    const el = containerRef.current;
    if (!el) return;
    const scrollParent = (el.closest(".overflow-y-auto") as HTMLElement | null) || el.parentElement || el;

    const onScroll = () => {
      const containerRect = el.getBoundingClientRect();
      const parentRect = scrollParent.getBoundingClientRect();
      const relativeTop = containerRect.top - parentRect.top;
      const effectiveScroll = Math.max(0, -relativeTop);
      setScrollState({
        scrollTop: effectiveScroll,
        clientHeight: scrollParent.clientHeight || 600,
      });
    };

    onScroll();
    scrollParent.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      scrollParent.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [items.length, threshold]);

  if (items.length <= threshold) {
    return (
      <div ref={containerRef} className={className}>
        {items.map((item, index) => (
          <div key={keyExtractor(item, index)}>{renderItem(item, index)}</div>
        ))}
      </div>
    );
  }

  const totalHeight = items.length * itemHeight;
  const startIndex = Math.max(0, Math.floor(scrollState.scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(
    items.length,
    Math.ceil((scrollState.scrollTop + scrollState.clientHeight) / itemHeight) + overscan,
  );

  const topPadding = startIndex * itemHeight;
  const bottomPadding = Math.max(0, (items.length - endIndex) * itemHeight);
  const visible = items.slice(startIndex, endIndex);

  return (
    <div ref={containerRef} className={className} style={{ minHeight: totalHeight, boxSizing: "border-box" }}>
      {topPadding > 0 && <div style={{ height: topPadding }} aria-hidden="true" />}
      {visible.map((item, i) => {
        const index = startIndex + i;
        return <div key={keyExtractor(item, index)}>{renderItem(item, index)}</div>;
      })}
      {bottomPadding > 0 && <div style={{ height: bottomPadding }} aria-hidden="true" />}
    </div>
  );
}
