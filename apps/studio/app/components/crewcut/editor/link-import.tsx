import { callAction } from "@agent-native/core/client/hooks";
import { IconLoader2, IconMusic, IconPhoto, IconVideo } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button, Dialog } from "@/components/ds";
import { errorMessage } from "@/lib/crewcut";

import type { AssetDto } from "./media";

/**
 * "From a link": paste a web address. A link to a picture, video or sound
 * file is saved straight away; a web page shows the media on it to pick from.
 * The server does the fetching (public addresses only, size-capped) and
 * refuses video platforms such as YouTube.
 */

interface Candidate {
  url: string;
  kind: "image" | "video" | "audio";
  alt: string;
  width: number | null;
  height: number | null;
}

type ImportResult =
  | { imported: true; reused: boolean; assetId: string; asset: AssetDto; note?: string }
  | { imported: false; page: { url: string; title: string }; candidates: Candidate[] };

const INPUT =
  "h-9 min-w-0 flex-1 rounded-ds-sm bg-ds-surface-2 px-3 text-sm text-ds-text shadow-[inset_0_0_0_1px_var(--ds-hairline)] outline-none placeholder:text-ds-text-3 focus:shadow-[inset_0_0_0_1.5px_var(--ds-accent)]";

function fileNameOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? url);
  } catch {
    return url;
  }
}

function CandidateTile({ candidate, busy, disabled, onPick }: { candidate: Candidate; busy: boolean; disabled: boolean; onPick: () => void }) {
  const [broken, setBroken] = useState(false);
  const name = candidate.alt || fileNameOf(candidate.url);
  const Icon = candidate.kind === "video" ? IconVideo : candidate.kind === "audio" ? IconMusic : IconPhoto;
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      title={name}
      aria-label={`Import ${name}`}
      className="pc-press group relative flex aspect-[4/3] flex-col overflow-hidden rounded-ds-sm bg-ds-surface-2 text-left shadow-[inset_0_0_0_1px_var(--ds-hairline)] outline-none hover:shadow-[inset_0_0_0_1.5px_var(--ds-accent)] focus-visible:ring-2 focus-visible:ring-ds-accent disabled:opacity-60"
    >
      {candidate.kind === "image" && !broken ? (
        <img src={candidate.url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="size-full object-cover" />
      ) : (
        <span className="flex flex-1 flex-col items-center justify-center gap-1 px-2 text-ds-text-2">
          <Icon className="size-5" />
          <span className="line-clamp-2 break-all text-center text-[11px]">{name}</span>
        </span>
      )}
      {busy ? (
        <span className="absolute inset-0 flex items-center justify-center bg-ds-surface/70">
          <IconLoader2 className="size-5 animate-spin text-ds-text" />
        </span>
      ) : null}
    </button>
  );
}

export function LinkImportDialog({ open, onOpenChange, videoId, onImported }: { open: boolean; onOpenChange: (open: boolean) => void; videoId: string | null; onImported?: (asset: AssetDto) => void }) {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const [page, setPage] = useState<{ url: string; title: string; candidates: Candidate[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) return;
    setUrl("");
    setPage(null);
    setBusy(null);
    setError(null);
  }, [open]);

  const run = async (target: string, extra: { pageUrl?: string; label?: string } = {}) => {
    if (busy) return;
    setBusy(target);
    setError(null);
    try {
      const result = (await callAction("import-from-link" as never, { url: target, ...(videoId ? { videoId } : {}), ...extra } as never)) as ImportResult;
      if (!result.imported) {
        setPage({ ...result.page, candidates: result.candidates });
        if (result.candidates.length === 0) setError("That page shows no pictures or media files Crewcut can use. Try a direct link to the file.");
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ["action", "list-assets"] });
      onImported?.(result.asset);
      toast.success(result.reused ? `“${result.asset.label}” is already in your media` : `Added “${result.asset.label}”`, result.note ? { description: result.note } : undefined);
      onOpenChange(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const submit = () => {
    const value = url.trim();
    if (!value) {
      field.current?.focus();
      return;
    }
    setPage(null);
    void run(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Import from a link"
      description="Paste a link to a picture, video or sound file, or to a web page to pick from. Use media you made or have the rights to."
      className="w-[min(640px,calc(100vw-32px))]"
      footer={
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      }
    >
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <input
          ref={field}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          aria-label="Link"
          placeholder="https://…"
          className={INPUT}
          // Typing here must never reach the editor's shortcuts.
          onKeyDown={(event) => event.stopPropagation()}
          autoFocus
        />
        <Button type="submit" disabled={Boolean(busy)} className="pc-press shrink-0">
          {busy && !page ? "Getting…" : "Get"}
        </Button>
      </form>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-ds-danger">
          {error}
        </p>
      ) : null}
      {page && page.candidates.length > 0 ? (
        <div className="mt-4">
          <p className="mb-2 truncate text-xs text-ds-text-2">
            {page.candidates.length} on <span className="text-ds-text">{page.title || new URL(page.url).hostname}</span>. Pick one to import.
          </p>
          <div className="grid max-h-[50vh] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4">
            {page.candidates.map((candidate) => (
              <CandidateTile
                key={candidate.url}
                candidate={candidate}
                busy={busy === candidate.url}
                disabled={Boolean(busy)}
                onPick={() => void run(candidate.url, { pageUrl: page.url, ...(candidate.alt ? { label: candidate.alt.slice(0, 120) } : {}) })}
              />
            ))}
          </div>
        </div>
      ) : null}
      <p className="mt-4 text-xs text-ds-text-3">YouTube, TikTok, Instagram and other video platforms aren&rsquo;t supported: their terms don&rsquo;t allow downloading.</p>
    </Dialog>
  );
}
