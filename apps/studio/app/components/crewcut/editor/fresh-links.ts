import { useEffect, useRef, useState } from "react";

import { linkExpiresAt } from "@/lib/media-links";

import { useEditor } from "./editor-store";

/** Fetch new links this long before the earliest one expires (inside the store's 2-minute "replace" window). */
const AHEAD_MS = 90_000;
/** Never re-read sooner than this, even when links have already expired (laptop woke up, offline). */
const MIN_WAIT_MS = 30_000;
/** A re-read that didn't renew the earliest link (offline, or a link the server no longer sends) waits longer each time, up to this. */
const MAX_BACKOFF_MS = 10 * 60_000;
/** setTimeout's largest delay; later expiries are planned again when it fires. */
const MAX_WAIT_MS = 2 ** 31 - 1;

/**
 * Media links expire (local files after 15–30 minutes, bucket files after
 * hours). An editor left open would keep showing the old links and media
 * would stop loading. This re-reads the composition shortly before the
 * earliest link runs out; the store swaps in only the links about to expire.
 */
export function useFreshMediaLinks(): void {
  const assetUrls = useEditor((state) => state.assetUrls);
  const [round, setRound] = useState(0);
  /** The earliest expiry a timed re-read was for, until the next plan looks at what it achieved. */
  const checked = useRef<number | null>(null);
  const misses = useRef(0);
  useEffect(() => {
    let earliest = Number.POSITIVE_INFINITY;
    for (const url of Object.values(assetUrls)) earliest = Math.min(earliest, linkExpiresAt(url));
    if (checked.current !== null) {
      misses.current = earliest === checked.current ? misses.current + 1 : 0;
      checked.current = null;
    }
    if (!Number.isFinite(earliest)) return;
    const backoff = Math.min(MAX_BACKOFF_MS, MIN_WAIT_MS * 2 ** misses.current);
    const wait = Math.min(MAX_WAIT_MS, Math.max(backoff, earliest - Date.now() - AHEAD_MS));
    const timer = setTimeout(() => {
      void useEditor
        .getState()
        .refresh()
        .finally(() => {
          checked.current = earliest;
          setRound((value) => value + 1);
        });
    }, wait);
    return () => clearTimeout(timer);
  }, [assetUrls, round]);
}
