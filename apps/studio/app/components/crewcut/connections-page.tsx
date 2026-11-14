import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import {
  IconBrandBluesky,
  IconBrandFacebook,
  IconBrandInstagram,
  IconBrandLinkedin,
  IconBrandPinterest,
  IconBrandThreads,
  IconBrandTiktok,
  IconBrandX,
  IconBrandYoutube,
  IconPlugConnected,
  IconRefresh,
  IconUnlink,
} from "@tabler/icons-react";
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
  /** Google's YouTube API audit has passed: uploads can be unlisted or public. */
  youtubePublicUploads?: boolean;
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
        description={
          data && !data.youtubePublicUploads
            ? "Publishing always needs your click. For now YouTube keeps uploads from Crewcut private."
            : "Publishing always needs your click. Uploads go up private until you choose otherwise."
        }
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
            {data.youtubeConfigured ? "Connect YouTube to publish and read how your videos do." : import.meta.env.DEV ? "Developer note: set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in apps/studio/.env to connect YouTube." : "YouTube isn't available here yet. It's on our side; nothing for you to set up."}
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

      <Panel title="Where Crewcut can post" description="Crewcut uploads for you when you click Publish. More platforms are on the way.">
        {!data ? <SkeletonLines count={2} /> : <PostingPlatforms data={data} connecting={connect.isPending} onConnect={() => void startYouTube()} />}
      </Panel>
    </div>
  );
}

const PLATFORM_ICONS: Record<string, typeof IconBrandX> = {
  tiktok: IconBrandTiktok,
  instagram_reels: IconBrandInstagram,
  facebook_reels: IconBrandFacebook,
  x: IconBrandX,
  linkedin: IconBrandLinkedin,
  threads: IconBrandThreads,
  pinterest: IconBrandPinterest,
  bluesky: IconBrandBluesky,
};

type YouTubeState = "connected" | "attention" | "disconnected" | "unavailable";

const YOUTUBE_BADGE: Record<YouTubeState, { label: string; tone: string }> = {
  connected: { label: "Connected", tone: "bg-supported/15 text-supported" },
  attention: { label: "Needs reconnecting", tone: "bg-weak/15 text-weak" },
  disconnected: { label: "Not connected", tone: "bg-muted text-muted-foreground" },
  unavailable: { label: "Not available here", tone: "bg-muted text-muted-foreground" },
};

/**
 * Where publishing works today (YouTube, with this person's own state) and
 * the platforms that are coming. The platforms' audit and quota notes are for
 * the publish agent, not for people, so they aren't shown here.
 */
function PostingPlatforms({ data, connecting, onConnect }: { data: ConnectionsData; connecting: boolean; onConnect: () => void }) {
  const account = data.accounts.find((item) => item.provider === "youtube" && item.status !== "revoked");
  const state: YouTubeState = !data.youtubeConfigured ? "unavailable" : !account ? "disconnected" : account.status === "failed" ? "attention" : "connected";
  const badge = YOUTUBE_BADGE[state];
  const comingSoon = data.platforms.filter((platform) => !platform.supported);

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 gap-3">
          <IconBrandYoutube className="size-6 shrink-0 text-[#ff3d3d]" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[14px] font-medium text-foreground">YouTube</p>
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", badge.tone)}>{badge.label}</span>
            </div>
            {state === "unavailable" ? (
              <p className="mt-0.5 text-xs text-muted-foreground">YouTube isn't available here yet. It's on our side; nothing for you to set up.</p>
            ) : (
              <>
                <p className="mt-0.5 text-xs text-muted-foreground">Videos and Shorts. Vertical or square videos up to 3 minutes go up as Shorts.</p>
                {data.youtubePublicUploads ? null : (
                  <p className="mt-0.5 text-xs text-muted-foreground">For now YouTube keeps uploads from Crewcut private. Make them public in YouTube Studio.</p>
                )}
              </>
            )}
          </div>
        </div>
        {state === "disconnected" || state === "attention" ? (
          <Button size="sm" variant={state === "attention" ? "outline" : "default"} className="pc-press ml-9 shrink-0 self-start sm:ml-0" onClick={onConnect} disabled={connecting}>
            {state === "attention" ? "Reconnect" : "Connect"}
          </Button>
        ) : null}
      </div>

      {comingSoon.length > 0 ? (
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-[13px] font-medium text-foreground">Coming soon</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Crewcut can't post to these yet. Export a vertical (9:16) video, which all of them accept, and upload it in their app.</p>
          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {comingSoon.map((platform) => {
              const Icon = PLATFORM_ICONS[platform.id] ?? IconPlugConnected;
              return (
                <li key={platform.id} className="flex min-w-0 items-center gap-2 rounded-lg border border-border px-3 py-2 text-[13px] text-foreground">
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">{platform.label}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </>
  );
}
