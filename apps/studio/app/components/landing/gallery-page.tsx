import type { AspectRatio } from "@crewcut/composition";
import { IconSearch } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { LANDING_TEMPLATES, type LandingTemplate } from "./landing-media";
import { FinalCall, Footer, Nav } from "./landing-page";
import { PreviewDialog, TemplateCard } from "./templates-showcase";
import { useHydrated, useInView } from "./use-landing";

const RATIO_FILTERS: Array<{ value: AspectRatio | "all"; label: string; hint?: string }> = [
  { value: "all", label: "All" },
  { value: "9:16", label: "9:16", hint: "Reels, TikTok, Shorts" },
  { value: "4:5", label: "4:5", hint: "Instagram feed" },
  { value: "1:1", label: "1:1", hint: "Square posts" },
  { value: "16:9", label: "16:9", hint: "YouTube, web" },
];

/**
 * The public template gallery: every template, playable and previewable
 * without an account. "Use template" goes to the app (sign-up first when
 * signed out). ?preview=<id> opens a template's preview; ?ratio= filters.
 */
export function GalleryPage() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const ratioParam = params.get("ratio") as AspectRatio | null;
  const ratio = RATIO_FILTERS.some((entry) => entry.value === ratioParam) ? ratioParam : null;
  const [previewing, setPreviewing] = useState<LandingTemplate | null>(null);
  const gridRef = useRef<HTMLUListElement>(null);
  const near = useInView(gridRef, { once: true, rootMargin: "200px 0px" });
  const hydrated = useHydrated();

  const setParam = (key: string, value: string | null) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true, preventScrollReset: true },
    );

  // ?preview=<id> (from the landing page's Preview links, or shared) opens that template.
  const previewId = params.get("preview");
  useEffect(() => {
    if (!previewId) return;
    const linked = LANDING_TEMPLATES.find((template) => template.id === previewId);
    if (linked) setPreviewing(linked);
  }, [previewId]);

  const categories = useMemo(() => [...new Set(LANDING_TEMPLATES.map((template) => template.category))], []);
  const shown = useMemo(() => {
    const words = query.trim().toLowerCase();
    return LANDING_TEMPLATES.filter(
      (template) =>
        (!ratio || template.ratios.includes(ratio)) &&
        (!category || template.category === category) &&
        (!words || `${template.name} ${template.category} ${template.description}`.toLowerCase().includes(words)),
    );
  }, [query, ratio, category]);
  const cardRatio = (template: LandingTemplate): AspectRatio => (ratio && template.ratios.includes(ratio) ? ratio : template.ratios.includes("9:16") ? "9:16" : (template.ratios[0] ?? "9:16"));

  return (
    <div className="lp">
      <a href="#main" className="lp-skip">
        Skip to content
      </a>
      <Nav home="/" />
      <main id="main">
        <section className="lp-gallery-head" aria-labelledby="gallery-title">
          <div className="lp-wrap">
            <h1 id="gallery-title" className="lp-gallery-title">
              Templates
            </h1>
            <p className="lp-gallery-lede">Hand-designed videos with real photos, motion and music. Preview any of them here, then make one yours with your own words and photos.</p>
          </div>
        </section>

        <section className="lp-gallery" aria-label="All templates">
          <div className="lp-wrap">
            <div className="lp-gallery-controls">
              <label className="lp-search">
                <IconSearch aria-hidden />
                <span className="sr-only">Search templates</span>
                <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search: launch, travel, quote…" />
              </label>
              <div className="lp-segmented" role="group" aria-label="Frame shape">
                {RATIO_FILTERS.map((entry) => (
                  <button key={entry.value} type="button" title={entry.hint} aria-pressed={(ratio ?? "all") === entry.value} onClick={() => setParam("ratio", entry.value === "all" ? null : entry.value)}>
                    {entry.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="lp-chips" role="group" aria-label="Category">
              <button type="button" aria-pressed={!category} onClick={() => setCategory(null)}>
                All
              </button>
              {categories.map((entry) => (
                <button key={entry} type="button" aria-pressed={category === entry} onClick={() => setCategory(category === entry ? null : entry)}>
                  {entry}
                </button>
              ))}
            </div>

            {shown.length === 0 ? (
              <p className="lp-gallery-empty">
                No templates match{query.trim() ? ` “${query.trim()}”` : ""}
                {ratio ? ` in ${ratio}` : ""}. Try another word or shape.
              </p>
            ) : (
              <ul ref={gridRef} className="lp-template-grid lp-gallery-grid" data-ratio={ratio ?? "9:16"}>
                {shown.map((template, index) => (
                  <TemplateCard key={`${template.id}-${cardRatio(template)}`} template={template} index={index} ratio={cardRatio(template)} mount={hydrated && near} onPreview={() => setPreviewing(template)} />
                ))}
              </ul>
            )}
          </div>
        </section>
        <FinalCall />
      </main>
      <Footer />
      <PreviewDialog
        template={previewing}
        initialRatio={ratio}
        onClose={() => {
          setPreviewing(null);
          if (previewId) setParam("preview", null);
        }}
      />
    </div>
  );
}
