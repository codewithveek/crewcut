import { IconDiamond } from "@tabler/icons-react";

import { cn } from "@/lib/utils";

/** Pro content: one quiet colour, not the accent, so it never competes with the buttons. */
export function ProBadge({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full bg-[#1f1b2e] px-2 py-0.5 text-[11px] font-semibold text-[#d8ccff] shadow-[0_0_0_1px_rgb(216_204_255/0.25)]", className)} title="Pro: free to try and edit; exporting needs Crewcut Pro">
      <IconDiamond className="size-3" aria-hidden />
      Pro
    </span>
  );
}
