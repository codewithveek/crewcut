import { useActionQuery } from "@agent-native/core/client/hooks";
import type { ClaimVerdict } from "@proofcut/contracts";
import { IconArrowLeft, IconExternalLink, IconPrinter, IconRobot, IconUser } from "@tabler/icons-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { STAGE_LABELS, formatAgo } from "@/lib/proofcut";
import { cn } from "@/lib/utils";

import { ProofcutMark, SkeletonLines, VerdictBadge } from "./primitives";

interface ProofReport {
  video: { id: string; title: string; ratio: string; status: string; isDemo: boolean; createdAt: string };
  summary: {
    claims: number;
    supported: number;
    weak: number;
    unsupported: number;
    overridden: number;
    verifiedFacts: number;
    facts: number;
    humanDecisions: number;
    scriptVersions: number;
    humanScriptEdits: number;
    compositionEdits: { human: number; agent: number };
  };
  claims: Array<{
    lineId: string;
    text: string;
    verdict: ClaimVerdict;
    overrideReason: string | null;
    overriddenBy: string | null;
    evidence: Array<{ factId: string; quote: string; verified: boolean; lines: string | null; source: { title: string; url: string | null; publisher: string | null } | null }>;
  }>;
  decisions: Array<{ id: string; stage: keyof typeof STAGE_LABELS; actorKind: string; actor: string; decision: string; reason?: string; subject?: string; createdAt: string }>;
  assets: Array<{ id: string; kind: string; label: string; licence: string; commercialUse: boolean; aiGenerated: boolean; provider: string }>;
  aiDisclosure: { script: string; visuals: string; voice: string };
  sources: Array<{ id: string; title: string; url: string | null; publisher: string | null; retrievedAt: string; redactions: number }>;
  published: Array<{ platform: string; url: string | null; privacy: string; approvedBy: string | null; approvedAt: string | null }>;
  generatedAt: string;
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "good" | "warn" | "bad" }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-border p-3">
      <span className={cn("tabular text-xl font-semibold", tone === "good" ? "text-supported" : tone === "warn" ? "text-weak" : tone === "bad" ? "text-unsupported" : "text-foreground")}>{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

export function ProofReportPage({ videoId }: { videoId: string }) {
  const query = useActionQuery("get-proof-report", { videoId } as never);
  const report = query.data as ProofReport | undefined;
  if (!report) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <SkeletonLines count={8} />
      </div>
    );
  }
  const humanDecisions = report.decisions.filter((decision) => decision.actorKind === "human");
  return (
    <article className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-6 sm:px-6 print:max-w-none print:py-0">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to={`/videos/${videoId}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground print:hidden">
            <IconArrowLeft className="size-3.5" /> Pipeline
          </Link>
          <p className="mt-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <ProofcutMark className="size-4" /> Proof report
          </p>
          <h1 className="pc-display mt-1 text-2xl text-foreground sm:text-3xl">{report.video.title}</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Generated {new Date(report.generatedAt).toLocaleString()} · {report.video.ratio}
            {report.video.isDemo ? " · demo data" : ""}
          </p>
        </div>
        <Button variant="outline" className="pc-press print:hidden" onClick={() => window.print()}>
          <IconPrinter className="size-4" />
          Print or save PDF
        </Button>
      </header>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="claims supported" value={`${report.summary.supported}/${report.summary.claims}`} tone={report.summary.unsupported > 0 ? "bad" : "good"} />
        <Stat label="facts verified against sources" value={`${report.summary.verifiedFacts}/${report.summary.facts}`} tone={report.summary.verifiedFacts === report.summary.facts ? "good" : "warn"} />
        <Stat label="human decisions" value={report.summary.humanDecisions} />
        <Stat label="edits (human / agent)" value={`${report.summary.compositionEdits.human} / ${report.summary.compositionEdits.agent}`} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="pc-display text-lg text-foreground">Claims and their sources</h2>
        {report.claims.length === 0 ? (
          <p className="text-sm text-muted-foreground">No audited claims yet.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {report.claims.map((claim) => (
              <li key={claim.lineId} className="break-inside-avoid rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-[15px] leading-relaxed text-foreground">
                    <span className="mr-2 font-mono text-xs text-muted-foreground">{claim.lineId.toUpperCase()}</span>“{claim.text}”
                  </p>
                  <VerdictBadge verdict={claim.verdict} overridden={Boolean(claim.overrideReason)} />
                </div>
                {claim.overrideReason ? (
                  <p className="mt-2 text-xs text-weak">
                    Overridden by {claim.overriddenBy}: {claim.overrideReason}
                  </p>
                ) : null}
                {claim.evidence.length > 0 ? (
                  <ul className="mt-3 flex flex-col gap-2">
                    {claim.evidence.map((evidence) => (
                      <li key={evidence.factId} className="border-l-2 border-supported/50 pl-3 text-xs">
                        <p className="text-muted-foreground">“{evidence.quote}”</p>
                        <p className="mt-0.5 text-foreground">
                          {evidence.source?.url ? (
                            <a href={evidence.source.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 underline-offset-2 hover:underline">
                              {evidence.source.title} <IconExternalLink className="size-3" />
                            </a>
                          ) : (
                            (evidence.source?.title ?? "Unknown source")
                          )}
                          {evidence.lines ? <span className="text-muted-foreground"> · lines {evidence.lines}</span> : null}
                          <span className={evidence.verified ? "text-supported" : "text-unsupported"}> · {evidence.verified ? "quote verified" : "quote not found"}</span>
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-unsupported">No source cited.</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="pc-display text-lg text-foreground">Human decisions</h2>
        <ol className="flex flex-col divide-y divide-border rounded-xl border border-border">
          {humanDecisions.map((decision) => (
            <li key={decision.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 p-3 text-[13px]">
              <IconUser className="size-3.5 self-center text-muted-foreground" />
              <span className="font-medium text-foreground">{decision.actor}</span>
              <span className="text-foreground">{decision.decision.replace("_", " ")}</span>
              <span className="text-muted-foreground">{STAGE_LABELS[decision.stage]?.agent ?? decision.stage}</span>
              {decision.subject ? <span className="text-muted-foreground">· {decision.subject}</span> : null}
              {decision.reason ? <span className="basis-full pl-5 text-xs text-muted-foreground">{decision.reason}</span> : null}
              <span className="ml-auto text-[11px] text-muted-foreground">{formatAgo(decision.createdAt)}</span>
            </li>
          ))}
          {humanDecisions.length === 0 ? <li className="p-3 text-sm text-muted-foreground">No decisions yet.</li> : null}
        </ol>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="pc-display text-lg text-foreground">What AI made</h2>
        <ul className="flex flex-col gap-2 text-[13px]">
          {Object.entries(report.aiDisclosure).map(([key, value]) => (
            <li key={key} className="flex gap-2">
              <IconRobot className="mt-0.5 size-4 shrink-0 text-pc-accent" />
              <span>
                <span className="font-medium capitalize text-foreground">{key}:</span> <span className="text-muted-foreground">{value}</span>
              </span>
            </li>
          ))}
        </ul>
        {report.assets.length > 0 ? (
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 font-medium">Asset</th>
                <th className="py-1 font-medium">Kind</th>
                <th className="py-1 font-medium">Provider</th>
                <th className="py-1 font-medium">Licence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.assets.map((asset) => (
                <tr key={asset.id}>
                  <td className="py-1.5 text-foreground">{asset.label}</td>
                  <td className="py-1.5">{asset.kind}{asset.aiGenerated ? " · AI" : ""}</td>
                  <td className="py-1.5">{asset.provider}</td>
                  <td className={cn("py-1.5", !asset.commercialUse && "text-unsupported")}>{asset.licence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="pc-display text-lg text-foreground">Sources</h2>
        <ul className="flex flex-col gap-1.5 text-[13px]">
          {report.sources.map((source) => (
            <li key={source.id}>
              {source.url ? (
                <a href={source.url} target="_blank" rel="noreferrer noopener" className="text-foreground underline-offset-2 hover:underline">
                  {source.title}
                </a>
              ) : (
                <span className="text-foreground">{source.title}</span>
              )}
              <span className="text-xs text-muted-foreground">
                {source.publisher ? ` · ${source.publisher}` : ""} · retrieved {new Date(source.retrievedAt).toLocaleDateString()}
                {source.redactions ? ` · ${source.redactions} secrets redacted` : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {report.published.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="pc-display text-lg text-foreground">Published</h2>
          {report.published.map((post, index) => (
            <p key={index} className="text-[13px] text-muted-foreground">
              {post.platform} ({post.privacy}) · approved by {post.approvedBy}{" "}
              {post.url ? (
                <a href={post.url} target="_blank" rel="noreferrer noopener" className="text-foreground underline-offset-2 hover:underline">
                  {post.url}
                </a>
              ) : null}
            </p>
          ))}
        </section>
      ) : null}
    </article>
  );
}
