import { appPath } from "@agent-native/core/client/api-path";
import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { TEMPLATE_CATEGORY_LABELS, type TemplateCategory } from "@crewcut/composition";
import { IconArchive, IconDiamond, IconDots, IconExternalLink, IconHistory, IconPlayerPause, IconPlayerPlay, IconPlus, IconUpload } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { PrivacyRequestsSection } from "./privacy-requests";
import { Button, Dialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, EmptyState, IconButton, Segmented, Select } from "@/components/ds";
import { errorMessage, formatAgo } from "@/lib/crewcut";
import { cn } from "@/lib/utils";

import { AiCostsSection } from "../billing/ai-costs-admin";
import { probeDuration } from "../editor/media";
import { formatDuration } from "../dashboard/use-videos";
import { useCatalogAccess } from "./use-catalog-access";

/**
 * The catalog admin area: packs (Free or Pro), the templates, music and
 * sounds in them, and which workspaces have Pro. Every button calls the same
 * actions an admin's agent can use; publishing, rolling back and plans are
 * people-only.
 */

type Kind = "template" | "music" | "sound";
type Tab = Kind | "packs" | "workspaces" | "costs" | "requests";

interface Summary {
  type: "builtin" | "data" | "audio";
  templateId?: string;
  ratios?: string[];
  slots?: number;
  durationMs?: number | null;
  url?: string;
  bpm?: number | null;
  mood?: string;
  licence?: { name?: string; credit?: string };
}

interface CatalogItem {
  id: string;
  kind: Kind;
  name: string;
  description: string;
  category: string;
  packId: string | null;
  status: "draft" | "published" | "archived";
  currentVersion: number;
  current: Summary | null;
  draft: Summary | null;
  versions: Array<{ version: number; publishedAt: string; publishedBy: string }>;
  updatedAt: string;
}

interface Pack {
  id: string;
  name: string;
  description: string;
  tier: "free" | "pro";
  status: "draft" | "published";
  items: number;
}

interface Plan {
  workspace: string;
  plan: string;
  note: string;
  updatedBy: string;
  updatedAt: string;
}

interface Catalog {
  packs: Pack[];
  items: CatalogItem[];
  plans: Plan[];
}

const TABS: ReadonlyArray<{ value: Tab; label: string }> = [
  { value: "template", label: "Templates" },
  { value: "music", label: "Music" },
  { value: "sound", label: "Sounds" },
  { value: "packs", label: "Packs" },
  { value: "workspaces", label: "Workspaces" },
  { value: "costs", label: "AI costs" },
  { value: "requests", label: "Data requests" },
];

async function act(name: string, args: Record<string, unknown>, success?: string): Promise<boolean> {
  try {
    await callAction(name as never, args as never);
    if (success) toast.success(success);
    return true;
  } catch (error) {
    toast.error(errorMessage(error));
    return false;
  }
}

export function AdminPage() {
  const access = useCatalogAccess();
  const [tab, setTab] = useState<Tab>("template");
  const query = useActionQuery("list-catalog", {} as never, { enabled: Boolean(access?.admin) } as never);
  const catalog = query.data as Catalog | undefined;
  const refresh = () => void query.refetch();

  if (access && !access.admin) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 pt-10 sm:px-8">
        <EmptyState title="This area is for Crewcut admins">Ask an admin if you need a template, track or sound added to the catalog.</EmptyState>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-5 px-4 pb-10 pt-5 sm:px-8 sm:pt-9">
      <header className="flex flex-col gap-1">
        <h1 className="ds-title text-ds-text sm:text-2xl">Catalog</h1>
        <p className="text-[13px] text-ds-text-2">Templates, music and sounds everyone can use, grouped in Free and Pro packs. Changes stay unpublished until you publish them; videos already made never change.</p>
      </header>
      <div className="ds-no-scrollbar -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <Segmented ariaLabel="Section" value={tab} onChange={setTab} options={TABS} />
      </div>
      {tab === "requests" ? (
        <PrivacyRequestsSection />
      ) : tab === "costs" ? (
        <AiCostsSection />
      ) : !catalog ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="pc-skeleton h-16 rounded-ds-md" />
          ))}
        </div>
      ) : tab === "packs" ? (
        <PacksSection packs={catalog.packs} onChange={refresh} />
      ) : tab === "workspaces" ? (
        <WorkspacesSection plans={catalog.plans} ownWorkspace={access?.workspace ?? ""} onChange={refresh} />
      ) : (
        <ItemsSection kind={tab} items={catalog.items.filter((item) => item.kind === tab)} packs={catalog.packs} onChange={refresh} />
      )}
    </div>
  );
}

// ── Items ───────────────────────────────────────────────────────────────────

function StatusBadge({ item }: { item: CatalogItem }) {
  const waiting = item.draft !== null;
  const [label, tone] =
    item.status === "archived"
      ? ["Archived", "bg-ds-surface-3 text-ds-text-3"]
      : item.status === "published"
        ? [waiting ? `Live v${item.currentVersion} · changes waiting` : `Live v${item.currentVersion}`, waiting ? "bg-[#fff3d6] text-[#7a5200] dark:bg-[#3a2c0a] dark:text-[#f5d27a]" : "bg-[#dcf5e6] text-[#145c33] dark:bg-[#0f3320] dark:text-[#8fe0b0]"]
        : [item.currentVersion > 0 ? "Hidden" : "Not published yet", "bg-ds-surface-2 text-ds-text-2"];
  return <span className={cn("inline-flex h-6 items-center rounded-full px-2 text-[11px] font-medium", tone)}>{label}</span>;
}

let playing: HTMLAudioElement | null = null;

function PlayButton({ url, label }: { url: string; label: string }) {
  const [on, setOn] = useState(false);
  useEffect(() => () => (on ? playing?.pause() : undefined), [on]);
  return (
    <IconButton
      label={on ? `Pause ${label}` : `Play ${label}`}
      variant="soft"
      onClick={() => {
        if (on) {
          playing?.pause();
          setOn(false);
          return;
        }
        playing?.pause();
        playing = new Audio(url);
        playing.onended = () => setOn(false);
        void playing.play().catch(() => setOn(false));
        setOn(true);
      }}
    >
      {on ? <IconPlayerPause /> : <IconPlayerPlay />}
    </IconButton>
  );
}

function ItemRow({ item, packs, onChange }: { item: CatalogItem; packs: Pack[]; onChange: () => void }) {
  const shown = item.draft ?? item.current;
  const [name, setName] = useState(item.name);
  useEffect(() => setName(item.name), [item.name]);
  const pack = packs.find((entry) => entry.id === item.packId);
  const commitName = async () => {
    const next = name.trim();
    if (!next || next === item.name) return setName(item.name);
    if (await act("update-catalog-item", { itemId: item.id, name: next })) onChange();
  };
  const detail =
    shown?.type === "audio"
      ? [formatDuration(shown.durationMs ?? 0), shown.bpm ? `${shown.bpm} BPM` : null, shown.mood || null, shown.licence?.name ? `Licence: ${shown.licence.name}` : null].filter(Boolean).join(" · ")
      : shown?.type === "data"
        ? `${shown.ratios?.join(" · ")} · ${shown.slots} things to change · ${formatDuration(shown.durationMs ?? 0)}`
        : shown?.type === "builtin"
          ? `Designed in code (${shown.templateId}) · ${TEMPLATE_CATEGORY_LABELS[item.category as TemplateCategory] ?? item.category}`
          : "";
  return (
    <li className={cn("flex flex-col gap-2 rounded-ds-md bg-ds-surface p-3 shadow-[inset_0_0_0_1px_var(--ds-hairline)] sm:flex-row sm:items-center", item.status === "archived" && "opacity-60")}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {shown?.type === "audio" && shown.url ? <PlayButton url={shown.url} label={item.name} /> : null}
        <div className="min-w-0 flex-1">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => void commitName()}
            onKeyDown={(event) => event.key === "Enter" && (event.target as HTMLInputElement).blur()}
            aria-label="Name"
            maxLength={80}
            className="w-full truncate rounded-[6px] bg-transparent px-1 py-0.5 text-[14px] font-semibold text-ds-text outline-none hover:bg-ds-surface-2 focus:bg-ds-surface-2 focus:shadow-[inset_0_0_0_1.5px_var(--ds-accent)]"
          />
          <p className="truncate px-1 text-[12px] text-ds-text-3">{detail}</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <StatusBadge item={item} />
        {pack?.tier === "pro" ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#6b55c9] dark:text-[#d8ccff]">
            <IconDiamond className="size-3" aria-hidden /> Pro
          </span>
        ) : null}
        <Select label="Pack" size="sm" className="w-40" value={item.packId ?? ""} onChange={async (packId) => (await act("update-catalog-item", { itemId: item.id, packId })) && onChange()} options={packs.map((entry) => ({ value: entry.id, label: `${entry.name}${entry.tier === "pro" ? " · Pro" : ""}` }))} />
        {item.status !== "archived" && (item.draft || item.status !== "published") ? (
          <Button size="sm" className="pc-press" onClick={async () => (await act("set-catalog-item-status", { itemId: item.id, status: "published" }, item.draft ? "Published" : "Shown again")) && onChange()}>
            {item.draft ? "Publish" : "Show"}
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="More" variant="ghost">
              <IconDots />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {item.kind === "template" && item.status === "published" ? (
              <DropdownMenuItem icon={<IconExternalLink />} onSelect={() => window.open(`/templates?template=${shown?.type === "builtin" ? shown.templateId : item.id}`, "_blank")}>
                Open in the gallery
              </DropdownMenuItem>
            ) : null}
            {item.kind !== "template" ? (
              <DropdownMenuItem
                icon={<IconHistory />}
                onSelect={async () => {
                  const value = window.prompt("Beats per minute (empty to clear)", shown?.type === "audio" && shown.bpm ? String(shown.bpm) : "");
                  if (value === null) return;
                  const bpm = value.trim() ? Number(value) : null;
                  if (bpm !== null && !(bpm > 0 && bpm <= 300)) return void toast.error("BPM must be between 1 and 300.");
                  if (await act("update-catalog-item", { itemId: item.id, bpm }, "Saved as unpublished changes")) onChange();
                }}
              >
                Set BPM…
              </DropdownMenuItem>
            ) : null}
            {item.status === "published" ? (
              <DropdownMenuItem onSelect={async () => (await act("set-catalog-item-status", { itemId: item.id, status: "draft" }, "Hidden from the galleries")) && onChange()}>Hide from galleries</DropdownMenuItem>
            ) : null}
            {item.status !== "archived" ? (
              <DropdownMenuItem icon={<IconArchive />} danger onSelect={async () => window.confirm(`Archive “${item.name}”? It leaves every gallery; videos made from it keep working.`) && (await act("set-catalog-item-status", { itemId: item.id, status: "archived" }, "Archived")) && onChange()}>
                Archive
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={async () => (await act("set-catalog-item-status", { itemId: item.id, status: "draft" }, "Restored (hidden until you show it)")) && onChange()}>Restore</DropdownMenuItem>
            )}
            {item.versions.length > 1 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Versions</DropdownMenuLabel>
                {item.versions.map((version) => (
                  <DropdownMenuItem key={version.version} disabled={version.version === item.currentVersion} onSelect={async () => (await act("restore-catalog-version", { itemId: item.id, version: version.version }, `Version ${version.version} is live`)) && onChange()}>
                    v{version.version} · {formatAgo(version.publishedAt)}
                    {version.version === item.currentVersion ? " · live" : ""}
                  </DropdownMenuItem>
                ))}
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

function ItemsSection({ kind, items, packs, onChange }: { kind: Kind; items: CatalogItem[]; packs: Pack[]; onChange: () => void }) {
  const [uploading, setUploading] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const live = items.filter((item) => item.status !== "archived");
  const archived = items.filter((item) => item.status === "archived");
  const noun = kind === "template" ? "templates" : kind === "music" ? "tracks" : "sounds";
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-[13px] text-ds-text-2">
          {kind === "template" ? (
            <>
              New templates come from the editor: open a video, then <span className="font-medium text-ds-text">More → Save as template → Crewcut catalog</span>.
            </>
          ) : (
            `${live.length} ${live.length === 1 ? noun.replace(/s$/, "") : noun}. Upload a file to add one; it stays unpublished until you publish it.`
          )}
        </p>
        {kind !== "template" ? (
          <Button size="sm" className="pc-press" onClick={() => setUploading(true)} disabled={packs.length === 0}>
            <IconUpload className="size-4" /> Upload {kind === "music" ? "a track" : "a sound"}
          </Button>
        ) : null}
      </div>
      {live.length === 0 ? <EmptyState title={`No ${noun} yet`}>{kind === "template" ? "Publish one from the editor." : "Upload one to start."}</EmptyState> : null}
      <ul className="flex flex-col gap-2">
        {live.map((item) => (
          <ItemRow key={item.id} item={item} packs={packs} onChange={onChange} />
        ))}
      </ul>
      {archived.length ? (
        <div className="flex flex-col gap-2">
          <button type="button" className="self-start text-[12px] text-ds-text-2 hover:text-ds-text" onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? "Hide" : "Show"} {archived.length} archived
          </button>
          {showArchived ? (
            <ul className="flex flex-col gap-2">
              {archived.map((item) => (
                <ItemRow key={item.id} item={item} packs={packs} onChange={onChange} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {kind !== "template" ? <UploadDialog open={uploading} onOpenChange={setUploading} kind={kind} packs={packs} onDone={onChange} /> : null}
    </section>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] text-ds-text-2">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-ds-text-3">{hint}</span> : null}
    </label>
  );
}

const INPUT = "h-9 rounded-ds-sm bg-ds-surface-2 px-3 text-sm text-ds-text shadow-[inset_0_0_0_1px_var(--ds-hairline)] outline-none placeholder:text-ds-text-3 focus:shadow-[inset_0_0_0_1.5px_var(--ds-accent)]";

function UploadDialog({ open, onOpenChange, kind, packs, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; kind: "music" | "sound"; packs: Pack[]; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [packId, setPackId] = useState("");
  const [bpm, setBpm] = useState("");
  const [mood, setMood] = useState("");
  const [licence, setLicence] = useState("");
  const [licenceUrl, setLicenceUrl] = useState("");
  const [credit, setCredit] = useState("");
  const [aiGenerated, setAiGenerated] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    setFile(null);
    setName("");
    setBpm("");
    setMood("");
    setCredit("");
    setPackId((current) => current || packs.find((pack) => pack.id !== "pack_builtin")?.id || packs[0]?.id || "");
  }, [open, packs]);
  const ready = file && name.trim() && packId && licence.trim();
  const upload = async () => {
    if (!file || !ready) return;
    setBusy(true);
    try {
      const durationMs = await probeDuration(file);
      const params = new URLSearchParams({ kind, name: name.trim(), packId, licence: licence.trim(), aiGenerated: aiGenerated ? "1" : "0" });
      if (durationMs) params.set("durationMs", String(durationMs));
      if (bpm.trim()) params.set("bpm", bpm.trim());
      if (mood.trim()) params.set("mood", mood.trim());
      if (licenceUrl.trim()) params.set("licenceUrl", licenceUrl.trim());
      if (credit.trim()) params.set("credit", credit.trim());
      const response = await fetch(appPath(`/api/catalog/media?${params}`), { method: "POST", body: file, credentials: "include" });
      const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? `Upload failed (${response.status})`);
      toast.success("Uploaded. Publish it when you're ready.");
      onDone();
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={kind === "music" ? "Upload a track" : "Upload a sound"}
      description="Where it comes from and its licence are required: every video that uses it credits it in the Proof report."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void upload()} disabled={!ready || busy} className="pc-press">
            {busy ? "Uploading…" : "Upload"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <input ref={input} type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/ogg" className="hidden" onChange={(event) => {
          const chosen = event.target.files?.[0] ?? null;
          setFile(chosen);
          if (chosen && !name) setName(chosen.name.replace(/\.[^.]+$/, "").slice(0, 80));
          event.target.value = "";
        }} />
        <Button variant="outline" className="pc-press justify-start" onClick={() => input.current?.click()}>
          <IconUpload className="size-4" /> {file ? file.name : "Choose an MP3, WAV, M4A or OGG file"}
        </Button>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} className={INPUT} />
          </Field>
          <div className="flex flex-col gap-1">
            <span className="text-[12px] text-ds-text-2">Pack</span>
            <Select label="Pack" className="h-9 w-full" value={packId} onChange={setPackId} options={packs.map((pack) => ({ value: pack.id, label: `${pack.name} · ${pack.tier === "pro" ? "Pro" : "Free"}` }))} />
          </div>
          {kind === "music" ? (
            <Field label="BPM (optional)" hint="Lets people snap cuts to the beat.">
              <input value={bpm} inputMode="decimal" onChange={(event) => setBpm(event.target.value.replace(/[^\d.]/g, ""))} className={INPUT} placeholder="e.g. 120" />
            </Field>
          ) : null}
          <Field label="Mood (optional)">
            <input value={mood} maxLength={60} onChange={(event) => setMood(event.target.value)} className={INPUT} placeholder="e.g. upbeat, calm" />
          </Field>
        </div>
        <Field label="Licence">
          <input value={licence} maxLength={200} onChange={(event) => setLicence(event.target.value)} className={INPUT} placeholder="e.g. Licensed from Artlist for commercial use" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Licence link (optional)">
            <input value={licenceUrl} onChange={(event) => setLicenceUrl(event.target.value)} className={INPUT} placeholder="https://…" />
          </Field>
          <Field label="Credit (optional)">
            <input value={credit} maxLength={200} onChange={(event) => setCredit(event.target.value)} className={INPUT} placeholder="e.g. Music by Ana Silva" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-[13px] text-ds-text">
          <input type="checkbox" checked={aiGenerated} onChange={(event) => setAiGenerated(event.target.checked)} className="size-4 accent-[var(--ds-accent)]" />
          Made with AI
        </label>
      </div>
    </Dialog>
  );
}

// ── Packs ───────────────────────────────────────────────────────────────────

function PacksSection({ packs, onChange }: { packs: Pack[]; onChange: () => void }) {
  const [name, setName] = useState("");
  const [tier, setTier] = useState<"free" | "pro">("free");
  const create = async () => {
    if (!name.trim()) return;
    if (await act("save-catalog-pack", { name: name.trim(), tier }, "Pack created (unpublished)")) {
      setName("");
      onChange();
    }
  };
  return (
    <section className="flex flex-col gap-3">
      <p className="text-[13px] text-ds-text-2">A pack's items appear in the galleries once both the pack and the item are published. Pro items show a Pro badge: anyone can try them, and exporting needs Pro.</p>
      <ul className="flex flex-col gap-2">
        {packs.map((pack) => (
          <li key={pack.id} className="flex flex-col gap-2 rounded-ds-md bg-ds-surface p-3 shadow-[inset_0_0_0_1px_var(--ds-hairline)] sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold text-ds-text">{pack.name}</p>
              <p className="truncate text-[12px] text-ds-text-3">
                {pack.items} item{pack.items === 1 ? "" : "s"}
                {pack.description ? ` · ${pack.description}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Segmented size="sm" ariaLabel={`${pack.name} tier`} value={pack.tier} onChange={async (next) => (await act("save-catalog-pack", { packId: pack.id, tier: next }, next === "pro" ? "Now a Pro pack" : "Now a Free pack")) && onChange()} options={[{ value: "free", label: "Free" }, { value: "pro", label: "Pro" }]} />
              <Button size="sm" variant={pack.status === "published" ? "outline" : "default"} className="pc-press" onClick={async () => (await act("save-catalog-pack", { packId: pack.id, status: pack.status === "published" ? "draft" : "published" }, pack.status === "published" ? "Pack hidden" : "Pack published")) && onChange()}>
                {pack.status === "published" ? "Hide pack" : "Publish pack"}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2 rounded-ds-md bg-ds-surface-2 p-3 shadow-[inset_0_0_0_1px_var(--ds-hairline)] sm:flex-row sm:items-end">
        <Field label="New pack">
          <input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void create()} className={cn(INPUT, "bg-ds-surface sm:w-72")} placeholder="e.g. Holiday 2026" />
        </Field>
        <Segmented ariaLabel="New pack tier" value={tier} onChange={setTier} options={[{ value: "free", label: "Free" }, { value: "pro", label: "Pro" }]} />
        <Button className="pc-press" onClick={() => void create()} disabled={!name.trim()}>
          <IconPlus className="size-4" /> Create pack
        </Button>
      </div>
    </section>
  );
}

// ── Workspaces ──────────────────────────────────────────────────────────────

const PLAN_LABEL: Record<string, string> = { free: "Free", creator: "Creator", pro: "Creator", studio: "Studio" };

function WorkspacesSection({ plans, ownWorkspace, onChange }: { plans: Plan[]; ownWorkspace: string; onChange: () => void }) {
  const [workspace, setWorkspace] = useState("");
  const [note, setNote] = useState("");
  const [plan, setPlan] = useState("creator");
  const [credits, setCredits] = useState("");
  const set = async (target: string, next: string, extra?: string) => (await act("set-workspace-plan", { workspace: target, plan: next, ...(extra ? { note: extra } : {}) }, `Now on ${PLAN_LABEL[next] ?? next}`)) && onChange();
  const amount = Number(credits);
  const giveCredits = async () => (await act("adjust-credits", { workspace: workspace.trim(), credits: amount, note: note.trim() || "Given by an admin" }, amount > 0 ? `${amount} credits given` : `${-amount} credits taken`)) && (setCredits(""), onChange());
  return (
    <section className="flex flex-col gap-3">
      <p className="text-[13px] text-ds-text-2">
        Plans normally come from Bachs subscriptions; set one here for comps and fixes (a paid subscription's next update sets it again). Creator and Studio unlock Pro content, autopilot and more credits. A workspace is a team's id, or a person's email for their own. Yours is <code className="rounded bg-ds-surface-2 px-1 font-mono text-[12px]">{ownWorkspace}</code>.
      </p>
      <div className="flex flex-col gap-2 rounded-ds-md bg-ds-surface-2 p-3 shadow-[inset_0_0_0_1px_var(--ds-hairline)] sm:flex-row sm:flex-wrap sm:items-end">
        <Field label="Workspace or email">
          <input value={workspace} onChange={(event) => setWorkspace(event.target.value)} className={cn(INPUT, "bg-ds-surface sm:w-72")} placeholder="name@example.com" />
        </Field>
        <Field label="Note (optional)">
          <input value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} className={cn(INPUT, "bg-ds-surface sm:w-56")} placeholder="e.g. Hackathon judge" />
        </Field>
        <Field label="Plan">
          <Select label="Plan" size="sm" className="h-9 w-32" value={plan} onChange={setPlan} options={[{ value: "free", label: "Free" }, { value: "creator", label: "Creator" }, { value: "studio", label: "Studio" }]} />
        </Field>
        <Button className="pc-press" disabled={workspace.trim().length < 3} onClick={async () => (await set(workspace.trim(), plan, note.trim())) && setNote("")}>
          <IconDiamond className="size-4" /> Set plan
        </Button>
        <Field label="Credits (+ or −)">
          <input value={credits} inputMode="numeric" onChange={(event) => setCredits(event.target.value.replace(/[^0-9-]/g, ""))} className={cn(INPUT, "bg-ds-surface sm:w-28")} placeholder="e.g. 200" />
        </Field>
        <Button variant="outline" className="pc-press" disabled={workspace.trim().length < 3 || !Number.isInteger(amount) || amount === 0} onClick={() => void giveCredits()}>
          Give credits
        </Button>
      </div>
      {plans.length === 0 ? <p className="text-[13px] text-ds-text-3">Every workspace is on Free.</p> : null}
      <ul className="flex flex-col gap-2">
        {plans.map((entry) => (
          <li key={entry.workspace} className="flex items-center gap-3 rounded-ds-md bg-ds-surface p-3 shadow-[inset_0_0_0_1px_var(--ds-hairline)]">
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-[13px] text-ds-text">{entry.workspace.replace(/^user:/, "")}</p>
              <p className="truncate text-[12px] text-ds-text-3">
                {PLAN_LABEL[entry.plan] ?? entry.plan} · changed {formatAgo(entry.updatedAt)} by {entry.updatedBy}
                {entry.note ? ` · ${entry.note}` : ""}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setWorkspace(entry.workspace)}>
              Edit
            </Button>
            {entry.plan !== "free" ? (
              <Button size="sm" variant="outline" onClick={() => void set(entry.workspace, "free")}>
                Move to Free
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-ds-text-3">
        Admins are set with the CREWCUT_ADMIN_EMAILS setting on the server. <Link to="/templates" className="underline">See the gallery</Link>
      </p>
    </section>
  );
}
