import type { ClaimVerdict, StageStatus } from "@proofcut/contracts";
import { IconCheck, IconCircleDashed, IconLoader2, IconAlertTriangle, IconHandStop, IconX } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { STATUS_META } from "@/lib/proofcut";
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

export function ProofcutMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-5", className)} aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="6" fill="var(--pc-accent)" />
      <path d="M8 16.5V7.5h4.2a3 3 0 0 1 0 6H8" fill="none" stroke="var(--pc-on-accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.5 15.5l1.8 1.8 3.2-3.6" fill="none" stroke="var(--pc-on-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
