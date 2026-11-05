import {
  IconAdjustments,
  IconArrowBackUp,
  IconCopy,
  IconCut,
  IconDots,
  IconLayersSubtract,
  IconMagnet,
  IconPlayerPlayFilled,
  IconScissors,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";

import {
  BottomSheet,
  Button,
  Checkbox,
  ColorField,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  FieldRow,
  IconButton,
  Kbd,
  NumberBox,
  ScrubField,
  Section,
  Segmented,
  Select,
  SliderField,
  StatusPill,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TextField,
  VerdictBadge,
} from "@/components/ds";
import { useThemeToggle } from "@/components/layout/nav-items";
import { cn } from "@/lib/utils";

const COLOR_GROUPS: Array<{ title: string; tokens: Array<{ name: string; note: string }> }> = [
  {
    title: "Surfaces",
    tokens: [
      { name: "--ds-bg", note: "App background" },
      { name: "--ds-surface", note: "Panels, cards" },
      { name: "--ds-surface-2", note: "Inputs, wells" },
      { name: "--ds-surface-3", note: "Hover, active" },
      { name: "--ds-sunken", note: "Timeline lanes" },
      { name: "--ds-stage", note: "Behind the video" },
    ],
  },
  {
    title: "Text and lines",
    tokens: [
      { name: "--ds-text", note: "Primary text" },
      { name: "--ds-text-2", note: "Secondary, labels" },
      { name: "--ds-text-3", note: "Hints, disabled" },
      { name: "--ds-border", note: "Dividers" },
      { name: "--ds-selection", note: "Selected clip outline" },
    ],
  },
  {
    title: "Brand and status",
    tokens: [
      { name: "--ds-accent", note: "Brand, focus, keyframes" },
      { name: "--ds-success", note: "Supported, published" },
      { name: "--ds-warning", note: "Weak, needs your OK" },
      { name: "--ds-danger", note: "Unsupported, delete" },
      { name: "--ds-info", note: "Captions, info" },
    ],
  },
  {
    title: "Timeline clips",
    tokens: [
      { name: "--clip-media", note: "Video and image" },
      { name: "--clip-graphic", note: "Motion graphics" },
      { name: "--clip-text", note: "Text" },
      { name: "--clip-caption", note: "Captions" },
      { name: "--clip-voice", note: "Voice" },
      { name: "--clip-music", note: "Music" },
      { name: "--clip-sfx", note: "Sound effects" },
      { name: "--clip-effect", note: "Effects, filters" },
    ],
  },
];

const TYPE_SCALE = [
  { className: "ds-display", label: "Display", sample: "What should the next video prove?" },
  { className: "ds-title", label: "Title", sample: "Recent projects" },
  { className: "ds-heading", label: "Heading", sample: "Transform" },
  { className: "ds-body", label: "Body", sample: "Every claim links to its source, and every stage waits for your click." },
  { className: "ds-label", label: "Label", sample: "Opacity" },
  { className: "ds-caption", label: "Caption", sample: "Blank timeline · 8 formats" },
  { className: "ds-overline", label: "Overline", sample: "Waiting on you" },
];

/** Reads a token's computed value so the page always shows the live theme. */
function useTokenValues(names: string[], dependency: unknown): Record<string, string> {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const style = getComputedStyle(document.documentElement);
      setValues(Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name).trim()])));
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dependency]);
  return values;
}

function Block({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="flex min-w-0 scroll-mt-6 flex-col gap-4" aria-labelledby={`${id}-title`}>
      <div>
        <h2 id={`${id}-title`} className="ds-title text-ds-text">
          {title}
        </h2>
        {description ? <p className="mt-1 max-w-2xl text-[13px] text-ds-text-2">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Specimen({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("ds-card flex min-w-0 flex-col gap-3 p-4", className)}>
      <p className="ds-overline text-ds-text-3">{label}</p>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function MotionDemo() {
  const [on, setOn] = useState(false);
  return (
    <div className="ds-card flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="ds-overline text-ds-text-3">Easing · ease-out for entrances, ease-in-out for moves</p>
        <Button size="sm" variant="secondary" onClick={() => setOn((value) => !value)}>
          <IconPlayerPlayFilled className="size-3.5" />
          Play
        </Button>
      </div>
      {[
        { label: "--ds-ease-out · 320ms", easing: "var(--ds-ease-out)" },
        { label: "--ds-ease-in-out · 320ms", easing: "var(--ds-ease-in-out)" },
      ].map((row) => (
        <div key={row.label} className="flex flex-col gap-1.5">
          <span className="font-mono text-[11px] text-ds-text-2">{row.label}</span>
          <div className="relative h-8 rounded-ds-sm bg-ds-sunken">
            <span
              className="absolute top-1 size-6 rounded-full bg-ds-accent motion-reduce:transition-none"
              style={{ left: on ? "calc(100% - 28px)" : "4px", transition: `left var(--ds-dur-slow) ${row.easing}` }}
            />
          </div>
        </div>
      ))}
      <p className="ds-caption text-ds-text-3">Durations: fast 120ms (press, hover) · base 200ms (menus) · slow 320ms (panels). Reduced motion turns these off.</p>
    </div>
  );
}

export function DesignPage() {
  const theme = useThemeToggle();
  const tokenNames = COLOR_GROUPS.flatMap((group) => group.tokens.map((token) => token.name));
  const values = useTokenValues(tokenNames, theme.dark);
  const [segment, setSegment] = useState<"16:9" | "9:16" | "1:1">("16:9");
  const [toggle, setToggle] = useState(true);
  const [check, setCheck] = useState(true);
  const [opacity, setOpacity] = useState(1);
  const [scale, setScale] = useState(100);
  const [x, setX] = useState(50);
  const [blend, setBlend] = useState("normal");
  const [color, setColor] = useState<string | undefined>("#5b4bef");
  const [title, setTitle] = useState("Why good motion feels physical");
  const [section, setSection] = useState(true);
  const [dialog, setDialog] = useState(false);
  const [sheet, setSheet] = useState(false);

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-12 px-4 pb-16 pt-5 sm:px-8 sm:pt-9">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="ds-overline text-ds-accent">Crewcut design system</p>
          <h1 className="ds-display mt-1 text-ds-text">Tokens and components</h1>
          <p className="mt-2 max-w-2xl text-[14px] text-ds-text-2">
            One set of tokens drives light and dark. Import components from <code className="whitespace-nowrap font-mono text-[12px]">@/components/ds</code>; colours come from <code className="whitespace-nowrap font-mono text-[12px]">--ds-*</code> and <code className="whitespace-nowrap font-mono text-[12px]">--clip-*</code> in
            <code className="whitespace-nowrap font-mono text-[12px]"> app/global.css</code>.
          </p>
        </div>
        <Segmented
          ariaLabel="Theme"
          value={theme.dark ? "dark" : "light"}
          onChange={(value) => theme.setTheme(value)}
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </header>

      <Block id="principles" title="Principles">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Ink and one accent", "Primary actions are ink black in light and white in dark. Violet is the brand: focus, selection, keyframes."],
            ["Hairlines, not borders", "Edges are 1px alpha hairlines so surfaces read in both themes without heavy lines."],
            ["Numbers line up", "Timecodes and counts use tabular figures and Geist Mono."],
            ["Quick, quiet motion", "Ease-out entrances under 320ms, press feedback at 97%, nothing when reduced motion is on."],
          ].map(([heading, body]) => (
            <li key={heading} className="ds-card p-4">
              <p className="ds-heading text-ds-text">{heading}</p>
              <p className="mt-1 text-[13px] text-ds-text-2">{body}</p>
            </li>
          ))}
        </ul>
      </Block>

      <Block id="color" title="Colour" description="Swatches read the live computed value, so switching the theme above updates every value.">
        <div className="grid gap-6 lg:grid-cols-2">
          {COLOR_GROUPS.map((group) => (
            <div key={group.title} className="flex min-w-0 flex-col gap-2">
              <p className="ds-label text-ds-text-2">{group.title}</p>
              <ul className="ds-card divide-y divide-ds-border overflow-hidden">
                {group.tokens.map((token) => (
                  <li key={token.name} className="flex min-w-0 items-center gap-3 px-3 py-2">
                    <span className="size-8 shrink-0 rounded-ds-sm shadow-[inset_0_0_0_1px_var(--ds-hairline)]" style={{ background: `var(${token.name})` }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[12px] text-ds-text">{token.name}</span>
                      <span className="block truncate text-[11px] text-ds-text-3">{token.note}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[11px] uppercase text-ds-text-2 tabular">{values[token.name] ?? ""}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Block>

      <Block id="type" title="Typography" description="Geist for everything, Geist Mono for timecodes and code. Sizes are fixed for UI; only Display scales with the viewport.">
        <div className="ds-card divide-y divide-ds-border">
          {TYPE_SCALE.map((entry) => (
            <div key={entry.className} className="grid min-w-0 gap-1 px-4 py-3 sm:grid-cols-[140px_minmax(0,1fr)] sm:items-baseline sm:gap-4">
              <span className="font-mono text-[11px] text-ds-text-3">.{entry.className}</span>
              <span className={cn(entry.className, "min-w-0 text-ds-text")}>{entry.sample}</span>
            </div>
          ))}
          <div className="grid min-w-0 gap-1 px-4 py-3 sm:grid-cols-[140px_minmax(0,1fr)] sm:items-baseline sm:gap-4">
            <span className="font-mono text-[11px] text-ds-text-3">.font-mono.tabular</span>
            <span className="font-mono text-[15px] text-ds-text tabular">00:00:12.480 / 00:00:53.300</span>
          </div>
        </div>
      </Block>

      <Block id="shape" title="Radius, elevation and surfaces">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(["xs", "sm", "md", "lg", "xl"] as const).map((size) => (
            <div key={size} className="ds-card flex items-center gap-3 p-4">
              <span className="size-12 shrink-0 bg-ds-accent-soft shadow-[inset_0_0_0_1.5px_var(--ds-accent)]" style={{ borderRadius: `var(--ds-radius-${size})` }} />
              <span className="font-mono text-[12px] text-ds-text-2">--ds-radius-{size}</span>
            </div>
          ))}
          {(["sm", "md", "lg"] as const).map((level) => (
            <div key={level} className="flex h-24 items-center justify-center rounded-ds-lg bg-ds-surface font-mono text-[12px] text-ds-text-2" style={{ boxShadow: `var(--ds-shadow-${level}), 0 0 0 1px var(--ds-hairline)` }}>
              --ds-shadow-{level}
            </div>
          ))}
          <div className="relative flex h-24 items-end overflow-hidden rounded-ds-lg bg-ds-stage p-2" style={{ backgroundImage: "linear-gradient(135deg, var(--clip-graphic), var(--clip-text))" }}>
            <span className="pc-glass rounded-ds-sm px-2 py-1 font-mono text-[11px] text-ds-text">.pc-glass</span>
          </div>
        </div>
      </Block>

      <Block id="motion" title="Motion">
        <MotionDemo />
      </Block>

      <Block id="components" title="Components" description="Every control in the editor and dashboard is one of these.">
        <div className="grid gap-4 lg:grid-cols-2">
          <Specimen label="Button">
            <Button>Export</Button>
            <Button variant="secondary">Share</Button>
            <Button variant="outline">Cancel</Button>
            <Button variant="ghost">Skip</Button>
            <Button variant="destructive">Delete</Button>
            <Button size="sm">Small</Button>
          </Specimen>
          <Specimen label="IconButton · ghost, soft, solid, glass, accent, active">
            <IconButton label="Undo" shortcut="Ctrl Z">
              <IconArrowBackUp />
            </IconButton>
            <IconButton label="Split" variant="soft">
              <IconScissors />
            </IconButton>
            <IconButton label="Play" variant="solid">
              <IconPlayerPlayFilled />
            </IconButton>
            <IconButton label="Layers" variant="glass">
              <IconLayersSubtract />
            </IconButton>
            <IconButton label="Adjust" variant="accent">
              <IconAdjustments />
            </IconButton>
            <IconButton label="Snapping" active>
              <IconMagnet />
            </IconButton>
            <IconButton label="Large" size="lg" variant="soft">
              <IconCut />
            </IconButton>
          </Specimen>
          <Specimen label="Segmented · Switch · Checkbox">
            <Segmented ariaLabel="Ratio" value={segment} onChange={setSegment} options={(["16:9", "9:16", "1:1"] as const).map((value) => ({ value, label: value }))} />
            <Switch checked={toggle} onCheckedChange={setToggle} label="Captions" />
            <Checkbox checked={check} onCheckedChange={setCheck} label="Enable" />
          </Specimen>
          <Specimen label="Tabs · underline and pill" className="[&>div]:flex-col [&>div]:items-stretch">
            <Tabs defaultValue="media">
              <TabsList className="px-0">
                <TabsTrigger value="media">Media</TabsTrigger>
                <TabsTrigger value="text">Text</TabsTrigger>
                <TabsTrigger value="effects">Effects</TabsTrigger>
              </TabsList>
              <TabsContent value="media" className="pt-2 text-[13px] text-ds-text-2">
                Media tab content
              </TabsContent>
              <TabsContent value="text" className="pt-2 text-[13px] text-ds-text-2">
                Text tab content
              </TabsContent>
              <TabsContent value="effects" className="pt-2 text-[13px] text-ds-text-2">
                Effects tab content
              </TabsContent>
            </Tabs>
            <Tabs defaultValue="basic">
              <TabsList variant="pill">
                <TabsTrigger variant="pill" value="basic">
                  Basic
                </TabsTrigger>
                <TabsTrigger variant="pill" value="audio">
                  Audio
                </TabsTrigger>
                <TabsTrigger variant="pill" value="speed">
                  Speed
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </Specimen>
          <div className="ds-card min-w-0 overflow-hidden lg:row-span-2">
            <p className="ds-overline px-4 pt-4 text-ds-text-3">Inspector · Section, SliderField, ScrubField, Select, ColorField</p>
            <Section title="Compositing" enabled={section} onEnabledChange={setSection}>
              <FieldRow label="Blend">
                <Select
                  label="Blend mode"
                  value={blend}
                  onChange={setBlend}
                  className="w-full"
                  options={["normal", "multiply", "screen", "overlay", "lighten", "difference"].map((value) => ({ value, label: value[0]?.toUpperCase() + value.slice(1) }))}
                />
              </FieldRow>
              <SliderField label="Opacity" value={opacity} min={0} max={1} step={0.01} format={(value) => Math.round(value * 100)} parse={(value) => value / 100} unit="%" onChange={setOpacity} onCommit={setOpacity} keyframe={{ state: "has", label: "Opacity", onToggle: () => undefined }} />
            </Section>
            <Section title="Transform">
              <div className="grid grid-cols-2 gap-2">
                <ScrubField label="X" value={x} unit="%" step={0.5} onScrub={setX} onCommit={setX} />
                <ScrubField label="Y" value={50} unit="%" step={0.5} onCommit={() => undefined} />
              </div>
              <SliderField label="Scale" value={scale} min={10} max={400} step={1} unit="%" onChange={setScale} onCommit={setScale} keyframe={{ state: "on", label: "Scale", onToggle: () => undefined }} />
              <FieldRow label="Colour">
                <ColorField label="Fill" value={color} onChange={(value) => setColor(value ?? undefined)} allowNone />
              </FieldRow>
            </Section>
            <Section title="Text" defaultOpen={false}>
              <TextField label="Title" value={title} onCommit={setTitle} />
            </Section>
          </div>
          <Specimen label="NumberBox · Kbd">
            <div className="w-24">
              <NumberBox label="Duration" value={2.5} unit="s" onCommit={() => undefined} />
            </div>
            <Kbd>Space</Kbd>
            <Kbd>S</Kbd>
            <Kbd>⌘ Z</Kbd>
          </Specimen>
          <Specimen label="Menus · right-click the box, or use the ⋯ button">
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div className="flex h-16 min-w-[180px] flex-1 items-center justify-center rounded-ds-md border border-dashed border-ds-border text-[13px] text-ds-text-2">Right-click me</div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem icon={<IconCopy />} shortcut="Ctrl C">
                  Copy
                </ContextMenuItem>
                <ContextMenuItem icon={<IconScissors />} shortcut="S">
                  Split at playhead
                </ContextMenuItem>
                <ContextMenuSub>
                  <ContextMenuSubTrigger icon={<IconAdjustments />}>Speed</ContextMenuSubTrigger>
                  <ContextMenuSubContent>
                    {["0.5×", "1×", "1.5×", "2×"].map((speed) => (
                      <ContextMenuItem key={speed}>{speed}</ContextMenuItem>
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>
                <ContextMenuSeparator />
                <ContextMenuItem icon={<IconTrash />} danger shortcut="Del">
                  Delete
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label="More" tooltip={false} variant="soft">
                  <IconDots />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem icon={<IconCopy />}>Duplicate</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem icon={<IconTrash />} danger>
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </Specimen>
          <Specimen label="Dialog · BottomSheet">
            <Button variant="secondary" onClick={() => setDialog(true)}>
              Open dialog
            </Button>
            <Button variant="secondary" onClick={() => setSheet(true)}>
              Open bottom sheet
            </Button>
            <Dialog open={dialog} onOpenChange={setDialog} title="Delete “Launch teaser”?" description="This can't be undone." footer={<Button onClick={() => setDialog(false)}>Got it</Button>}>
              <p className="text-[13px] text-ds-text-2">Dialogs centre on desktop and keep focus inside until closed.</p>
            </Dialog>
            <BottomSheet open={sheet} onOpenChange={setSheet} title="Volume">
              <SliderField label="Volume" value={scale} min={0} max={200} unit="%" onChange={setScale} onCommit={setScale} />
            </BottomSheet>
          </Specimen>
          <Specimen label="Status">
            <StatusPill status="running" />
            <StatusPill status="awaiting_approval" />
            <StatusPill status="approved" />
            <StatusPill status="blocked" />
            <VerdictBadge verdict="supported" />
            <VerdictBadge verdict="weak" />
            <VerdictBadge verdict="unsupported" />
          </Specimen>
          <Specimen label="Timeline clips · white text on every clip colour" className="[&>div]:flex-col [&>div]:items-stretch">
            {[
              ["--clip-graphic", "Scene · Hook"],
              ["--clip-text", "Text · Springs feel physical"],
              ["--clip-caption", "Caption · because they keep momentum"],
              ["--clip-voice", "Voice · line 3"],
              ["--clip-music", "Music · Calm pads"],
              ["--clip-sfx", "Whoosh"],
            ].map(([token, label]) => (
              <div key={token} className="ds-clip flex h-8 items-center rounded-ds-xs px-2.5 text-[12px] font-medium" style={{ background: `var(${token})` }}>
                <span className="truncate">{label}</span>
              </div>
            ))}
          </Specimen>
          <Specimen label="Skeleton · EmptyState" className="[&>div]:flex-col [&>div]:items-stretch">
            <div className="pc-skeleton h-4 w-3/4" />
            <div className="pc-skeleton h-4 w-1/2" />
            <EmptyState title="No clips on this track">Drag media here or press the + button.</EmptyState>
          </Specimen>
        </div>
      </Block>
    </div>
  );
}
