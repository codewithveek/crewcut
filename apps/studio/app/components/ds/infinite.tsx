import { IconLoader2 } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The nearest ancestor that scrolls vertically (null = the page itself). */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = window.getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") return node;
  }
  return null;
}

/**
 * Infinite scroll: place at the end of a list. It loads the next page when it
 * comes within `ahead` px of view, measured against the list's own scroll
 * container (so the margin works inside panels and dialogs, not only the page).
 *
 * Guards against the usual failure modes:
 * - one request at a time: nothing starts while `loading` is true;
 * - a tall screen or short page keeps loading until it's filled, then stops;
 * - a page that adds nothing (`count` didn't grow) stops automatic loading and
 *   shows a button instead, so a misbehaving source can't loop forever;
 * - an error stops automatic loading and offers "Try again";
 * - keyboard and screen-reader people get a real button and a polite status.
 */
export function InfiniteSentinel({
  hasMore,
  loading,
  onLoadMore,
  count,
  error,
  ahead = 600,
  resetKey,
  className,
}: {
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  /** Items shown so far: if a load doesn't add any, automatic loading pauses. */
  count: number;
  error?: unknown;
  ahead?: number;
  /** Changes when the list starts over (a new search or filter). */
  resetKey?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [stalled, setStalled] = useState(false);
  const countAtRequest = useRef<number | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const load = useRef(onLoadMore);
  load.current = onLoadMore;

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    rootRef.current = scrollParent(element);
    const observer = new IntersectionObserver(([entry]) => setNear(Boolean(entry?.isIntersecting)), { root: rootRef.current, rootMargin: `0px 0px ${ahead}px 0px` });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ahead, hasMore]);

  // A new list (search, filter) starts fresh.
  useEffect(() => {
    setStalled(false);
    countAtRequest.current = null;
  }, [resetKey]);

  // One effect decides both, so the "did that page add anything?" check always
  // runs before the next request can start.
  useEffect(() => {
    if (loading) return;
    if (countAtRequest.current !== null) {
      const added = count > countAtRequest.current;
      countAtRequest.current = null;
      if (!added) {
        setStalled(true);
        return;
      }
    }
    if (!near || !hasMore || error || stalled) return;
    // The observer reports a moment late: right after a page lands it can still
    // say "near" although the new rows pushed the end out of range. Measure now.
    const element = ref.current;
    if (!element || element.getClientRects().length === 0) return;
    const bottom = rootRef.current ? rootRef.current.getBoundingClientRect().bottom : window.innerHeight;
    if (element.getBoundingClientRect().top - bottom > ahead) return;
    countAtRequest.current = count;
    load.current();
  }, [near, hasMore, loading, error, stalled, count, ahead]);

  if (!hasMore) return null;
  const manual = Boolean(error) || stalled;
  return (
    <div ref={ref} className={cn("flex min-h-8 items-center justify-center py-2", className)} aria-live="polite">
      {loading ? (
        <span className="flex items-center gap-2 text-[11px] text-ds-text-3">
          <IconLoader2 className="size-4 motion-safe:animate-spin" aria-hidden /> Loading more…
        </span>
      ) : manual ? (
        <span className="flex flex-col items-center gap-1">
          {error ? <span className="text-[11px] text-ds-danger">Couldn't load more.</span> : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setStalled(false);
              countAtRequest.current = count;
              load.current();
            }}
          >
            {error ? "Try again" : "Load more"}
          </Button>
        </span>
      ) : (
        // Off-screen until reached; still reachable by keyboard.
        <button type="button" className="sr-only focus:not-sr-only focus:text-[11px] focus:text-ds-text-2" onClick={() => load.current()}>
          Load more
        </button>
      )}
    </div>
  );
}
