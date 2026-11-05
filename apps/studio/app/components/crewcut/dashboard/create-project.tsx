import { ASPECT_RATIOS, ASPECT_RATIO_INFO, type AspectRatio, FRAME_SIZE } from "@crewcut/composition";
import { IconLoader2 } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { BottomSheet, Button, Dialog } from "@/components/ds";
import { cn } from "@/lib/utils";

import { useCreateBlankProject } from "./use-videos";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/** A tile whose inner rectangle has the real proportions of the format. */
function RatioTile({ ratio, selected, onSelect }: { ratio: AspectRatio; selected: boolean; onSelect: () => void }) {
  const { width, height } = FRAME_SIZE[ratio];
  const scale = 30 / Math.max(width, height);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "pc-press flex min-w-0 flex-col items-center gap-1.5 rounded-ds-md px-1.5 pb-2 pt-3 text-center outline-none focus-visible:ring-2 focus-visible:ring-ds-accent",
        selected ? "bg-ds-accent-soft shadow-[inset_0_0_0_1.5px_var(--ds-accent)]" : "bg-ds-surface-2 shadow-[inset_0_0_0_1px_var(--ds-hairline)] hover:bg-ds-surface-3",
      )}
    >
      <span className="flex h-9 items-center justify-center" aria-hidden>
        <span className={cn("block rounded-[3px] border-[1.5px]", selected ? "border-ds-accent bg-ds-accent/15" : "border-ds-text-3")} style={{ width: width * scale, height: height * scale }} />
      </span>
      <span className={cn("font-mono text-xs font-semibold tabular", selected ? "text-ds-accent" : "text-ds-text")}>{ASPECT_RATIO_INFO[ratio].label}</span>
      <span className="line-clamp-2 text-[10px] leading-tight text-ds-text-3">{ASPECT_RATIO_INFO[ratio].use}</span>
    </button>
  );
}

export function CreateProjectForm({ onDone, autoFocus = true }: { onDone?: () => void; autoFocus?: boolean }) {
  const [title, setTitle] = useState("");
  const [ratio, setRatio] = useState<AspectRatio>("16:9");
  const { create, pending } = useCreateBlankProject();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (await create({ title, ratio })) onDone?.();
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="ds-label text-ds-text-2">Project name</span>
        <input
          autoFocus={autoFocus}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          maxLength={120}
          placeholder="Untitled project"
          className="h-10 rounded-ds-sm bg-ds-surface-2 px-3 text-sm text-ds-text shadow-[inset_0_0_0_1px_var(--ds-hairline)] outline-none placeholder:text-ds-text-3 focus:shadow-[inset_0_0_0_1.5px_var(--ds-accent)]"
        />
      </label>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="ds-label mb-1.5 text-ds-text-2">Format</legend>
        <div role="radiogroup" aria-label="Aspect ratio" className="grid grid-cols-4 gap-2">
          {ASPECT_RATIOS.map((option) => (
            <RatioTile key={option} ratio={option} selected={ratio === option} onSelect={() => setRatio(option)} />
          ))}
        </div>
        <p className="ds-caption mt-1 text-ds-text-3">You can change the format later in the editor; layouts reflow because positions are stored in percent.</p>
      </fieldset>
      <Button type="submit" disabled={pending} className="pc-press h-10">
        {pending ? <IconLoader2 className="size-4 motion-safe:animate-spin" /> : null}
        {pending ? "Creating…" : "Create and open editor"}
      </Button>
    </form>
  );
}

/** Dialog on larger screens, bottom sheet on phones. */
export function CreateProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const phone = useMediaQuery("(max-width: 639px)");
  if (phone) {
    return (
      <BottomSheet open={open} onOpenChange={onOpenChange} title="New blank project">
        <CreateProjectForm onDone={() => onOpenChange(false)} autoFocus={false} />
      </BottomSheet>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New blank project" description="Start from an empty timeline and edit by hand. The agents stay one click away.">
      <CreateProjectForm onDone={() => onOpenChange(false)} />
    </Dialog>
  );
}
