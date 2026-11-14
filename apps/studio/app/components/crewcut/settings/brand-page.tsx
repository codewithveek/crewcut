import { appPath } from "@agent-native/core/client/api-path";
import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { BRAND_LOGO_PLACEMENTS, type BrandKit, FONT_FAMILIES, MONO_FAMILIES } from "@crewcut/composition";
import { loadCrewcutFonts } from "@crewcut/renderer";
import { IconPhotoPlus, IconTrash, IconX } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button, Panel, Segmented, Select, SkeletonLines, Slider, Switch } from "@/components/ds";
import { errorMessage } from "@/lib/crewcut";
import { cn } from "@/lib/utils";

/**
 * Settings → Brand kit: the workspace's colours, fonts and logo. New template
 * videos and the crew's drafts can use them on their own; any video can be
 * restyled with them from the editor (More → Apply brand kit).
 */

type Role = keyof BrandKit["colors"];
type Placement = (typeof BRAND_LOGO_PLACEMENTS)[number];

interface BrandData {
  kit: BrandKit;
  empty: boolean;
  logo: { url: string; label: string } | null;
  shared: boolean;
}

interface LibraryImage {
  id: string;
  label: string;
  url: string;
}

const COLOR_ROWS: ReadonlyArray<{ role: Role; label: string; hint: string }> = [
  { role: "background", label: "Background", hint: "Behind everything" },
  { role: "surface", label: "Surface", hint: "Cards and panels" },
  { role: "ink", label: "Text", hint: "Headlines and body" },
  { role: "muted", label: "Secondary text", hint: "Labels and captions" },
  { role: "accent", label: "Accent", hint: "Highlights and shapes" },
  { role: "accent2", label: "Second accent", hint: "Optional" },
];

const PLACEMENT_LABELS: Record<Placement, string> = { "top-left": "Top left", "top-right": "Top right", "bottom-left": "Bottom left", "bottom-right": "Bottom right" };
/** Radix Select can't hold an empty value: "none" stands for "not set". */
const NO_FONT = "none";
const FONT_OPTIONS = [{ value: NO_FONT, label: "Not set (each video picks)" }, ...FONT_FAMILIES.filter((family) => !MONO_FAMILIES.has(family)).map((family) => ({ value: family, label: family }))];
const HEX = /^#[0-9a-f]{6}$/i;
const INPUT = "h-8 w-24 rounded-ds-xs bg-ds-surface-2 px-2 font-mono text-xs text-ds-text shadow-[inset_0_0_0_1px_var(--ds-hairline)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--ds-accent)]";

function ColorRow({ label, hint, value, onChange }: { label: string; hint: string; value: string | undefined; onChange: (value: string | undefined) => void }) {
  const [text, setText] = useState(value ?? "");
  useEffect(() => setText(value ?? ""), [value]);
  const id = `brand-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="flex items-center gap-3">
      <input
        id={id}
        type="color"
        value={value ?? "#000000"}
        onChange={(event) => onChange(event.target.value.toLowerCase())}
        aria-label={`${label} colour`}
        className={cn("size-8 shrink-0 cursor-pointer rounded-ds-xs border-0 bg-transparent p-0", !value && "opacity-40")}
      />
      <label htmlFor={id} className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-ds-text">{label}</span>
        <span className="block text-[11px] text-ds-text-3">{value ? hint : `${hint} · not set`}</span>
      </label>
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          const next = text.trim().toLowerCase();
          const withHash = next && !next.startsWith("#") ? `#${next}` : next;
          if (!withHash) onChange(undefined);
          else if (HEX.test(withHash)) onChange(withHash);
          else setText(value ?? "");
        }}
        placeholder="#rrggbb"
        aria-label={`${label} hex code`}
        spellCheck={false}
        className={INPUT}
      />
      <button
        type="button"
        onClick={() => onChange(undefined)}
        disabled={!value}
        aria-label={`Clear ${label}`}
        className="pc-press flex size-7 shrink-0 items-center justify-center rounded-full text-ds-text-3 hover:text-ds-text disabled:opacity-0"
      >
        <IconX className="size-4" />
      </button>
    </div>
  );
}

function Preview({ kit, logoUrl }: { kit: BrandKit; logoUrl: string | null }) {
  const c = kit.colors;
  const corner = kit.logo?.placement ?? "top-right";
  return (
    <div
      className="relative aspect-video w-full overflow-hidden rounded-ds-md shadow-[0_0_0_1px_var(--ds-hairline)]"
      style={{ background: c.background ?? "#111114" }}
      aria-label="Preview of the brand colours and fonts"
      role="img"
    >
      <div className="absolute inset-[8%] flex flex-col justify-center gap-[4%] rounded-[6%] p-[6%]" style={{ background: c.surface ?? "#1d1d22" }}>
        <p className="text-[clamp(14px,4.4cqw,30px)] leading-tight" style={{ color: c.ink ?? "#f5f3ee", fontFamily: `"${kit.fonts.display ?? "Inter"}", system-ui`, fontWeight: 700 }}>
          Your <span style={{ color: c.accent ?? "#ff5b2e" }}>headline</span> here
        </p>
        <p className="text-[clamp(10px,2.2cqw,16px)]" style={{ color: c.muted ?? "#a3a3ad", fontFamily: `"${kit.fonts.body ?? "Inter"}", system-ui` }}>
          Body text and labels in your second colour.
        </p>
        <div className="flex gap-[3%]">
          <span className="h-[clamp(6px,1.2cqw,10px)] w-[22%] rounded-full" style={{ background: c.accent ?? "#ff5b2e" }} />
          <span className="h-[clamp(6px,1.2cqw,10px)] w-[12%] rounded-full" style={{ background: c.accent2 ?? c.muted ?? "#a3a3ad" }} />
        </div>
      </div>
      {logoUrl && kit.logo ? (
        <img
          src={logoUrl}
          alt=""
          className={cn("absolute object-contain", corner.startsWith("top") ? "top-[4.5%]" : "bottom-[4.5%]", corner.endsWith("left") ? "left-[3%]" : "right-[3%]")}
          // Logo height is a share of the frame's short side: here, the preview's height.
          style={{ height: `${kit.logo.sizePct}%`, maxWidth: "40%", opacity: kit.logo.opacity }}
        />
      ) : null}
    </div>
  );
}

function LogoPicker({ onPick, onClose }: { onPick: (image: LibraryImage) => void; onClose: () => void }) {
  const query = useActionQuery("list-assets", { scope: "library", mediaType: "image", limit: 60 } as never);
  const images = ((query.data as { assets?: LibraryImage[] } | undefined)?.assets ?? []).slice(0, 60);
  return (
    <div className="mt-3 rounded-ds-sm bg-ds-surface-2 p-3 shadow-[inset_0_0_0_1px_var(--ds-hairline)]">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium text-ds-text-2">Pictures in your library</p>
        <button type="button" onClick={onClose} aria-label="Close" className="pc-press flex size-7 items-center justify-center rounded-full text-ds-text-3 hover:text-ds-text">
          <IconX className="size-4" />
        </button>
      </div>
      {query.isLoading ? (
        <SkeletonLines count={2} />
      ) : images.length === 0 ? (
        <p className="text-xs text-ds-text-3">No pictures in your library yet. Upload your logo instead.</p>
      ) : (
        <div className="grid max-h-64 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
          {images.map((image) => (
            <button
              key={image.id}
              type="button"
              onClick={() => onPick(image)}
              title={image.label}
              aria-label={`Use ${image.label} as the logo`}
              className="pc-press ds-checker aspect-square overflow-hidden rounded-ds-xs shadow-[inset_0_0_0_1px_var(--ds-hairline)] outline-none hover:shadow-[inset_0_0_0_1.5px_var(--ds-accent)] focus-visible:ring-2 focus-visible:ring-ds-accent"
            >
              <img src={image.url} alt="" loading="lazy" className="size-full object-contain" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function BrandPage() {
  const queryClient = useQueryClient();
  const query = useActionQuery("get-brand-kit", {} as never);
  const data = query.data as BrandData | undefined;
  const [draft, setDraft] = useState<BrandKit | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => void loadCrewcutFonts().catch(() => undefined), []);
  useEffect(() => {
    if (!data) return;
    setDraft(structuredClone(data.kit));
    setLogoUrl(data.logo?.url ?? null);
  }, [data]);

  const dirty = useMemo(() => Boolean(data && draft && JSON.stringify(draft) !== JSON.stringify(data.kit)), [data, draft]);
  const update = (patch: (kit: BrandKit) => BrandKit) => setDraft((current) => (current ? patch(structuredClone(current)) : current));

  const pickLogo = (image: LibraryImage) => {
    update((kit) => ({ ...kit, logo: { assetId: image.id, aspect: kit.logo?.aspect ?? 1, placement: kit.logo?.placement ?? "top-right", sizePct: kit.logo?.sizePct ?? 10, opacity: kit.logo?.opacity ?? 0.9 } }));
    setLogoUrl(image.url);
    setPicking(false);
  };

  const upload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("A logo must be a picture: PNG (ideally with a transparent background), JPEG, WebP or GIF.");
      return;
    }
    setUploading(true);
    try {
      const params = new URLSearchParams({ label: file.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 120) || "Logo" });
      const response = await fetch(appPath(`/api/assets?${params.toString()}`), { method: "POST", body: file, credentials: "include" });
      const body = (await response.json().catch(() => null)) as { assetId?: string; url?: string; label?: string; error?: { message?: string } } | null;
      if (!response.ok || !body?.assetId) throw new Error(body?.error?.message ?? `Upload failed (${response.status})`);
      pickLogo({ id: body.assetId, label: body.label ?? file.name, url: body.url ?? "" });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!draft || !data) return;
    setSaving(true);
    try {
      const colors = Object.fromEntries(COLOR_ROWS.map(({ role }) => [role, draft.colors[role] ?? null]));
      const fonts = { display: draft.fonts.display ?? null, body: draft.fonts.body ?? null };
      const logo = draft.logo ? { assetId: draft.logo.assetId, placement: draft.logo.placement, sizePct: draft.logo.sizePct, opacity: draft.logo.opacity } : null;
      await callAction("set-brand-kit" as never, { colors, fonts, logo, autoApply: draft.autoApply } as never);
      await queryClient.invalidateQueries({ queryKey: ["action", "get-brand-kit"] });
      toast.success("Brand kit saved");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-5 px-4 pb-10 pt-5 sm:px-8 sm:pt-9">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="ds-title text-ds-text sm:text-2xl">Brand kit</h1>
          <p className="text-[13px] text-ds-text-2">
            Your colours, fonts and logo. {data?.shared ? "Everyone in this workspace uses the same kit." : "Used for your videos."} In the editor, More → Apply brand kit restyles any video.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={!dirty || saving}
            onClick={() => {
              if (!data) return;
              setDraft(structuredClone(data.kit));
              setLogoUrl(data.logo?.url ?? null);
            }}
          >
            Discard
          </Button>
          <Button size="sm" className="pc-press" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </header>

      {!draft ? (
        <SkeletonLines count={6} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <div className="flex min-w-0 flex-col gap-5">
            <Panel title="Colours" description="Any colour you leave out stays as each video or template designs it.">
              <div className="flex flex-col gap-3">
                {COLOR_ROWS.map((row) => (
                  <ColorRow key={row.role} label={row.label} hint={row.hint} value={draft.colors[row.role]} onChange={(value) => update((kit) => ({ ...kit, colors: { ...kit.colors, [row.role]: value } }))} />
                ))}
              </div>
            </Panel>

            <Panel title="Fonts">
              <div className="grid gap-3 sm:grid-cols-2">
                {(["display", "body"] as const).map((role) => (
                  <label key={role} className="flex min-w-0 flex-col gap-1.5">
                    <span className="text-xs text-ds-text-2">{role === "display" ? "Headlines" : "Body text"}</span>
                    <Select
                      label={role === "display" ? "Headline font" : "Body font"}
                      className="h-9 w-full"
                      value={draft.fonts[role] ?? NO_FONT}
                      onChange={(value) => update((kit) => ({ ...kit, fonts: { ...kit.fonts, [role]: value === NO_FONT ? undefined : value } }))}
                      options={FONT_OPTIONS}
                    />
                  </label>
                ))}
              </div>
            </Panel>

            <Panel
              title="Logo"
              description="Shown in a corner of the video, until the ending. A PNG with a transparent background looks best."
              actions={
                draft.logo ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      update((kit) => ({ ...kit, logo: undefined, autoApply: { ...kit.autoApply, logo: false } }));
                      setLogoUrl(null);
                    }}
                  >
                    <IconTrash className="size-4" /> Remove
                  </Button>
                ) : null
              }
            >
              <div className="flex flex-wrap items-center gap-3">
                <div className="ds-checker flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-ds-sm shadow-[inset_0_0_0_1px_var(--ds-hairline)]">
                  {draft.logo && logoUrl ? <img src={logoUrl} alt="Your logo" className="max-h-full max-w-full object-contain" /> : <IconPhotoPlus className="size-6 text-ds-text-3" />}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="pc-press" disabled={uploading} onClick={() => fileInput.current?.click()}>
                    {uploading ? "Uploading…" : "Upload logo"}
                  </Button>
                  <Button variant="outline" size="sm" className="pc-press" onClick={() => setPicking((open) => !open)}>
                    From your library
                  </Button>
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void upload(file);
                  }}
                />
              </div>
              {picking ? <LogoPicker onPick={pickLogo} onClose={() => setPicking(false)} /> : null}
              {draft.logo ? (
                <div className="mt-4 flex flex-col gap-3">
                  <Segmented
                    ariaLabel="Logo position"
                    size="sm"
                    className="w-full sm:w-auto"
                    value={draft.logo.placement}
                    onChange={(placement) => update((kit) => (kit.logo ? { ...kit, logo: { ...kit.logo, placement } } : kit))}
                    options={BRAND_LOGO_PLACEMENTS.map((placement) => ({ value: placement, label: PLACEMENT_LABELS[placement] }))}
                  />
                  <div className="grid grid-cols-[6rem_minmax(0,1fr)_3rem] items-center gap-3 text-xs text-ds-text-2">
                    <span>Size</span>
                    <Slider label="Logo size" value={draft.logo.sizePct} min={4} max={30} step={1} onChange={(sizePct) => update((kit) => (kit.logo ? { ...kit, logo: { ...kit.logo, sizePct } } : kit))} />
                    <span className="text-right tabular-nums">{draft.logo.sizePct}%</span>
                    <span>Opacity</span>
                    <Slider label="Logo opacity" value={Math.round(draft.logo.opacity * 100)} min={20} max={100} step={5} onChange={(value) => update((kit) => (kit.logo ? { ...kit, logo: { ...kit.logo, opacity: value / 100 } } : kit))} />
                    <span className="text-right tabular-nums">{Math.round(draft.logo.opacity * 100)}%</span>
                  </div>
                </div>
              ) : null}
            </Panel>

            <Panel title="Use it on its own" description="Applies to new videos only. Restyle an existing one from the editor.">
              <div className="flex flex-col gap-3">
                {(
                  [
                    ["templates", "New videos from templates", "Colours and fonts"],
                    ["drafts", "The crew's drafts", "Colours and fonts, when the crew composes a video"],
                    ["logo", "Add the logo too", "On those new videos"],
                  ] as const
                ).map(([key, label, hint]) => (
                  <div key={key} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-ds-text">{label}</p>
                      <p className="text-[11px] text-ds-text-3">{hint}</p>
                    </div>
                    <Switch
                      label={label}
                      checked={draft.autoApply[key]}
                      disabled={key === "logo" && !draft.logo}
                      onCheckedChange={(checked) => update((kit) => ({ ...kit, autoApply: { ...kit.autoApply, [key]: checked } }))}
                    />
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <div className="lg:sticky lg:top-6 lg:self-start">
            <p className="mb-2 text-xs font-medium text-ds-text-2">Preview</p>
            <div style={{ containerType: "inline-size" }}>
              <Preview kit={draft} logoUrl={logoUrl} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
