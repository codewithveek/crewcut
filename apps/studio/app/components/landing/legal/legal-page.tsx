import type { ReactNode } from "react";
import type { LinksFunction, MetaFunction } from "react-router";

import landingCss from "../landing.css?url";
import { Footer, Nav } from "../landing-page";
import legalCss from "./legal.css?url";
import { ogLegal, pageMeta } from "../seo";
import { LEGAL, LEGAL_PAGES, LEGAL_UPDATED, type LegalSlug } from "./legal-info";

export type LegalSection = { id: string; title: string; body: ReactNode };

export type LegalDoc = {
  slug: LegalSlug;
  title: string;
  /** One or two plain sentences under the title. */
  intro: ReactNode;
  /** Optional "the short version" list shown before the full text. */
  summary?: ReactNode[];
  sections: LegalSection[];
};

export const legalLinks: LinksFunction = () => [
  { rel: "stylesheet", href: landingCss },
  { rel: "stylesheet", href: legalCss },
];

export function legalMeta(slug: LegalSlug, description: string): MetaFunction {
  const page = LEGAL_PAGES.find((entry) => entry.slug === slug)!;
  return () => pageMeta({ title: `${page.title} · Crewcut`, description, path: page.href, image: ogLegal(slug), type: "article" });
}

/** The shared layout for the four legal pages: the site's nav and footer around a readable document. */
export function LegalPage({ doc }: { doc: LegalDoc }) {
  return (
    <div className="lp lp-legal">
      <a href="#main" className="lp-skip">
        Skip to content
      </a>
      <Nav home="/" />
      <main id="main">
        <header className="lg-head">
          <div className="lg-wrap">
            <nav aria-label="Legal documents" className="lg-docs">
              {LEGAL_PAGES.map((page) => (
                <a key={page.slug} href={page.href} aria-current={page.slug === doc.slug ? "page" : undefined}>
                  {page.short}
                </a>
              ))}
            </nav>
            <h1 className="lg-title">{doc.title}</h1>
            <p className="lg-meta">
              Last updated <time dateTime={LEGAL_UPDATED.iso}>{LEGAL_UPDATED.label}</time> · Effective the same day
            </p>
            <div className="lg-intro">{doc.intro}</div>
          </div>
        </header>
        <div className="lg-wrap lg-body">
          <aside className="lg-toc" aria-label="On this page">
            <p className="lg-toc-title">On this page</p>
            <ol>
              {doc.sections.map((section, index) => (
                <li key={section.id}>
                  <a href={`#${section.id}`}>
                    <span className="lg-num">{index + 1}.</span> {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </aside>
          <article className="lg-doc">
            {doc.summary ? (
              <section className="lg-summary" aria-labelledby="summary-title">
                <h2 id="summary-title">The short version</h2>
                <ul>
                  {doc.summary.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
                <p className="lg-summary-note">This summary helps you find your way. The full text below is what applies.</p>
              </section>
            ) : null}
            {doc.sections.map((section, index) => (
              <section key={section.id} id={section.id} className="lg-section" aria-labelledby={`${section.id}-title`}>
                <h2 id={`${section.id}-title`}>
                  <span className="lg-num">{index + 1}.</span> {section.title}
                </h2>
                {section.body}
              </section>
            ))}
            <section className="lg-contact" aria-label="Contact">
              <p>
                Questions about this page? Email <Mail /> and a person will answer.
              </p>
            </section>
          </article>
        </div>
      </main>
      <Footer />
    </div>
  );
}

// ── Small building blocks for the documents ────────────────────────────────

export function Mail({ subject }: { subject?: string }) {
  const href = `mailto:${LEGAL.email}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`;
  return <a href={href}>{LEGAL.email}</a>;
}

export function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

export function H3({ children }: { children: ReactNode }) {
  return <h3>{children}</h3>;
}

/** A plain data table that scrolls sideways on its own on narrow screens (never the page). */
export function Table({ caption, head, rows }: { caption: string; head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="lg-table" role="region" aria-label={caption} tabIndex={0}>
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {head.map((cell) => (
              <th key={cell} scope="col">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) =>
                cellIndex === 0 ? (
                  <th key={cellIndex} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={cellIndex}>{cell}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Callout({ children }: { children: ReactNode }) {
  return <div className="lg-callout">{children}</div>;
}
