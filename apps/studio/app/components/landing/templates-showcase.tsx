import { type AspectRatio, type Composition, buildTemplate, getTemplate } from "@crewcut/composition";
import { IconArrowRight, IconPlayerPlay, IconX } from "@tabler/icons-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";

import { LANDING_TEMPLATES, type LandingTemplate } from "./landing-media";
import { useHydrated, useInView, usePrefersReducedMotion } from "./use-landing";

const LandingPlayer = lazy(() => import("./landing-player"));

/** Opens that template in the app (signed-out visitors sign up first, then land on it). */
export const templateHref = (template: LandingTemplate) => `/templates?template=${encodeURIComponent(template.id)}`;
/** The public gallery with this template's preview open: works even before the page's scripts load. */
export const previewHref = (template: LandingTemplate) => `/gallery?preview=${encodeURIComponent(template.id)}`;

function buildPreview(template: LandingTemplate, ratio: AspectRatio): Composition | null {
  const definition = getTemplate(template.id);
  return definition ? buildTemplate(definition, { id: `landing-${template.id}-${ratio}`, ratio, values: template.previews[ratio]?.values ?? {} }) : null;
}

/** Real templates, built in the browser from the same definitions the app uses. Each plays while hovered. */
export function TemplatesShowcase() {
  const gridRef = useRef<HTMLUListElement>(null);
  const near = useInView(gridRef, { once: true, rootMargin: "300px 0px" });
  const hydrated = useHydrated();
  const [previewing, setPreviewing] = useState<LandingTemplate | null>(null);
  return (
    <section id="templates" className="lp-templates" aria-labelledby="templates-title">
      <div className="lp-wrap">
        <div className="lp-templates-head">
          <div>
            <h2 id="templates-title" className="lp-h2">
              Templates that fit
              <br />
              every screen.
            </h2>
            <p className="lp-body">Pick a design, swap in your words and photos, and get it in 9:16, 1:1 and 16:9. The music and stock photos come licensed and credited.</p>
          </div>
          <a href="/gallery" className="lp-view-all">
            View all
            <IconArrowRight aria-hidden />
          </a>
        </div>
        <ul ref={gridRef} className="lp-template-grid">
          {LANDING_TEMPLATES.map((template, index) => (
            <TemplateCard key={template.id} template={template} index={index} mount={hydrated && near} onPreview={() => setPreviewing(template)} />
          ))}
        </ul>
      </div>
      <PreviewDialog template={previewing} onClose={() => setPreviewing(null)} />
    </section>
  );
}

export function TemplateCard({ template, index, mount, onPreview, ratio = "9:16" }: { template: LandingTemplate; index: number; mount: boolean; onPreview: () => void; ratio?: AspectRatio }) {
  const [active, setActive] = useState(false);
  const reduced = usePrefersReducedMotion();
  const composition = useMemo(() => buildPreview(template, ratio), [template, ratio]);
  const poster = template.previews[ratio]?.values["photo-1"];
  // Rest on a frame where the title is on screen, not the black first frame.
  const restFrame = composition ? Math.round(((composition.durationMs * 0.22) / 1000) * composition.fps) : 0;
  return (
    <li
      className="lp-template"
      style={{ "--i": index } as React.CSSProperties}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActive(false);
      }}
    >
      <div className="lp-template-screen" style={{ aspectRatio: ratio.replace(":", " / ") }}>
        {poster ? <img src={poster} alt="" loading="lazy" decoding="async" className="lp-template-poster" /> : null}
        {mount && composition ? (
          <Suspense fallback={null}>
            <LandingPlayer composition={composition} playing={active && !reduced} initialFrame={restFrame} label={`${template.name} template preview`} />
          </Suspense>
        ) : null}
        {/* Slides up on hover or keyboard focus; always shown on touch screens. */}
        <div className="lp-template-cta">
          <a
            href={previewHref(template)}
            className="lp-cta-btn lp-cta-ghost"
            aria-label={`Preview ${template.name}`}
            onClick={(event) => {
              event.preventDefault();
              onPreview();
            }}
          >
            <IconPlayerPlay aria-hidden />
            Preview
          </a>
          <a href={templateHref(template)} className="lp-cta-btn lp-cta-primary" aria-label={`Use the ${template.name} template`}>
            Use template
          </a>
        </div>
      </div>
      <p className="lp-template-name">{template.name}</p>
      <p className="lp-template-meta">
        {template.category} · {template.ratios.length} sizes
      </p>
    </li>
  );
}

/** A bigger preview on the landing page itself: no sign-in needed, every frame shape the template has. */
export function PreviewDialog({ template, onClose, initialRatio }: { template: LandingTemplate | null; onClose: () => void; initialRatio?: AspectRatio | null }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [ratio, setRatio] = useState<AspectRatio>("9:16");
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (template) {
      setRatio(initialRatio && template.ratios.includes(initialRatio) ? initialRatio : template.ratios.includes("9:16") ? "9:16" : (template.ratios[0] ?? "9:16"));
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) dialog.close();
  }, [template]);
  const composition = useMemo(() => (template ? buildPreview(template, ratio) : null), [template, ratio]);
  return (
    <dialog
      ref={ref}
      className="lp-preview"
      aria-labelledby="lp-preview-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {template ? (
        <div className="lp-preview-body">
          <div className="lp-preview-stage">
            <div className="lp-preview-screen" data-ratio={ratio}>
              {composition ? (
                <Suspense fallback={null}>
                  <LandingPlayer key={ratio} composition={composition} playing label={`${template.name} in ${ratio}`} />
                </Suspense>
              ) : null}
            </div>
          </div>
          <div className="lp-preview-side">
            <button type="button" className="lp-preview-close" onClick={onClose} aria-label="Close preview">
              <IconX aria-hidden />
            </button>
            <p className="lp-preview-cat">{template.category}</p>
            <h3 id="lp-preview-title" className="lp-preview-title">
              {template.name}
            </h3>
            <p className="lp-preview-desc">{template.description}</p>
            <div className="lp-preview-ratios" role="group" aria-label="Frame shape">
              {template.ratios.map((entry) => (
                <button key={entry} type="button" aria-pressed={ratio === entry} onClick={() => setRatio(entry)}>
                  {entry}
                </button>
              ))}
            </div>
            <a href={templateHref(template)} className="lp-btn lp-btn-cut lp-preview-use">
              Use template
              <IconArrowRight className="size-4" aria-hidden />
            </a>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
