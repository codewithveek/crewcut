import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { IconCopy, IconLoader2, IconLock, IconUsers, IconWorld, IconX } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button, Dialog, Select } from "@/components/ds";
import { errorMessage } from "@/lib/crewcut";
import { cn } from "@/lib/utils";

/**
 * Who can open a project. Uses Agent-Native's sharing (the same access checks
 * every query runs): invite people as viewers or editors, and set general
 * access to private, the workspace, or anyone with the link. "Anyone with the
 * link" opens a view-only page (/watch/<id>) with the latest export; editing
 * always needs an invite. Only the owner (or an admin) can change access, and
 * the assistant can't: making something public is a person's decision.
 */

type Visibility = "private" | "org" | "public";
type Role = "viewer" | "editor";

interface ShareRow {
  id: string;
  principalType: "user" | "group" | "org";
  principalId: string;
  displayName?: string | null;
  role: string;
}

interface SharesData {
  ownerEmail: string | null;
  ownerDisplayName?: string | null;
  orgId: string | null;
  visibility: Visibility | null;
  role?: string;
  shares: ShareRow[];
  policy?: { allowPublic?: boolean };
}

const ROLE_OPTIONS = [
  { value: "viewer", label: "Can view" },
  { value: "editor", label: "Can edit" },
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ShareDialog({ open, onOpenChange, videoId, title }: { open: boolean; onOpenChange: (open: boolean) => void; videoId: string; title: string }) {
  const resource = { resourceType: "video", resourceId: videoId };
  const query = useActionQuery("list-resource-shares", resource as never, { enabled: open } as never);
  const data = query.data as SharesData | undefined;
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [busy, setBusy] = useState<string | null>(null);
  const canManage = data?.role === "owner" || data?.role === "admin";
  const visibility: Visibility = data?.visibility ?? "private";
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const watchLink = `${origin}/watch/${videoId}`;
  const editorLink = `${origin}/videos/${videoId}/edit`;

  const run = async (key: string, action: string, args: Record<string, unknown>, done?: string) => {
    setBusy(key);
    try {
      await callAction(action as never, { ...resource, ...args } as never);
      await query.refetch();
      if (done) toast.success(done);
      return true;
    } catch (error) {
      toast.error(errorMessage(error));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const invite = async () => {
    const address = email.trim().toLowerCase();
    if (!EMAIL.test(address)) return toast.error("Enter an email address.");
    if (await run("invite", "share-resource", { principalType: "user", principalId: address, role, resourceUrl: `/videos/${videoId}/edit` }, `Shared with ${address}`)) setEmail("");
  };

  const copy = (link: string, what: string) => void navigator.clipboard?.writeText(link).then(() => toast.success(`${what} copied`));

  const accessOptions = [
    { value: "private", label: "Only people invited" },
    ...(data?.orgId ? [{ value: "org", label: "Everyone in your workspace" }] : []),
    ...(data?.policy?.allowPublic === false ? [] : [{ value: "public", label: "Anyone with the link" }]),
  ];
  const AccessIcon = visibility === "public" ? IconWorld : visibility === "org" ? IconUsers : IconLock;
  const people = (data?.shares ?? []).filter((share) => share.principalType === "user");

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Share “${title}”`}>
      <div className="flex flex-col gap-4">
        {canManage ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void invite();
            }}
          >
            <input
              type="email"
              value={email}
              placeholder="Add people by email"
              aria-label="Email address"
              onChange={(event) => setEmail(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
              className="h-9 min-w-0 flex-1 rounded-ds-xs bg-ds-surface-2 px-2.5 text-[13px] text-ds-text shadow-[inset_0_0_0_1px_var(--ds-hairline)] outline-none placeholder:text-ds-text-3 focus:shadow-[inset_0_0_0_1.5px_var(--ds-accent)]"
            />
            <Select label="Role" size="sm" className="w-28" value={role} onChange={(value) => setRole(value as Role)} options={ROLE_OPTIONS} />
            <Button type="submit" size="sm" disabled={busy === "invite" || !email.trim()} className="pc-press">
              {busy === "invite" ? <IconLoader2 className="size-4 motion-safe:animate-spin" /> : null}
              Invite
            </Button>
          </form>
        ) : null}

        <section aria-label="People with access" className="flex flex-col gap-1">
          <p className="ds-overline text-ds-text-3">People with access</p>
          {!data ? (
            <p className="py-2 text-xs text-ds-text-3">Loading…</p>
          ) : (
            <ul className="flex flex-col">
              {data.ownerEmail ? (
                <li className="flex items-center gap-2 py-1.5">
                  <Avatar label={data.ownerDisplayName || data.ownerEmail} />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ds-text">{data.ownerDisplayName || data.ownerEmail}</span>
                  <span className="text-xs text-ds-text-3">Owner</span>
                </li>
              ) : null}
              {people.map((share) => (
                <li key={share.id} className="flex items-center gap-2 py-1.5">
                  <Avatar label={share.displayName || share.principalId} />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ds-text" title={share.principalId}>
                    {share.displayName || share.principalId}
                  </span>
                  {canManage ? (
                    <>
                      <Select
                        label={`Role for ${share.principalId}`}
                        size="sm"
                        className="w-28"
                        value={share.role === "editor" || share.role === "admin" ? "editor" : "viewer"}
                        onChange={(value) => void run(share.id, "share-resource", { principalType: "user", principalId: share.principalId, role: value, notify: false })}
                        options={ROLE_OPTIONS}
                      />
                      <button
                        type="button"
                        aria-label={`Remove ${share.principalId}`}
                        disabled={busy === share.id}
                        onClick={() => void run(share.id, "unshare-resource", { principalType: "user", principalId: share.principalId }, "Access removed")}
                        className="pc-press flex size-7 items-center justify-center rounded-ds-xs text-ds-text-3 hover:bg-ds-surface-3 hover:text-ds-text"
                      >
                        <IconX className="size-4" />
                      </button>
                    </>
                  ) : (
                    <span className="text-xs text-ds-text-3">{share.role === "editor" ? "Can edit" : "Can view"}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="General access" className="flex flex-col gap-2">
          <p className="ds-overline text-ds-text-3">General access</p>
          <div className="flex items-start gap-3">
            <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full", visibility === "public" ? "bg-ds-accent/15 text-ds-accent" : "bg-ds-surface-2 text-ds-text-2")}>
              <AccessIcon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              {canManage ? (
                <Select
                  label="General access"
                  size="sm"
                  className="w-full max-w-64"
                  value={visibility}
                  onChange={(value) => void run("visibility", "set-resource-visibility", { visibility: value }, value === "public" ? "Anyone with the link can now watch" : value === "org" ? "Shared with your workspace" : "Only invited people can open it")}
                  options={accessOptions}
                />
              ) : (
                <p className="text-[13px] text-ds-text">{accessOptions.find((option) => option.value === visibility)?.label}</p>
              )}
              <p className="mt-1 text-xs leading-relaxed text-ds-text-3">
                {visibility === "public"
                  ? "Anyone with the link can watch the latest export, without signing in. Only invited people can open the edit."
                  : visibility === "org"
                    ? "Everyone in your workspace can open the project."
                    : "Only you and the people above can open it."}
              </p>
            </div>
          </div>
        </section>

        <div className="flex flex-wrap gap-2 border-t border-ds-hairline pt-3">
          {visibility === "public" ? (
            <Button size="sm" onClick={() => copy(watchLink, "View-only link")} className="pc-press">
              <IconCopy className="size-4" /> Copy view-only link
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => copy(editorLink, "Editor link")} className="pc-press">
            <IconCopy className="size-4" /> Copy editor link
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function Avatar({ label }: { label: string }) {
  return (
    <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ds-surface-3 text-[11px] font-semibold uppercase text-ds-text-2">
      {label.trim().charAt(0) || "?"}
    </span>
  );
}
