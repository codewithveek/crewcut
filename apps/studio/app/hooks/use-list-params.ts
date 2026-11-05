import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";

import { useDebouncedValue } from "@/components/ds";

/**
 * List state that lives in the URL (?q=…&filter=…&sort=…&page=…), so back /
 * forward, refresh and shared links keep the same results. Defaults are left
 * out of the URL. The search text updates instantly in the box and reaches
 * the URL (and the server) once typing settles; any change but the page
 * itself goes back to page 1.
 */
export function useListParams<F extends string, S extends string>(defaults: { filter: F; sort: S }) {
  const [params, setParams] = useSearchParams();
  const urlQuery = params.get("q") ?? "";
  const filter = (params.get("filter") as F | null) ?? defaults.filter;
  const sort = (params.get("sort") as S | null) ?? defaults.sort;
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);

  const [text, setText] = useState(urlQuery);
  const settled = useDebouncedValue(text, 250);

  const update = useCallback(
    (changes: Record<string, string | number | null>) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(changes)) {
            const isDefault = value === null || value === "" || (key === "filter" && value === defaults.filter) || (key === "sort" && value === defaults.sort) || (key === "page" && value === 1);
            if (isDefault) next.delete(key);
            else next.set(key, String(value));
          }
          if (!("page" in changes)) next.delete("page");
          return next;
        },
        { replace: !("page" in changes) },
      );
    },
    [setParams, defaults.filter, defaults.sort],
  );

  // Typing settles → URL. Back/forward to another query → box.
  useEffect(() => {
    if (settled.trim() !== urlQuery) update({ q: settled.trim() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled]);
  useEffect(() => {
    if (urlQuery !== settled.trim()) setText(urlQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQuery]);

  return {
    /** Call with the total once loaded: a page past the end (after deletes, or an old link) goes to the last page. */
    clampPage(total: number, pageSize: number) {
      const last = Math.max(1, Math.ceil(total / pageSize));
      if (page > last) update({ page: last });
    },
    text,
    setText,
    query: urlQuery,
    filter,
    setFilter: (value: F) => update({ filter: value }),
    sort,
    setSort: (value: S) => update({ sort: value }),
    page,
    setPage: (value: number) => {
      update({ page: value });
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
  };
}
