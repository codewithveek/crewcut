import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import {
  type Composition,
  THUMBNAIL_POSITIONS,
  THUMBNAIL_STYLES,
  type ThumbnailVariant,
  durationInFrames,
  formatTimecode,
  msToFrame,
  thumbnailAtMs,
  thumbnailComposition,
} from "@crewcut/composition";
import { CrewcutVideo } from "@crewcut/renderer";
import { Thumbnail } from "@remotion/player";
import { IconCheck, IconDownload, IconPlus, IconSparkles, IconTarget, IconTrash } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button, Dialog, Segmented, Select, SkeletonLines, Switch } from "@/components/ds";
import { errorMessage } from "@/lib/crewcut";
import { cn } from "@/lib/utils";

import { askEditorAgent } from "./assistant";
import { useEditor } from "./editor-store";

/**
 * The thumbnail & title lab: several titles and thumbnails per video, each
 * scored against the channel's own click-through history (once it has
 * enough), and the ones publishing uses.
 */

interface Score {
  predictedCtr: number | null;
  vsTypical: number | null;
  confidence: "none" | "low" | "medium" | "high";
  reasons: string[];
  basedOn: number;
}
type Check = { ok: boolean; note: string };
interface TitleRow {
  id: string;
  text: string;
  why: string;
  author: string;
  chosen: boolean;
  score: Score;
  checks: Check[];
}
interface ThumbRow extends ThumbnailVariant {
  author: string;
  chosen: boolean;
  score: Score;
  checks: Check[];
}
export interface PackagingData {
  titles: TitleRow[];
  thumbnails: ThumbRow[];
  chosenTitleId: string | null;
  chosenThumbnailId: string | null;
  history: { published: number; measured: number };
  note?: string;
}

const INPUT =
  "h-8 min-w-0 rounded-ds-xs bg-ds-surface-2 px-2 text-[13px] text-ds-text shadow-[inset_0_0_0_1px_var(--ds-hairline)] outline-none placeholder:text-ds-text-3 focus:shadow-[inset_0_0_0_1.5px_var(--ds-accent)]";
const STYLE_LABELS: Record<(typeof THUMBNAIL_STYLES)[number], string> = { bold: "Bold", boxed: "Boxed", outline: "Outline", minimal: "Minimal" };
const POSITION_LABELS: Record<(typeof THUMBNAIL_POSITIONS)[number], string> = { top: "Top", center: "Middle", bottom: "Bottom" };

export function usePackaging(videoId: string | null, enabled = true) {
  const query = useActionQuery("get-packaging", { videoId } as never, { enabled: Boolean(videoId) && enabled } as never);
  return { data: query.data as PackagingData | undefined, loading: query.isLoading, refetch: query.refetch };
}

function ScoreBadge({ score, checks }: { score: Score; checks: Check[] }) {
  const failing = checks.filter((check) => !check.ok);
  const detail = [...(score.predictedCtr !== null ? score.reasons : []), ...checks.map((check) => `${check.ok ? "✓" : "!"} ${check.note}`)].join("\n");
  return (
    <span title={detail} className="inline-flex shrink-0 items-center gap-1.5 text-[11px] tabular-nums">
      {score.predictedCtr !== null ? (
        <span
          className={cn(
            "rounded-full px-2 py-0.5 font-medium",
            (score.vsTypical ?? 1) >= 1.1 ? "bg-ds-accent-soft text-ds-accent" : (score.vsTypical ?? 1) <= 0.9 ? "bg-ds-surface-3 text-ds-text-3" : "bg-ds-surface-3 text-ds-text-2",
          )}
        >
          {(score.predictedCtr * 100).toFixed(1)}% CTR · {score.vsTypical?.toFixed(2)}×
        </span>
      ) : null}
      {failing.length ? <span className="rounded-full bg-ds-surface-3 px-2 py-0.5 text-ds-text-2">{failing.length === 1 ? failing[0]!.note : `${failing.length} checks to look at`}</span> : null}
    </span>
  );
}

function ThumbPreview({ composition, variant, assetUrls }: { composition: Composition; variant: ThumbnailVariant; assetUrls: Record<string, string> }) {
  const thumb = useMemo(() => {
    try {
      return thumbnailComposition(composition, variant);
    } catch {
      return composition;
    }
  }, [composition, variant]);
  const inputProps = useMemo(() => ({ composition: thumb, assetUrls, options: { burnCaptions: false } }), [thumb, assetUrls]);
  return (
    <Thumbnail
      component={CrewcutVideo}
      inputProps={inputProps}
      compositionWidth={thumb.width}
      compositionHeight={thumb.height}
      durationInFrames={durationInFrames(thumb.durationMs, thumb.fps)}
      fps={thumb.fps}
      frameToDisplay={Math.min(durationInFrames(thumb.durationMs, thumb.fps) - 1, msToFrame(thumbnailAtMs(composition, variant), thumb.fps))}
      style={{ width: "100%", height: "100%" }}
    />
  );
}

function ThumbCard({ row, composition, assetUrls, onChange, onChoose, onRemove }: { row: ThumbRow; composition: Composition; assetUrls: Record<string, string>; onChange: (patch: Partial<ThumbnailVariant>) => void; onChoose: () => void; onRemove: () => void }) {
  const [headline, setHeadline] = useState(row.headline);
  useEffect(() => setHeadline(row.headline), [row.headline]);
  const portrait = composition.height > composition.width;
  return (
    <div className={cn("flex min-w-0 flex-col gap-2 rounded-ds-md bg-ds-surface-2 p-2 shadow-[inset_0_0_0_1px_var(--ds-hairline)]", row.chosen && "shadow-[inset_0_0_0_2px_var(--ds-accent)]")}>
      <div className={cn("relative overflow-hidden rounded-ds-sm bg-black", portrait ? "mx-auto aspect-[9/16] h-56" : "aspect-video w-full")}>
        <ThumbPreview composition={composition} variant={row} assetUrls={assetUrls} />
        {row.chosen ? (
          <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-ds-accent px-2 py-0.5 text-[11px] font-medium text-ds-on-accent">
            <IconCheck className="size-3" /> Chosen
          </span>
        ) : null}
      </div>
      <input
        value={headline}
        maxLength={60}
        placeholder="Headline (empty = picture only)"
        aria-label="Thumbnail headline"
        onChange={(event) => setHeadline(event.target.value)}
        onBlur={() => headline !== row.headline && onChange({ headline })}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
        }}
        className={INPUT}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Select label="Style" size="sm" className="h-7 w-24" value={row.style} onChange={(style) => onChange({ style: style as ThumbnailVariant["style"] })} options={THUMBNAIL_STYLES.map((style) => ({ value: style, label: STYLE_LABELS[style] }))} />
        <Segmented size="sm" ariaLabel="Headline position" value={row.position} onChange={(position) => onChange({ position })} options={THUMBNAIL_POSITIONS.map((position) => ({ value: position, label: POSITION_LABELS[position] }))} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-ds-text-2">
        <button type="button" onClick={() => onChange({ atMs: useEditor.getState().playheadMs })} className="pc-press inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 hover:text-ds-text" title="Use the frame at the playhead">
          <IconTarget className="size-3.5" /> {formatTimecode(thumbnailAtMs(composition, row), { fps: composition.fps }).slice(3, 8)} · use playhead
        </button>
        <label className="inline-flex items-center gap-1.5">
          Logo <Switch label="Keep the logo" checked={row.logo} onCheckedChange={(logo) => onChange({ logo })} />
        </label>
      </div>
      <div className="flex items-center justify-between gap-2">
        <ScoreBadge score={row.score} checks={row.checks} />
        <div className="flex items-center gap-1">
          <button type="button" onClick={onRemove} aria-label="Remove this thumbnail" className="pc-press flex size-7 items-center justify-center rounded-full text-ds-text-3 hover:text-ds-danger">
            <IconTrash className="size-4" />
          </button>
          <Button size="sm" variant={row.chosen ? "outline" : "default"} className="pc-press h-7" onClick={onChoose}>
            {row.chosen ? "Unchoose" : "Choose"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function PackagingLabDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const videoId = useEditor((state) => state.videoId);
  const composition = useEditor((state) => state.composition);
  const assetUrls = useEditor((state) => state.assetUrls);
  const { data, loading, refetch } = usePackaging(videoId || null, open);
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async (args: Record<string, unknown>) => {
    if (!videoId) return;
    setBusy(true);
    try {
      await callAction("save-packaging" as never, { videoId, ...args } as never);
      await queryClient.invalidateQueries({ queryKey: ["action", "get-packaging"] });
      await refetch();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const addTitle = () => {
    const text = newTitle.trim();
    if (!text) return;
    setNewTitle("");
    void save({ addTitles: [{ text }] });
  };

  const download = async () => {
    if (!videoId) return;
    const toastId = toast.loading("Rendering the thumbnail…");
    try {
      const result = (await callAction("render-thumbnail" as never, { videoId } as never)) as { url: string };
      toast.success("Thumbnail ready", { id: toastId });
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(errorMessage(error), { id: toastId });
    }
  };

  const askCrew = () => {
    onOpenChange(false);
    void askEditorAgent(
      "Open the thumbnail & title lab for this video: suggest 5 title options with different angles and 4 thumbnail options (different moments, short headlines, varied styles) with save-packaging. Read get-packaging first and build on what's there.",
    );
  };

  const history = data?.history;
  const scored = (history?.measured ?? 0) >= 5;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Thumbnail & title lab"
      description={
        data?.note ??
        (scored
          ? `Scored against your ${history?.measured} published videos with click-through data. Higher is better; hover a score for why.`
          : `Scores start once 5 of your published videos have YouTube click-through data (${history?.measured ?? 0} so far). Until then, each option gets plain checks.`)
      }
      className="w-[min(960px,calc(100vw-32px))]"
      footer={
        <>
          <Button variant="ghost" onClick={askCrew}>
            <IconSparkles className="size-4" /> Ask the crew for ideas
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </>
      }
    >
      {!data || !composition ? (
        loading ? <SkeletonLines count={6} /> : <p className="text-sm text-ds-text-2">Nothing to show yet.</p>
      ) : (
        <div className="flex max-h-[65vh] flex-col gap-6 overflow-y-auto pr-1">
          <section className="flex flex-col gap-2">
            <h3 className="pc-display text-[15px] text-ds-text">Titles</h3>
            {data.titles.length === 0 ? <p className="text-xs text-ds-text-3">No title options yet. Write one below, or ask the crew for ideas.</p> : null}
            <ul className="flex flex-col gap-1.5">
              {data.titles.map((title) => (
                <li key={title.id} className={cn("flex flex-wrap items-center gap-2 rounded-ds-sm bg-ds-surface-2 px-2.5 py-2 shadow-[inset_0_0_0_1px_var(--ds-hairline)]", title.chosen && "shadow-[inset_0_0_0_2px_var(--ds-accent)]")}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={title.chosen}
                    aria-label={`Use “${title.text}”`}
                    disabled={busy}
                    onClick={() => void save({ chooseTitle: title.chosen ? null : title.id })}
                    className={cn("pc-press flex size-5 shrink-0 items-center justify-center rounded-full shadow-[inset_0_0_0_1.5px_var(--ds-hairline)]", title.chosen && "bg-ds-accent text-ds-on-accent shadow-none")}
                  >
                    {title.chosen ? <IconCheck className="size-3.5" /> : null}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-ds-text">{title.text}</p>
                    {title.why ? <p className="text-[11px] text-ds-text-3">{title.why}</p> : null}
                  </div>
                  <ScoreBadge score={title.score} checks={title.checks} />
                  <button type="button" onClick={() => void save({ remove: [title.id] })} disabled={busy} aria-label={`Remove “${title.text}”`} className="pc-press flex size-7 items-center justify-center rounded-full text-ds-text-3 hover:text-ds-danger">
                    <IconTrash className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                addTitle();
              }}
            >
              <input
                value={newTitle}
                maxLength={100}
                placeholder="Write a title option"
                aria-label="New title option"
                onChange={(event) => setNewTitle(event.target.value)}
                onKeyDown={(event) => event.stopPropagation()}
                className={cn(INPUT, "flex-1")}
              />
              <Button type="submit" size="sm" variant="outline" className="pc-press" disabled={busy || !newTitle.trim()}>
                <IconPlus className="size-4" /> Add
              </Button>
            </form>
          </section>

          <section className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="pc-display text-[15px] text-ds-text">Thumbnails</h3>
              <div className="flex gap-2">
                {data.chosenThumbnailId ? (
                  <Button size="sm" variant="ghost" onClick={() => void download()}>
                    <IconDownload className="size-4" /> Download chosen
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  className="pc-press"
                  disabled={busy}
                  onClick={() => {
                    const chosenTitle = data.titles.find((title) => title.chosen)?.text ?? "";
                    const words = chosenTitle.split(/\s+/).filter(Boolean);
                    void save({ addThumbnails: [{ atMs: useEditor.getState().playheadMs, headline: words.length <= 5 ? chosenTitle.slice(0, 60) : "", style: "bold", position: "bottom", logo: true }] });
                  }}
                >
                  <IconPlus className="size-4" /> From the playhead
                </Button>
              </div>
            </div>
            {data.thumbnails.length === 0 ? <p className="text-xs text-ds-text-3">No thumbnails yet. Move the playhead to a strong moment and add one.</p> : null}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.thumbnails.map((row) => (
                <ThumbCard
                  key={row.id}
                  row={row}
                  composition={composition}
                  assetUrls={assetUrls}
                  onChange={(patch) => void save({ updateThumbnail: { id: row.id, ...patch } })}
                  onChoose={() => void save({ chooseThumbnail: row.chosen ? null : row.id })}
                  onRemove={() => void save({ remove: [row.id] })}
                />
              ))}
            </div>
            <p className="text-[11px] text-ds-text-3">The chosen thumbnail is uploaded when you publish to YouTube (Shorts use a frame you pick in the YouTube app).</p>
          </section>
        </div>
      )}
    </Dialog>
  );
}
