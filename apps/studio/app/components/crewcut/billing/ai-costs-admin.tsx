import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { IconBolt, IconRefresh } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button, Segmented, SkeletonLines } from "@/components/ds";
import { errorMessage, formatAgo } from "@/lib/crewcut";
import { cn } from "@/lib/utils";

/**
 * Admin "AI costs": what Crewcut AI and voice-overs really cost, per model,
 * per pipeline stage and per video, so credit prices are set from measured
 * runs. Also shows how Crewcut AI is set up and can test the gateway.
 */

interface Report {
  days: number;
  setup: {
    gateway: { accountId: string; gatewayId: string; keyAlias: string | null } | null;
    providers: Array<{ id: string; label: string; enabled: boolean; keySource: string }>;
    defaultModel: string | null;
    models: Array<{ id: string; provider: string; label: string; tier: string; inputPerMTok: number; outputPerMTok: number; cacheReadPerMTok: number; priceSource: string; enabled: boolean }>;
    voice: { crewcutKey: boolean; usdPerThousandChars: number };
    credits: { creditUsd: number; markup: number; plans: Array<{ id: string; name: string; monthlyCredits: number; maxCostUsd: number }> };
  };
  totals: Array<{ source: string; kind: string; calls: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; characters: number; costUsd: number; credits: number; errors: number }>;
  byModel: Array<{ source: string; provider: string; model: string; kind: string; calls: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; characters: number; costUsd: number; credits: number; errors: number }>;
  byStage: Array<{ stage: string; calls: number; videos: number; costUsd: number; avgPerVideoUsd: number | null; credits: number }>;
  perVideo: { count: number; averageUsd: number; medianUsd: number; maxUsd: number };
  videos: Array<{ videoId: string | null; title: string; autopilot: boolean; calls: number; costUsd: number; voiceUsd: number; credits: number; renderJobs: number; renderSeconds: number; stages: Record<string, number>; last: string }>;
  recent: Array<{ id: string; at: string; source: string; kind: string; model: string; stage: string; videoId: string | null; inputTokens: number; outputTokens: number; cacheReadTokens: number; characters: number; costUsd: number; credits: number; durationMs: number; error: string | null; workspace: string }>;
}

const SOURCE_LABEL: Record<string, string> = { managed: "Crewcut AI", byok: "Own keys", deployment: "Server key (dev)" };
const usd = (value: number) => (value === 0 ? "$0" : value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`);
const count = (value: number) => (value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value));

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-ds-md bg-ds-surface p-3 shadow-[inset_0_0_0_1px_var(--ds-hairline)]">
      <span className="text-[12px] text-ds-text-2">{label}</span>
      <span className="pc-display text-xl tabular-nums text-ds-text">{value}</span>
      {hint ? <span className="text-[11px] text-ds-text-3">{hint}</span> : null}
    </div>
  );
}

function Table({ head, rows, empty, compact }: { head: string[]; rows: React.ReactNode[][]; empty: string; compact?: boolean }) {
  if (rows.length === 0) return <p className="text-[13px] text-ds-text-3">{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-ds-md shadow-[inset_0_0_0_1px_var(--ds-hairline)]">
      <table className={cn("w-full text-left text-[12px]", compact ? "min-w-[360px]" : "min-w-[560px]")}>
        <thead className="bg-ds-surface-2 text-ds-text-2">
          <tr>
            {head.map((cell, index) => (
              <th key={cell} className={cn("px-3 py-2 font-medium", index > 0 && "text-right")}>
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-t border-[var(--ds-hairline)]">
              {row.map((cell, index) => (
                <td key={index} className={cn("px-3 py-2 text-ds-text", index > 0 && "text-right tabular-nums")}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AiCostsSection() {
  const [days, setDays] = useState("30");
  const query = useActionQuery("get-ai-costs", { days: Number(days) } as never);
  const report = query.data as Report | undefined;
  const [testing, setTesting] = useState(false);

  const test = async (model?: string) => {
    setTesting(true);
    try {
      const result = (await callAction("test-crewcut-ai" as never, (model ? { model } : {}) as never)) as { ok: boolean; model: string; reply: string; error: string | null; ms: number; costUsd: number };
      if (result.ok) toast.success(`${result.model} answered in ${(result.ms / 1000).toFixed(1)} s for ${usd(result.costUsd)}: “${result.reply}”`);
      else toast.error(`${result.model}: ${result.error ?? "no reply"}`);
      void query.refetch();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setTesting(false);
    }
  };

  if (!report) return <SkeletonLines count={6} />;
  const managed = report.totals.filter((row) => row.source === "managed");
  const managedCost = managed.reduce((sum, row) => sum + row.costUsd, 0);
  const managedCredits = managed.reduce((sum, row) => sum + row.credits, 0);
  const ownCost = report.totals.filter((row) => row.source !== "managed").reduce((sum, row) => sum + row.costUsd, 0);
  const calls = report.totals.reduce((sum, row) => sum + row.calls, 0);

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-[13px] text-ds-text-2">
          Every Crewcut AI call and voice-over, with what it cost us. Make ~20 real videos, then set credit prices from the per-video and per-stage numbers below. Calls on people's own keys are shown for comparison and never charged.
        </p>
        <div className="flex items-center gap-2">
          <Segmented size="sm" ariaLabel="Period" value={days} onChange={setDays} options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />
          <Button size="sm" variant="outline" className="pc-press" onClick={() => void query.refetch()} aria-label="Refresh">
            <IconRefresh className="size-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Crewcut AI cost" value={usd(managedCost)} hint={`${count(managedCredits)} credits charged`} />
        <Stat label="Average per video" value={usd(report.perVideo.averageUsd)} hint={`median ${usd(report.perVideo.medianUsd)} · ${report.perVideo.count} videos`} />
        <Stat label="Most expensive video" value={usd(report.perVideo.maxUsd)} />
        <Stat label="All calls" value={count(calls)} hint={`own keys: ${usd(ownCost)}`} />
      </div>

      <div className="flex flex-col gap-2 rounded-ds-md bg-ds-surface-2 p-3 shadow-[inset_0_0_0_1px_var(--ds-hairline)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] text-ds-text">
            {report.setup.gateway ? (
              <>
                Cloudflare AI Gateway <code className="font-mono">{report.setup.gateway.gatewayId}</code> · default model <code className="font-mono">{report.setup.defaultModel ?? "none"}</code>
              </>
            ) : (
              "Crewcut AI is off: no Cloudflare AI Gateway settings. People need their own keys."
            )}
          </p>
          <Button size="sm" className="pc-press" disabled={!report.setup.gateway || testing} onClick={() => void test()}>
            <IconBolt className="size-4" /> {testing ? "Testing…" : "Test Crewcut AI"}
          </Button>
        </div>
        <ul className="flex flex-wrap gap-1.5">
          {report.setup.providers.map((provider) => (
            <li key={provider.id} className={cn("rounded-full px-2 py-0.5 text-[11px]", provider.enabled ? "bg-ds-surface text-ds-text shadow-[inset_0_0_0_1px_var(--ds-hairline)]" : "text-ds-text-3 line-through")} title={provider.keySource}>
              {provider.label}
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-ds-text-3">
          1 credit = ${report.setup.credits.creditUsd} at top-up prices; calls cost {report.setup.credits.markup}× what we pay. At most a month's credits cost us: {report.setup.credits.plans.map((plan) => `${plan.name} ${usd(plan.maxCostUsd)}`).join(" · ")}. Voice: {report.setup.voice.crewcutKey ? `Crewcut's ElevenLabs key, ${usd(report.setup.voice.usdPerThousandChars)} per 1,000 characters` : "no Crewcut key (own keys only)"}.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="pc-display text-[15px] text-ds-text">Per video</h3>
        <Table
          head={["Video", "Calls", "AI", "Voice", "Credits", "Export time", "Last"]}
          empty="No videos with AI use in this period yet."
          rows={report.videos.map((video) => [
            <span key="t" className="flex flex-col">
              <span className="truncate font-medium">{video.title}</span>
              <span className="truncate text-[11px] text-ds-text-3">
                {Object.entries(video.stages)
                  .sort((a, b) => b[1] - a[1])
                  .map(([stage, cost]) => `${stage} ${usd(cost)}`)
                  .join(" · ")}
                {video.autopilot ? " · autopilot" : ""}
              </span>
            </span>,
            video.calls,
            usd(video.costUsd - video.voiceUsd),
            usd(video.voiceUsd),
            count(video.credits),
            video.renderJobs ? `${Math.round(video.renderSeconds / 60)} min (${video.renderJobs})` : "—",
            formatAgo(video.last),
          ])}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="pc-display text-[15px] text-ds-text">By stage</h3>
          <Table compact head={["Stage", "Calls", "Videos", "Cost", "Per video"]} empty="Nothing yet." rows={report.byStage.map((row) => [row.stage, row.calls, row.videos, usd(row.costUsd), row.avgPerVideoUsd === null ? "—" : usd(row.avgPerVideoUsd)])} />
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="pc-display text-[15px] text-ds-text">By model</h3>
          <Table
            compact
            head={["Model", "Calls", "In / cached / out", "Cost"]}
            empty="Nothing yet."
            rows={report.byModel.map((row) => [
              <span key="m" className="flex flex-col">
                <span className="font-mono">{row.model}</span>
                <span className="text-[11px] text-ds-text-3">
                  {SOURCE_LABEL[row.source] ?? row.source}
                  {row.errors ? ` · ${row.errors} failed` : ""}
                </span>
              </span>,
              row.calls,
              row.kind === "voice"
                ? `${count(row.characters)} characters`
                : row.kind === "transcription"
                  ? `${count(row.characters)} s of audio`
                  : `${count(row.inputTokens)} / ${count(row.cacheReadTokens)} / ${count(row.outputTokens)}`,
              usd(row.costUsd),
            ])}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="pc-display text-[15px] text-ds-text">Latest calls</h3>
        <Table
          head={["When", "Source", "Model", "Stage", "Tokens / chars", "Cost", "Credits"]}
          empty="No calls yet."
          rows={report.recent.map((row) => [
            <span key="w" title={row.error ?? undefined} className={cn(row.error && "text-[#b42318] dark:text-[#ff8a80]")}>
              {formatAgo(row.at)}
              {row.error ? " · failed" : ""}
            </span>,
            SOURCE_LABEL[row.source] ?? row.source,
            <span key="m" className="font-mono">{row.model}</span>,
            row.stage,
            row.kind === "voice" ? `${count(row.characters)} ch` : row.kind === "transcription" ? `${count(row.characters)} s audio` : `${count(row.inputTokens)} / ${count(row.outputTokens)}`,
            usd(row.costUsd),
            row.credits ? row.credits.toFixed(2) : "—",
          ])}
        />
      </div>

      <details className="rounded-ds-md bg-ds-surface p-3 shadow-[inset_0_0_0_1px_var(--ds-hairline)]">
        <summary className="cursor-pointer text-[13px] font-medium text-ds-text">Models and prices</summary>
        <div className="mt-3">
          <Table
            head={["Model", "Input $/M", "Cached $/M", "Output $/M", "Price from"]}
            empty="No models."
            rows={report.setup.models.map((model) => [
              <span key="m" className={cn("font-mono", !model.enabled && "text-ds-text-3")}>
                {model.id}
                {model.id === report.setup.defaultModel ? " (default)" : ""}
              </span>,
              model.inputPerMTok,
              model.cacheReadPerMTok,
              model.outputPerMTok,
              model.priceSource,
            ])}
          />
          <p className="mt-2 text-[11px] text-ds-text-3">Change models and prices without a deploy with CREWCUT_AI_MODELS, CREWCUT_AI_PROVIDERS and CREWCUT_AI_DEFAULT_MODEL; credit pricing with CREWCUT_CREDIT_USD and CREWCUT_CREDIT_MARKUP.</p>
        </div>
      </details>
    </section>
  );
}
