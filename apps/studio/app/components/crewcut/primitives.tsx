import type { ClaimVerdict, StageStatus } from "@crewcut/contracts";
import { IconCheck, IconCircleDashed, IconLoader2, IconAlertTriangle, IconHandStop, IconX } from "@tabler/icons-react";
import { type CSSProperties, type ReactNode, useState } from "react";

import { STATUS_META } from "@/lib/crewcut";
import { cn } from "@/lib/utils";

const TONE_CLASS = {
  idle: "bg-muted text-muted-foreground",
  running: "bg-pc-accent-soft text-pc-accent",
  waiting: "bg-weak/15 text-weak",
  done: "bg-supported/15 text-supported",
  blocked: "bg-unsupported/15 text-unsupported",
  failed: "bg-unsupported/15 text-unsupported",
} as const;

const TONE_ICON = {
  idle: IconCircleDashed,
  running: IconLoader2,
  waiting: IconHandStop,
  done: IconCheck,
  blocked: IconAlertTriangle,
  failed: IconX,
} as const;

export function StatusPill({ status, className }: { status: StageStatus; className?: string }) {
  const meta = STATUS_META[status];
  const Icon = TONE_ICON[meta.tone];
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium whitespace-nowrap", TONE_CLASS[meta.tone], className)}>
      <Icon className={cn("size-3.5", meta.tone === "running" && "motion-safe:animate-spin")} strokeWidth={2} aria-hidden />
      {meta.label}
    </span>
  );
}

const VERDICT_CLASS: Record<ClaimVerdict, string> = {
  supported: "bg-supported/15 text-supported",
  weak: "bg-weak/15 text-weak",
  unsupported: "bg-unsupported/15 text-unsupported",
};
const VERDICT_LABEL: Record<ClaimVerdict, string> = { supported: "✔ Supported", weak: "~ Weak", unsupported: "✘ Unsupported" };

export function VerdictBadge({ verdict, overridden }: { verdict: ClaimVerdict; overridden?: boolean }) {
  return (
    <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium whitespace-nowrap", overridden ? "bg-muted text-muted-foreground" : VERDICT_CLASS[verdict])}>
      {overridden ? "Overridden" : VERDICT_LABEL[verdict]}
    </span>
  );
}

export function Panel({ children, className, title, actions, description }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode; description?: ReactNode }) {
  return (
    <section className={cn("pc-panel p-4 sm:p-5", className)}>
      {title || actions ? (
        <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            {title ? <h2 className="pc-display text-[15px] text-foreground">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center">
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {children ? <div className="max-w-md text-[13px] text-muted-foreground">{children}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground">{children}</kbd>;
}

export function SkeletonLines({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="pc-skeleton h-4" style={{ width: `${90 - index * 12}%` }} />
      ))}
    </div>
  );
}

/** Brand colours of the mark itself (fixed, not themed: the logo looks the same everywhere). */
export const CREWCUT_BRAND = { ink: "#0D0D0F", paper: "#F5F3EE", cut: "#FF5B2E" } as const;

/**
 * The Crewcut mark: a C split in two, its lower half slipped sideways like a
 * jump cut. `tile` sits it on the dark rounded square (app icon); `glyph` is the
 * bare C, whose upper half follows the text colour.
 *
 * Motion (CSS in crewcut.css, all off under reduced motion):
 * - `intro`: the C draws in, then the lower half is cut loose and slips into place.
 * - `loop`: the halves close and cut again, on repeat (a loader).
 * - `hover`: the cut replays while the parent `.group` is hovered.
 */
export function CrewcutMark({
  className,
  variant = "tile",
  motion = "none",
  hover = false,
  label,
}: {
  className?: string;
  variant?: "tile" | "glyph";
  motion?: "none" | "intro" | "loop";
  hover?: boolean;
  /** Give it a name when it stands alone (e.g. a loader); otherwise it is decorative. */
  label?: string;
}) {
  // The intro plays once; dropping it afterwards lets the hover replay come and go without restarting it.
  const [introDone, setIntroDone] = useState(false);
  const activeMotion = motion === "intro" && introDone ? "none" : motion;
  const glyph = (
    <>
      <path className="pc-mark-upper" pathLength={1} d="M74.51 29.43 A32 32 0 0 0 18 50" fill="none" stroke={variant === "tile" ? CREWCUT_BRAND.paper : "currentColor"} strokeWidth="17" />
      <path className="pc-mark-lower" pathLength={1} d="M18 50 A32 32 0 0 0 74.51 70.57" fill="none" stroke={CREWCUT_BRAND.cut} strokeWidth="17" transform="translate(6 4)" />
    </>
  );
  return (
    <svg
      viewBox={variant === "tile" ? "0 0 112 112" : "0 0 100 100"}
      className={cn("pc-mark size-5 shrink-0", hover && "pc-mark-hover", className)}
      data-motion={activeMotion === "none" ? undefined : activeMotion}
      onAnimationEnd={motion === "intro" ? (event) => event.animationName === "pc-mark-cut" && setIntroDone(true) : undefined}
      style={variant === "tile" ? undefined : ({ "--pc-mark-paper": "currentColor" } as CSSProperties)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {variant === "tile" ? (
        <>
          <rect width="112" height="112" rx="26" fill={CREWCUT_BRAND.ink} />
          <g transform="translate(21 21) scale(0.7)">{glyph}</g>
        </>
      ) : (
        glyph
      )}
    </svg>
  );
}
