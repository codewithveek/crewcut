import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as SelectPrimitive from "@radix-ui/react-select";
import * as SliderPrimitive from "@radix-ui/react-slider";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { IconCheck, IconChevronDown, IconDiamond, IconDiamondFilled } from "@tabler/icons-react";
import { forwardRef, useEffect, useRef, useState } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Crewcut design-system controls. Every control reads the --ds-* tokens, so
 * light and dark themes come for free. Sizes: sm 28px, md 32px, lg 40px
 * (44px minimum on touch via .pc-touch-target).
 */

// ── IconButton ──────────────────────────────────────────────────────────────

type IconButtonVariant = "ghost" | "soft" | "solid" | "glass" | "accent";
type IconButtonSize = "xs" | "sm" | "md" | "lg";

const ICON_BUTTON_SIZE: Record<IconButtonSize, string> = {
  xs: "size-6 rounded-ds-xs [&_svg]:size-3.5",
  sm: "size-7 rounded-ds-sm [&_svg]:size-4",
  md: "size-8 rounded-ds-sm [&_svg]:size-4",
  lg: "size-10 rounded-ds-md [&_svg]:size-5",
};

const ICON_BUTTON_VARIANT: Record<IconButtonVariant, string> = {
  ghost: "text-ds-text-2 hover:bg-ds-surface-3 hover:text-ds-text",
  soft: "bg-ds-surface-2 text-ds-text hover:bg-ds-surface-3",
  solid: "bg-primary text-primary-foreground hover:opacity-90",
  glass: "pc-glass text-ds-text hover:bg-ds-surface-3",
  accent: "bg-ds-accent text-ds-on-accent hover:opacity-90",
};

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  label: string;
  children: React.ReactNode;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  active?: boolean;
  shortcut?: string;
  tooltip?: boolean;
  tooltipSide?: "top" | "bottom" | "left" | "right";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, children, variant = "ghost", size = "md", active, shortcut, tooltip = true, tooltipSide = "top", className, ...props },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      className={cn(
        "pc-press pc-touch-target inline-flex shrink-0 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ds-accent disabled:pointer-events-none disabled:opacity-40",
        ICON_BUTTON_SIZE[size],
        ICON_BUTTON_VARIANT[variant],
        active && variant === "ghost" && "bg-ds-accent-soft text-ds-accent hover:bg-ds-accent-soft hover:text-ds-accent",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
  if (!tooltip) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side={tooltipSide}>
        {label}
        {shortcut ? <span className="ml-2 font-mono text-[10px] opacity-60">{shortcut}</span> : null}
      </TooltipContent>
    </Tooltip>
  );
});

// ── Segmented control ──────────────────────────────────────────────────────

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  title?: string;
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  className,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<SegmentedOption<T>>;
  size?: "sm" | "md";
  className?: string;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("inline-flex items-center gap-0.5 rounded-ds-sm bg-ds-surface-2 p-0.5 shadow-[inset_0_0_0_1px_var(--ds-hairline)]", className)}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              "pc-press inline-flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-[6px] font-medium tabular outline-none focus-visible:ring-2 focus-visible:ring-ds-accent",
              size === "sm" ? "h-6 px-2 text-[11px]" : "h-7 px-2.5 text-xs",
              selected ? "bg-ds-surface text-ds-text shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_1px_var(--ds-hairline)]" : "text-ds-text-2 hover:text-ds-text",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Tabs ────────────────────────────────────────────────────────────────────

export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;

export function TabsList({ className, variant = "underline", ...props }: React.ComponentProps<typeof TabsPrimitive.List> & { variant?: "underline" | "pill" }) {
  return (
    <TabsPrimitive.List
      data-variant={variant}
      className={cn(
        "flex min-w-0 items-center",
        variant === "underline" ? "gap-4 border-b border-ds-border px-3" : "gap-0.5 rounded-ds-sm bg-ds-surface-2 p-0.5",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, variant = "underline", onPointerDown, onKeyDown, onBlur, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger> & { variant?: "underline" | "pill" }) {
  return (
    <TabsPrimitive.Trigger
      // Radix focuses a tab in a way Chrome reports as keyboard focus, so a mouse
      // click drew the focus ring. Mark pointer focus and hide the ring for it only.
      onPointerDown={(event) => {
        event.currentTarget.dataset.pointer = "";
        onPointerDown?.(event);
      }}
      onKeyDown={(event) => {
        delete event.currentTarget.dataset.pointer;
        onKeyDown?.(event);
      }}
      onBlur={(event) => {
        delete event.currentTarget.dataset.pointer;
        onBlur?.(event);
      }}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ds-accent data-[pointer]:focus-visible:ring-0 disabled:opacity-40 [&_svg]:size-4",
        variant === "underline"
          ? "relative h-10 text-[13px] text-ds-text-2 hover:text-ds-text data-[state=active]:text-ds-text after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-transparent data-[state=active]:after:bg-ds-text"
          : "h-7 flex-1 justify-center rounded-[6px] px-2.5 text-xs text-ds-text-2 hover:text-ds-text data-[state=active]:bg-ds-surface data-[state=active]:text-ds-text data-[state=active]:shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_1px_var(--ds-hairline)]",
        className,
      )}
      {...props}
    />
  );
}

// ── Switch ──────────────────────────────────────────────────────────────────

export function Switch({ checked, onCheckedChange, label, className, disabled }: { checked: boolean; onCheckedChange: (checked: boolean) => void; label: string; className?: string; disabled?: boolean }) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={label}
      disabled={disabled}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-ds-surface-3 shadow-[inset_0_0_0_1px_var(--ds-hairline)] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ds-accent disabled:opacity-40 data-[state=checked]:bg-ds-accent",
        className,
      )}
    >
      <SwitchPrimitive.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)] transition-transform duration-150 ease-[var(--ds-ease-out)] data-[state=checked]:translate-x-[18px]" />
    </SwitchPrimitive.Root>
  );
}

export function Checkbox({ checked, onCheckedChange, label, className }: { checked: boolean; onCheckedChange: (checked: boolean) => void; label: string; className?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onCheckedChange(!checked);
      }}
      className={cn(
        "pc-press flex size-4 shrink-0 items-center justify-center rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-ds-accent",
        checked ? "bg-ds-accent text-ds-on-accent" : "bg-ds-surface shadow-[inset_0_0_0_1.5px_var(--ds-border)]",
        className,
      )}
    >
      {checked ? <IconCheck className="size-3" strokeWidth={3} /> : null}
    </button>
  );
}

// ── Slider ──────────────────────────────────────────────────────────────────

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  onCommit,
  label,
  className,
  centered,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange?: (value: number) => void;
  onCommit?: (value: number) => void;
  label: string;
  className?: string;
  /** Bipolar sliders (−100…100) fill from the centre. */
  centered?: boolean;
}) {
  const percent = ((value - min) / (max - min)) * 100;
  const zero = centered ? ((0 - min) / (max - min)) * 100 : 0;
  return (
    <SliderPrimitive.Root
      value={[value]}
      min={min}
      max={max}
      step={step}
      onValueChange={([next]) => next !== undefined && onChange?.(next)}
      onValueCommit={([next]) => next !== undefined && onCommit?.(next)}
      className={cn("relative flex h-5 w-full touch-none select-none items-center", className)}
    >
      <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-ds-surface-3">
        {centered ? (
          <span className="absolute inset-y-0 bg-ds-accent" style={{ left: `${Math.min(zero, percent)}%`, width: `${Math.abs(percent - zero)}%` }} />
        ) : (
          <SliderPrimitive.Range className="absolute h-full bg-ds-accent" />
        )}
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={label}
        className="block size-3.5 rounded-full bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.12),0_1px_4px_rgb(0_0_0/0.3)] outline-none transition-transform duration-100 hover:scale-110 focus-visible:ring-2 focus-visible:ring-ds-accent"
      />
    </SliderPrimitive.Root>
  );
}

function round(value: number, step: number): number {
  const decimals = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)));
  return Number(value.toFixed(decimals));
}

/** Label · slider · value box · keyframe diamond (image-4 style inspector row). */
export function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "",
  format,
  parse,
  onChange,
  onCommit,
  keyframe,
  centered,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  /** Display transform (e.g. 1 → "100"). */
  format?: (value: number) => number;
  parse?: (display: number) => number;
  onChange?: (value: number) => void;
  onCommit: (value: number) => void;
  keyframe?: KeyframeToggleProps;
  centered?: boolean;
  disabled?: boolean;
}) {
  const toDisplay = format ?? ((v: number) => v);
  const fromDisplay = parse ?? ((v: number) => v);
  const [live, setLive] = useState(value);
  useEffect(() => setLive(value), [value]);
  return (
    <div className={cn("grid grid-cols-[72px_minmax(0,1fr)_64px_20px] items-center gap-2", disabled && "pointer-events-none opacity-40")}>
      <span className="truncate text-xs text-ds-text-2">{label}</span>
      <Slider
        label={label}
        value={live}
        min={min}
        max={max}
        step={step}
        centered={centered}
        onChange={(next) => {
          setLive(next);
          onChange?.(next);
        }}
        onCommit={onCommit}
      />
      <NumberBox
        value={round(toDisplay(live), step < 1 && !format ? step : 1)}
        unit={unit}
        onCommit={(display) => {
          const next = Math.max(min, Math.min(max, fromDisplay(display)));
          setLive(next);
          onCommit(next);
        }}
        label={label}
      />
      {keyframe ? <KeyframeToggle {...keyframe} /> : <span />}
    </div>
  );
}

/** Compact numeric input with a unit suffix; Enter or blur commits, arrows step. */
export function NumberBox({ value, unit, onCommit, label, step = 1, className }: { value: number; unit?: string; onCommit: (value: number) => void; label: string; step?: number; className?: string }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const next = Number(draft);
    if (Number.isFinite(next) && next !== value) onCommit(next);
    else setDraft(String(value));
  };
  return (
    <label className={cn("flex h-7 min-w-0 items-center rounded-ds-xs bg-ds-surface-2 px-1.5 shadow-[inset_0_0_0_1px_var(--ds-hairline)] focus-within:shadow-[inset_0_0_0_1.5px_var(--ds-accent)]", className)}>
      <input
        aria-label={label}
        inputMode="decimal"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
          if (event.key === "Escape") {
            setDraft(String(value));
            (event.target as HTMLInputElement).blur();
          }
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            const next = Number(draft) + (event.key === "ArrowUp" ? 1 : -1) * step * (event.shiftKey ? 10 : 1);
            setDraft(String(next));
            onCommit(next);
          }
        }}
        className="w-full min-w-0 bg-transparent text-right font-mono text-[11px] tabular text-ds-text outline-none"
      />
      {unit ? <span className="ml-0.5 shrink-0 text-[10px] text-ds-text-3">{unit}</span> : null}
    </label>
  );
}

/**
 * Number field whose label scrubs: drag the label left/right to change the
 * value (Shift = ×10, Alt = ×0.1). The input still accepts typed values.
 */
export function ScrubField({
  label,
  value,
  step = 1,
  unit,
  min = -Infinity,
  max = Infinity,
  onScrub,
  onCommit,
  className,
}: {
  label: string;
  value: number;
  step?: number;
  unit?: string;
  min?: number;
  max?: number;
  onScrub?: (value: number) => void;
  onCommit: (value: number) => void;
  className?: string;
}) {
  const [live, setLive] = useState<number | null>(null);
  const shown = live ?? value;
  const clamp = (next: number) => Math.max(min, Math.min(max, next));
  return (
    <div className={cn("flex min-w-0 items-center gap-1", className)}>
      <span
        role="slider"
        tabIndex={-1}
        aria-label={`Scrub ${label}`}
        aria-valuenow={shown}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          const startX = event.clientX;
          const start = value;
          let latest = value;
          (event.target as HTMLElement).setPointerCapture(event.pointerId);
          const move = (moveEvent: PointerEvent) => {
            const factor = moveEvent.shiftKey ? 10 : moveEvent.altKey ? 0.1 : 1;
            latest = clamp(round(start + (moveEvent.clientX - startX) * step * factor, step * (moveEvent.altKey ? 0.1 : 1)));
            setLive(latest);
            onScrub?.(latest);
          };
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            setLive(null);
            if (latest !== start) onCommit(latest);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
        className="w-4 shrink-0 cursor-ew-resize select-none text-[11px] font-medium text-ds-text-3 hover:text-ds-accent"
      >
        {label}
      </span>
      <NumberBox value={round(shown, step)} unit={unit} label={label} step={step} onCommit={(next) => onCommit(clamp(next))} className="flex-1" />
    </div>
  );
}

// ── Keyframe toggle ─────────────────────────────────────────────────────────

export interface KeyframeToggleProps {
  /** "on" = a keyframe sits at the playhead; "has" = the property animates elsewhere. */
  state: "on" | "has" | "none";
  onToggle: () => void;
  label: string;
}

export function KeyframeToggle({ state, onToggle, label }: KeyframeToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={state === "on" ? `Remove ${label} keyframe at playhead` : `Add ${label} keyframe at playhead`}
      title={state === "on" ? "Remove keyframe at playhead" : "Add keyframe at playhead"}
      className={cn("pc-press flex size-5 items-center justify-center rounded outline-none focus-visible:ring-2 focus-visible:ring-ds-accent", state === "none" ? "text-ds-text-3 hover:text-ds-text" : "text-ds-accent")}
    >
      {state === "on" ? <IconDiamondFilled className="size-3.5" /> : <IconDiamond className="size-3.5" />}
    </button>
  );
}

// ── Select ──────────────────────────────────────────────────────────────────

export interface SelectOption {
  value: string;
  label: React.ReactNode;
  group?: string;
}

export function Select({ value, onChange, options, label, className, size = "md" }: { value: string; onChange: (value: string) => void; options: ReadonlyArray<SelectOption>; label: string; className?: string; size?: "sm" | "md" }) {
  const groups = [...new Set(options.map((option) => option.group ?? ""))];
  return (
    <SelectPrimitive.Root value={value} onValueChange={onChange}>
      <SelectPrimitive.Trigger
        aria-label={label}
        className={cn(
          "inline-flex min-w-0 items-center justify-between gap-2 rounded-ds-xs bg-ds-surface-2 px-2 text-left text-xs text-ds-text shadow-[inset_0_0_0_1px_var(--ds-hairline)] outline-none hover:bg-ds-surface-3 focus-visible:ring-2 focus-visible:ring-ds-accent",
          size === "sm" ? "h-7" : "h-8",
          className,
        )}
      >
        <span className="truncate">
          <SelectPrimitive.Value />
        </span>
        <IconChevronDown className="size-3.5 shrink-0 text-ds-text-3" />
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content position="popper" sideOffset={4} className="ds-popover ds-menu-enter z-[200] max-h-[min(360px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden">
          <SelectPrimitive.Viewport className="p-1">
            {groups.map((group) => (
              <SelectPrimitive.Group key={group || "default"}>
                {group ? <SelectPrimitive.Label className="px-2 pb-1 pt-2 ds-overline text-ds-text-3">{group}</SelectPrimitive.Label> : null}
                {options
                  .filter((option) => (option.group ?? "") === group)
                  .map((option) => (
                    <SelectPrimitive.Item
                      key={option.value}
                      value={option.value}
                      className="relative flex h-8 cursor-default select-none items-center rounded-[6px] pl-7 pr-2 text-xs text-ds-text outline-none data-[highlighted]:bg-ds-surface-3"
                    >
                      <SelectPrimitive.ItemIndicator className="absolute left-2">
                        <IconCheck className="size-3.5" />
                      </SelectPrimitive.ItemIndicator>
                      <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                    </SelectPrimitive.Item>
                  ))}
              </SelectPrimitive.Group>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

// ── Colour ──────────────────────────────────────────────────────────────────

export const SWATCHES = ["#ffffff", "#000000", "#15171d", "#f3f3f6", "#ff5b2e", "#f5f3ee", "#ff4d6a", "#f97316", "#ffd400", "#3ccf7f", "#0f97ad", "#2b7de9", "#b546c9", "#ff8fab"];

export function ColorField({ value, onChange, label, swatches = SWATCHES, allowNone }: { value: string | undefined; onChange: (value: string | null) => void; label: string; swatches?: readonly string[]; allowNone?: boolean }) {
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState(value ?? "");
  useEffect(() => setHex(value ?? ""), [value]);
  const commitHex = () => {
    const normalized = hex.startsWith("#") ? hex : `#${hex}`;
    if (/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(normalized)) onChange(normalized.toLowerCase());
    else setHex(value ?? "");
  };
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={`${label}: ${value ?? "none"}`}
          className="pc-press flex h-7 min-w-0 items-center gap-2 rounded-ds-xs bg-ds-surface-2 pl-1 pr-2 shadow-[inset_0_0_0_1px_var(--ds-hairline)] outline-none hover:bg-ds-surface-3 focus-visible:ring-2 focus-visible:ring-ds-accent"
        >
          <span className={cn("size-5 shrink-0 rounded-[5px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)]", !value && "ds-checker")} style={value ? { background: value } : undefined} />
          <span className="truncate font-mono text-[11px] uppercase text-ds-text-2">{value ? value.slice(0, 7) : "None"}</span>
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content sideOffset={6} align="start" className="ds-popover ds-menu-enter z-[200] w-56 p-3" onKeyDown={(event) => event.stopPropagation()}>
          <div className="grid grid-cols-7 gap-1.5">
            {swatches.map((swatch) => (
              <button
                key={swatch}
                type="button"
                aria-label={swatch}
                onClick={() => {
                  onChange(swatch);
                  setOpen(false);
                }}
                className={cn("pc-press size-6 rounded-[6px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)] outline-none focus-visible:ring-2 focus-visible:ring-ds-accent", value?.slice(0, 7) === swatch && "ring-2 ring-ds-accent ring-offset-1 ring-offset-[var(--ds-surface)]")}
                style={{ background: swatch }}
              />
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input type="color" aria-label={`Pick ${label}`} value={(value ?? "#000000").slice(0, 7)} onChange={(event) => onChange(event.target.value)} className="h-8 w-9 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0" />
            <input
              aria-label={`${label} hex`}
              value={hex}
              onChange={(event) => setHex(event.target.value)}
              onBlur={commitHex}
              onKeyDown={(event) => event.key === "Enter" && commitHex()}
              className="h-8 min-w-0 flex-1 rounded-ds-xs bg-ds-surface-2 px-2 font-mono text-xs uppercase text-ds-text shadow-[inset_0_0_0_1px_var(--ds-hairline)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--ds-accent)]"
            />
          </div>
          {allowNone ? (
            <button type="button" onClick={() => onChange(null)} className="mt-2 text-xs text-ds-text-2 hover:text-ds-text">
              Remove colour
            </button>
          ) : null}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

// ── Layout helpers ──────────────────────────────────────────────────────────

export function FieldRow({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2", className)}>
      <span className="truncate text-xs text-ds-text-2">{label}</span>
      <div className="flex min-w-0 items-center gap-1.5">{children}</div>
    </div>
  );
}

/** Collapsible inspector section with an optional enable checkbox (image-4 style). */
export function Section({
  title,
  children,
  enabled,
  onEnabledChange,
  defaultOpen = true,
  actions,
  className,
}: {
  title: string;
  children: React.ReactNode;
  enabled?: boolean;
  onEnabledChange?: (enabled: boolean) => void;
  defaultOpen?: boolean;
  actions?: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={cn("border-b border-ds-border last:border-b-0", className)}>
      <div className="flex h-10 items-center gap-2 px-3">
        {onEnabledChange ? <Checkbox checked={Boolean(enabled)} onCheckedChange={onEnabledChange} label={`Enable ${title}`} /> : null}
        <button type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:text-ds-accent">
          <span className="truncate text-[13px] font-semibold text-ds-text">{title}</span>
          <IconChevronDown className={cn("ml-auto size-4 shrink-0 text-ds-text-3 transition-transform duration-150", !open && "-rotate-90")} />
        </button>
        {actions}
      </div>
      {open ? <div className={cn("flex flex-col gap-2.5 px-3 pb-3.5", onEnabledChange && !enabled && "pointer-events-none opacity-40")}>{children}</div> : null}
    </section>
  );
}

/** A labelled text input that commits on blur/Enter (titles, names). */
export function TextField({ value, onCommit, label, placeholder, multiline, rows = 3, className }: { value: string; onCommit: (value: string) => void; label: string; placeholder?: string; multiline?: boolean; rows?: number; className?: string }) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value && draft.trim()) onCommit(draft);
    else setDraft(value);
  };
  const shared = {
    ref,
    "aria-label": label,
    value: draft,
    placeholder,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(event.target.value),
    onBlur: commit,
    onKeyDown: (event: React.KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Enter" && (!multiline || event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        ref.current?.blur();
      }
      if (event.key === "Escape") {
        setDraft(value);
        ref.current?.blur();
      }
    },
    className: cn(
      "w-full rounded-ds-xs bg-ds-surface-2 px-2 text-[13px] text-ds-text shadow-[inset_0_0_0_1px_var(--ds-hairline)] outline-none placeholder:text-ds-text-3 focus:shadow-[inset_0_0_0_1.5px_var(--ds-accent)]",
      multiline ? "resize-y py-1.5 leading-relaxed" : "h-8",
      className,
    ),
  };
  return multiline ? <textarea rows={rows} {...shared} /> : <input {...shared} />;
}
