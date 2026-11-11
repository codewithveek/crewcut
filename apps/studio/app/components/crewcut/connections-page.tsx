import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { IconBrandYoutube, IconPlugConnected, IconRefresh, IconUnlink } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { errorMessage, formatAgo } from "@/lib/crewcut";
import { cn } from "@/lib/utils";

import { openUpgrade } from "./billing/upgrade";
import { type OwnKeyProvider, OwnKeyDialog, OwnKeyPicker, ProviderMark } from "./own-keys";
import { Panel, SkeletonLines } from "./primitives";

interface ConnectionsData {
  accounts: Array<{ id: string; provider: string; accountName: string; scopes: string[]; status: string; statusDetail: string; lastUsedAt: string | null; createdAt: string }>;
  platforms: Array<{ id: string; label: string; supported: boolean; auditNote: string; limitNote: string }>;
  youtubeConfigured: boolean;
  providers: OwnKeyProvider[];
  crewcutAi: { models: boolean; voice: boolean };
}

const STATUS_TONE: Record<string, string> = {
  healthy: "bg-supported/15 text-supported",
  expiring: "bg-weak/15 text-weak",
  failed: "bg-unsupported/15 text-unsupported",
  revoked: "bg-muted text-muted-foreground",
};

export function ConnectionsPage() {
  const [params, setParams] = useSearchParams();
  const query = useActionQuery("list-connections", {});
  const connect = useActionMutation("connect-account", { uiOnly: true });
  const disconnect = useActionMutation("disconnect-account", { uiOnly: true });
  const health = useActionMutation("refresh-health");
  const data = query.data as ConnectionsData | undefined;

  useEffect(() => {
    const connected = params.get("connected");
    const error = params.get("error");
    if (connected) toast.success(`${connected === "youtube" ? "YouTube" : connected} connected`);
    if (error) toast.error(error);
    // The plan's channel limit was reached while connecting: offer the plan that lifts it.
    const upgrade = params.get("upgrade");
    if (upgrade === "channels") openUpgrade("channels");
    if (connected || error || upgrade) setParams({}, { replace: true });
  }, [params, setParams]);
  const [keyFor, setKeyFor] = useState<OwnKeyProvider | null>(null);

  async function startYouTube() {
    try {
      const result = (await connect.mutateAsync({ provider: "youtube", origin: window.location.origin, returnTo: "/connections" } as never)) as { configured: boolean; url?: string; message?: string };
      if (!result.configured || !result.url) {
        toast.message(result.message ?? "YouTube isn't set up yet.");
        return;
      }
      window.location.assign(result.url);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-6 sm:px-6">
      <header>
        <h1 className="pc-display text-2xl text-foreground">Connections</h1>
        <p className="mt-1 text-sm text-muted-foreground">Accounts Crewcut can publish to and providers it can use. Sign-ins and keys are stored encrypted; disconnect any of them here in one click.</p>
      </header>

      <Panel
        title="Publishing accounts"
        description="Publishing always needs your click. Uploads go up private until you choose otherwise."
        actions={
          <Button size="sm" className="pc-press" onClick={() => void startYouTube()} disabled={connect.isPending}>
            <IconBrandYoutube className="size-4" />
            Connect YouTube
          </Button>
        }
      >
        {!data ? (
          <SkeletonLines count={2} />
        ) : data.accounts.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No accounts yet.{" "}
            {data.youtubeConfigured ? "Connect YouTube to publish privately and read analytics." : import.meta.env.DEV ? "Developer note: set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in apps/studio/.env to connect YouTube." : "YouTube isn't available here yet. It's on our side; nothing for you to set up."}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {data.accounts.map((account) => (
              <li key={account.id} className="flex flex-col gap-3 rounded-xl border border-border p-4 sm:flex-row sm:items-center">
                <IconBrandYoutube className="size-8 shrink-0 text-[#ff3d3d]" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-foreground">{account.accountName}</p>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_TONE[account.status] ?? STATUS_TONE.revoked)}>{account.status}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Last used {account.lastUsedAt ? formatAgo(account.lastUsedAt) : "never"}
                  </p>
                  {account.statusDetail ? <p className="mt-0.5 text-xs text-muted-foreground">{account.statusDetail}</p> : null}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="pc-press"
                    disabled={health.isPending}
                    onClick={async () => {
                      try {
                        const result = (await health.mutateAsync({ connectionId: account.id } as never)) as { status: string; detail?: string };
                        if (result.status === "healthy") toast.success("Connection is healthy");
                        else toast.error(result.detail ?? "Connection failed");
                      } catch (error) {
                        toast.error(errorMessage(error));
                      }
                    }}
                  >
                    <IconRefresh className="size-4" />
                    Check
                  </Button>
                  <Button size="sm" variant="outline" className="pc-press" onClick={() => void startYouTube()}>
                    Reconnect
                  </Button>
                  <Button
                    size="sm"
                    variant="outline-destructive"
                    className="pc-press"
                    disabled={disconnect.isPending}
                    onClick={async () => {
                      try {
                        await disconnect.mutateAsync({ connectionId: account.id } as never);
                        toast.success("Disconnected and revoked");
                      } catch (error) {
                        toast.error(errorMessage(error));
                      }
                    }}
                  >
                    <IconUnlink className="size-4" />
                    Disconnect
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="AI providers"
        description={
          data?.crewcutAi.models
            ? "The crew runs on Crewcut AI and uses your credits. Add your own key for any provider below and the crew uses it instead: it goes straight to that provider, costs no credits, and they bill you."
            : "Add a key for any provider below and the crew uses it: it goes straight to that provider and they bill you. Keys are stored encrypted."
        }
        actions={data ? <OwnKeyPicker providers={data.providers} onPick={setKeyFor} /> : null}
      >
        {!data ? (
          <SkeletonLines count={3} />
        ) : (
          <>
            <p className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                Crewcut AI for the crew: <strong className="text-foreground">{data.crewcutAi.models ? "on" : "off"}</strong>
              </span>
              <span>
                Crewcut voice-overs: <strong className="text-foreground">{data.crewcutAi.voice ? "on" : "off"}</strong>
                {data.crewcutAi.voice ? "" : " (add an ElevenLabs key for narration)"}
              </span>
            </p>
            {data.providers.some((provider) => provider.ownKey) ? (
              <ul className="flex flex-col gap-2">
                {data.providers
                  .filter((provider) => provider.ownKey)
                  .map((provider) => (
                    <li key={provider.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
                      <ProviderMark id={provider.id} name={provider.name} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-medium text-foreground">{provider.name}</p>
                        <p className="text-xs text-muted-foreground">{provider.kind === "voice" ? "Your key: voice-overs cost no credits." : "Your key: used instead of Crewcut AI, no credits."}</p>
                      </div>
                      <Button size="sm" variant="outline" className="pc-press shrink-0" onClick={() => setKeyFor(provider)}>
                        Manage
                      </Button>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="rounded-xl border border-dashed border-border p-4 text-[13px] text-muted-foreground">
                No keys of your own yet. {data.crewcutAi.models ? "That's fine: the crew runs on Crewcut AI. Add a key only if you'd rather pay a provider directly." : "Add one to start working with the crew."}
              </p>
            )}
            <p className="mt-3 text-[11px] text-muted-foreground">
              With several keys, pick which one the crew uses under{" "}
              <a href="/settings/model" className="underline underline-offset-2">
                AI model
              </a>
              . <span className="whitespace-nowrap">Usage and credits: Plan &amp; credits.</span>
            </p>
          </>
        )}
      </Panel>

      <OwnKeyDialog provider={keyFor} onClose={() => setKeyFor(null)} onChanged={() => void query.refetch()} />

      <Panel title="Platforms" description="What each platform requires before public posting works, and the limits the publish agent checks before exporting.">
        <ul className="flex flex-col divide-y divide-border">
          {(data?.platforms ?? []).map((platform) => (
            <li key={platform.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
              <div className="flex w-40 shrink-0 items-center gap-2">
                <IconPlugConnected className={cn("size-4", platform.supported ? "text-supported" : "text-muted-foreground")} />
                <span className="text-[13px] font-medium text-foreground">{platform.label}</span>
              </div>
              <div className="min-w-0 flex-1 text-xs text-muted-foreground">
                <p>{platform.auditNote}</p>
                <p className="mt-0.5">{platform.limitNote}</p>
              </div>
              <span className={cn("shrink-0 self-start rounded-full px-2 py-0.5 text-[11px]", platform.supported ? "bg-supported/15 text-supported" : "bg-muted text-muted-foreground")}>
                {platform.supported ? "Available" : "Phase 1"}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
