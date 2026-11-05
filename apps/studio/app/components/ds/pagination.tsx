import { IconChevronLeft, IconChevronRight, IconSearch, IconX } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/** Page numbers to show: always the first and last, the current one and its neighbours, gaps as null. */
export function pageWindow(page: number, pageCount: number): Array<number | null> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);
  const pages = new Set([1, pageCount, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((value) => pages.add(value));
  if (page >= pageCount - 2) [pageCount - 3, pageCount - 2, pageCount - 1].forEach((value) => pages.add(value));
  const sorted = [...pages].filter((value) => value >= 1 && value <= pageCount).sort((a, b) => a - b);
  const out: Array<number | null> = [];
  sorted.forEach((value, index) => {
    if (index > 0 && value - (sorted[index - 1] as number) > 1) out.push(null);
    out.push(value);
  });
  return out;
}

const PAGE_BUTTON =
  "pc-press inline-flex h-8 min-w-8 items-center justify-center rounded-ds-sm px-2 text-[13px] tabular outline-none focus-visible:ring-2 focus-visible:ring-ds-accent disabled:pointer-events-none disabled:opacity-40";

/**
 * Numbered pagination with a "21–40 of 133" summary. Pages are 1-based.
 * Renders nothing when everything fits on one page.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  noun = "items",
  className,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  noun?: string;
  className?: string;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const current = Math.min(Math.max(page, 1), pageCount);
  const from = (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, total);
  return (
    <nav aria-label={`${noun} pages`} className={cn("flex flex-col items-center justify-between gap-3 sm:flex-row", className)}>
      <p className="text-[13px] tabular text-ds-text-2" aria-live="polite">
        {from}–{to} of {total} {noun}
      </p>
      <div className="flex items-center gap-1">
        <button type="button" className={cn(PAGE_BUTTON, "text-ds-text-2 hover:bg-ds-surface-2 hover:text-ds-text")} disabled={current <= 1} onClick={() => onPageChange(current - 1)} aria-label="Previous page">
          <IconChevronLeft className="size-4" />
          <span className="hidden sm:inline">Previous</span>
        </button>
        {pageWindow(current, pageCount).map((value, index) =>
          value === null ? (
            <span key={`gap-${index}`} className="px-1 text-[13px] text-ds-text-3" aria-hidden>
              …
            </span>
          ) : (
            <button
              key={value}
              type="button"
              aria-label={`Page ${value}`}
              aria-current={value === current ? "page" : undefined}
              onClick={() => onPageChange(value)}
              className={cn(PAGE_BUTTON, value === current ? "bg-ds-surface-3 font-medium text-ds-text" : "text-ds-text-2 hover:bg-ds-surface-2 hover:text-ds-text", Math.abs(value - current) > 1 && value !== 1 && value !== pageCount && "hidden sm:inline-flex")}
            >
              {value}
            </button>
          ),
        )}
        <button type="button" className={cn(PAGE_BUTTON, "text-ds-text-2 hover:bg-ds-surface-2 hover:text-ds-text")} disabled={current >= pageCount} onClick={() => onPageChange(current + 1)} aria-label="Next page">
          <span className="hidden sm:inline">Next</span>
          <IconChevronRight className="size-4" />
        </button>
      </div>
    </nav>
  );
}

/** A value that settles `delay` ms after the last change (search boxes). */
export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/** Search box with a clear button; the parent owns the text (debounce it before querying). */
export function SearchField({
  value,
  onChange,
  label,
  placeholder = "Search",
  size = "md",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  size?: "sm" | "md" | "pill";
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex min-w-0 items-center gap-2 bg-ds-surface shadow-[0_0_0_1px_var(--ds-hairline)] focus-within:shadow-[0_0_0_1.5px_var(--ds-accent)]",
        size === "sm" ? "h-8 rounded-ds-sm bg-ds-surface-2 px-2" : size === "pill" ? "h-10 rounded-full px-3.5" : "h-9 rounded-ds-sm px-3",
        className,
      )}
    >
      <IconSearch className="size-4 shrink-0 text-ds-text-3" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        // Editor shortcuts (Delete, Space, arrows) must not fire while typing.
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape" && value) {
            event.preventDefault();
            onChange("");
          }
        }}
        placeholder={placeholder}
        aria-label={label}
        className={cn("min-w-0 flex-1 bg-transparent text-ds-text outline-none placeholder:text-ds-text-3 [&::-webkit-search-cancel-button]:hidden", size === "sm" ? "text-[13px]" : "text-sm")}
      />
      {value ? (
        <button type="button" aria-label="Clear search" onClick={() => onChange("")} className="text-ds-text-3 hover:text-ds-text">
          <IconX className="size-4" />
        </button>
      ) : null}
    </label>
  );
}
