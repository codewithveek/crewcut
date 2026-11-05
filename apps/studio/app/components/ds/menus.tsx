import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import { IconCheck, IconChevronRight, IconX } from "@tabler/icons-react";
import { Drawer } from "vaul";

import { cn } from "@/lib/utils";

/**
 * Menus, sheets and dialogs. Context menus and dropdowns share one item
 * style so right-click and the ⋯ button feel identical.
 */

const CONTENT = "ds-popover ds-menu-enter z-[200] min-w-[200px] overflow-hidden p-1 text-ds-text outline-none";
const ITEM =
  "group relative flex h-8 cursor-default select-none items-center gap-2 rounded-[6px] px-2 text-[13px] outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-ds-surface-3 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-ds-text-2";
const DANGER = "text-ds-danger [&_svg]:!text-ds-danger";
const SEPARATOR = "-mx-1 my-1 h-px bg-ds-border";
const LABEL = "px-2 pb-1 pt-1.5 ds-overline text-ds-text-3";

function Shortcut({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <span className="ml-auto pl-4 font-mono text-[10px] tracking-wide text-ds-text-3">{children}</span>;
}

// ── Context menu ────────────────────────────────────────────────────────────

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
export const ContextMenuSub = ContextMenuPrimitive.Sub;

export function ContextMenuContent({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content className={cn(CONTENT, className)} {...props} />
    </ContextMenuPrimitive.Portal>
  );
}

export function ContextMenuItem({ icon, shortcut, danger, children, className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Item> & { icon?: React.ReactNode; shortcut?: string; danger?: boolean }) {
  return (
    <ContextMenuPrimitive.Item className={cn(ITEM, danger && DANGER, className)} {...props}>
      {icon}
      <span className="truncate">{children}</span>
      <Shortcut>{shortcut}</Shortcut>
    </ContextMenuPrimitive.Item>
  );
}

export function ContextMenuCheckboxItem({ children, checked, className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.CheckboxItem>) {
  return (
    <ContextMenuPrimitive.CheckboxItem checked={checked} className={cn(ITEM, "pl-8", className)} {...props}>
      <ContextMenuPrimitive.ItemIndicator className="absolute left-2">
        <IconCheck />
      </ContextMenuPrimitive.ItemIndicator>
      {children}
    </ContextMenuPrimitive.CheckboxItem>
  );
}

export function ContextMenuSubTrigger({ icon, children, className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.SubTrigger> & { icon?: React.ReactNode }) {
  return (
    <ContextMenuPrimitive.SubTrigger className={cn(ITEM, "data-[state=open]:bg-ds-surface-3", className)} {...props}>
      {icon}
      <span className="truncate">{children}</span>
      <IconChevronRight className="ml-auto !size-3.5" />
    </ContextMenuPrimitive.SubTrigger>
  );
}

export function ContextMenuSubContent({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.SubContent className={cn(CONTENT, "max-h-[60vh] overflow-y-auto", className)} {...props} />
    </ContextMenuPrimitive.Portal>
  );
}

export function ContextMenuSeparator() {
  return <ContextMenuPrimitive.Separator className={SEPARATOR} />;
}

export function ContextMenuLabel({ children }: { children: React.ReactNode }) {
  return <ContextMenuPrimitive.Label className={LABEL}>{children}</ContextMenuPrimitive.Label>;
}

// ── Dropdown menu ───────────────────────────────────────────────────────────

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;
export const DropdownMenuSub = DropdownPrimitive.Sub;

export function DropdownMenuContent({ className, sideOffset = 6, ...props }: React.ComponentProps<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content sideOffset={sideOffset} className={cn(CONTENT, className)} {...props} />
    </DropdownPrimitive.Portal>
  );
}

export function DropdownMenuItem({ icon, shortcut, danger, children, className, ...props }: React.ComponentProps<typeof DropdownPrimitive.Item> & { icon?: React.ReactNode; shortcut?: string; danger?: boolean }) {
  return (
    <DropdownPrimitive.Item className={cn(ITEM, danger && DANGER, className)} {...props}>
      {icon}
      <span className="truncate">{children}</span>
      <Shortcut>{shortcut}</Shortcut>
    </DropdownPrimitive.Item>
  );
}

export function DropdownMenuCheckboxItem({ children, checked, className, ...props }: React.ComponentProps<typeof DropdownPrimitive.CheckboxItem>) {
  return (
    <DropdownPrimitive.CheckboxItem checked={checked} className={cn(ITEM, "pl-8", className)} {...props}>
      <DropdownPrimitive.ItemIndicator className="absolute left-2">
        <IconCheck />
      </DropdownPrimitive.ItemIndicator>
      {children}
    </DropdownPrimitive.CheckboxItem>
  );
}

export function DropdownMenuSubTrigger({ icon, children, className, ...props }: React.ComponentProps<typeof DropdownPrimitive.SubTrigger> & { icon?: React.ReactNode }) {
  return (
    <DropdownPrimitive.SubTrigger className={cn(ITEM, "data-[state=open]:bg-ds-surface-3", className)} {...props}>
      {icon}
      <span className="truncate">{children}</span>
      <IconChevronRight className="ml-auto !size-3.5" />
    </DropdownPrimitive.SubTrigger>
  );
}

export function DropdownMenuSubContent({ className, ...props }: React.ComponentProps<typeof DropdownPrimitive.SubContent>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.SubContent className={cn(CONTENT, "max-h-[60vh] overflow-y-auto", className)} {...props} />
    </DropdownPrimitive.Portal>
  );
}

export function DropdownMenuSeparator() {
  return <DropdownPrimitive.Separator className={SEPARATOR} />;
}

export function DropdownMenuLabel({ children }: { children: React.ReactNode }) {
  return <DropdownPrimitive.Label className={LABEL}>{children}</DropdownPrimitive.Label>;
}

// ── Bottom sheet (phones) ───────────────────────────────────────────────────

export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  actions,
  modal = true,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  /** Non-modal sheets keep the preview and timeline interactive above them. */
  modal?: boolean;
  className?: string;
}) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      <Drawer.Portal>
        {modal ? <Drawer.Overlay className="fixed inset-0 z-[150] bg-[var(--ds-scrim)]" /> : null}
        <Drawer.Content
          className={cn("fixed inset-x-0 bottom-0 z-[160] flex max-h-[85dvh] flex-col rounded-t-[22px] bg-ds-surface text-ds-text shadow-[var(--ds-shadow-lg),0_0_0_1px_var(--ds-hairline)] outline-none", className)}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-ds-surface-3" aria-hidden />
          <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-2.5">
            <Drawer.Title className="ds-heading min-w-0 flex-1 truncate">{title}</Drawer.Title>
            {actions}
            <Drawer.Close className="pc-press flex size-8 items-center justify-center rounded-full bg-ds-surface-2 text-ds-text-2 outline-none focus-visible:ring-2 focus-visible:ring-ds-accent" aria-label="Close">
              <IconCheck className="size-4" />
            </Drawer.Close>
          </div>
          {description ? <Drawer.Description className="sr-only">{description}</Drawer.Description> : <Drawer.Description className="sr-only">{title}</Drawer.Description>}
          <div className="ds-safe-bottom min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">{children}</div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

// ── Dialog ──────────────────────────────────────────────────────────────────

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[150] ds-fade-enter bg-[var(--ds-scrim)]" />
        <DialogPrimitive.Content
          className={cn(
            "ds-popover fixed left-1/2 top-1/2 z-[160] flex max-h-[min(720px,90dvh)] w-[min(480px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col ds-menu-enter rounded-ds-xl outline-none",
            className,
          )}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <div className="flex items-start gap-3 px-5 pb-2 pt-5">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="ds-title text-ds-text">{title}</DialogPrimitive.Title>
              {description ? <DialogPrimitive.Description className="mt-1 text-[13px] text-ds-text-2">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
            </div>
            <DialogPrimitive.Close className="pc-press -mr-1 -mt-1 flex size-8 items-center justify-center rounded-full text-ds-text-2 outline-none hover:bg-ds-surface-3 focus-visible:ring-2 focus-visible:ring-ds-accent" aria-label="Close">
              <IconX className="size-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-2">{children}</div>
          {footer ? <div className="flex items-center justify-end gap-2 border-t border-ds-border px-5 py-3">{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
