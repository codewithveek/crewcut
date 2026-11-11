import { callAction } from "@agent-native/core/client/hooks";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button, EmptyState, SkeletonLines } from "@/components/ds";
import { errorMessage, formatAgo } from "@/lib/crewcut";

/**
 * Admin → Data requests: people who asked for a copy of their data or for it
 * to be deleted (Settings → Security). Each stays here until an admin marks
 * it answered, so none can be forgotten; the operator is also emailed once
 * per request.
 */

interface PrivacyRequest {
  email: string;
  type: "access" | "deletion";
  requestedAt: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function PrivacyRequestsSection() {
  // A people-only action (it returns other people's email addresses), so it's called directly, never cached as a query.
  const [requests, setRequests] = useState<PrivacyRequest[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async (resolve?: { email: string; type: PrivacyRequest["type"] }) => {
    const result = (await callAction("list-privacy-requests" as never, (resolve ? { resolve } : {}) as never)) as { requests: PrivacyRequest[] };
    setRequests(result.requests);
    setFailure(null);
  }, []);
  useEffect(() => {
    load().catch((error: unknown) => setFailure(errorMessage(error)));
  }, [load]);

  const resolve = async (request: PrivacyRequest) => {
    const id = `${request.email}|${request.type}`;
    setBusy(id);
    try {
      await load({ email: request.email, type: request.type });
      toast.success("Marked as answered");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  if (failure) return <EmptyState title="Couldn't load data requests">{failure}</EmptyState>;
  if (!requests) return <SkeletonLines count={3} />;
  if (requests.length === 0) return <EmptyState title="No data requests waiting">When someone asks for a copy of their data or to have it deleted, it shows here until you've answered it.</EmptyState>;

  return (
    <section className="flex flex-col gap-3" aria-label="Data requests">
      <p className="text-[13px] text-ds-text-2">Answer each within 30 days, as the Privacy Policy promises, then mark it answered. Marking doesn't send or delete anything by itself.</p>
      <ul className="flex flex-col divide-y divide-ds-border rounded-ds-lg bg-ds-surface shadow-[inset_0_0_0_1px_var(--ds-hairline)]">
        {requests.map((request) => {
          const id = `${request.email}|${request.type}`;
          const daysLeft = 30 - Math.floor((Date.now() - Date.parse(request.requestedAt)) / DAY_MS);
          return (
            <li key={id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium text-ds-text">{request.email}</p>
                <p className="text-[12px] text-ds-text-2">
                  {request.type === "deletion" ? "Delete my data" : "Send me a copy of my data"} · asked {formatAgo(request.requestedAt)} ·{" "}
                  <span className={daysLeft <= 7 ? "font-medium text-ds-danger" : undefined}>{daysLeft > 0 ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left` : "overdue"}</span>
                </p>
              </div>
              <Button size="sm" variant="outline" className="pc-press" disabled={busy === id} onClick={() => void resolve(request)}>
                Mark answered
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
