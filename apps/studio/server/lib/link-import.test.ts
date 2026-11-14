import { describe, expect, it } from "vitest";

import { LinkImportError, labelFor, pageMediaCandidates, parseImportUrl, platformName } from "./link-import";

describe("parseImportUrl", () => {
  it("accepts web links and drops the fragment", () => {
    expect(parseImportUrl("  https://example.com/a.jpg#top ").toString()).toBe("https://example.com/a.jpg");
    expect(parseImportUrl("http://example.com/").protocol).toBe("http:");
  });

  it("refuses other schemes, junk and embedded credentials", () => {
    for (const bad of ["file:///etc/passwd", "ftp://example.com/a.mp4", "javascript:alert(1)", "not a url", "https://user:pass@example.com/a.png"]) {
      expect(() => parseImportUrl(bad)).toThrow(LinkImportError);
    }
  });
});

describe("platformName", () => {
  it("names video platforms, including subdomains and short links", () => {
    expect(platformName(new URL("https://www.youtube.com/watch?v=x"))).toBe("YouTube");
    expect(platformName(new URL("https://youtu.be/x"))).toBe("YouTube");
    expect(platformName(new URL("https://m.youtube.com/shorts/x"))).toBe("YouTube");
    expect(platformName(new URL("https://vm.tiktok.com/x"))).toBe("TikTok");
    expect(platformName(new URL("https://www.youtube.com./watch?v=x"))).toBe("YouTube");
    expect(platformName(new URL("https://x.com/a/status/1"))).toBe("X");
    expect(platformName(new URL("https://www.instagram.com/reel/x"))).toBe("Instagram");
  });

  it("leaves other sites alone, even ones that only end with a platform's letters", () => {
    expect(platformName(new URL("https://upload.wikimedia.org/a.jpg"))).toBeNull();
    expect(platformName(new URL("https://notyoutube.com/a.mp4"))).toBeNull();
    expect(platformName(new URL("https://box.com/a.mp4"))).toBeNull();
  });
});

describe("pageMediaCandidates", () => {
  const page = `<!doctype html><html><head>
    <title>Golden &amp; Hour — photos</title>
    <meta property="og:image" content="/share.jpg">
    <meta name="twitter:image" content="https://cdn.example.com/share.jpg?x=1&amp;y=2">
    <meta property="og:video" content="https://www.youtube.com/embed/abc">
    <link rel="icon" href="/favicon.png">
  </head><body>
    <!-- <img src="/commented.jpg"> -->
    <script>const s = '<img src="/in-script.jpg">';</script>
    <img src="/photos/sunset-over-hills.jpg" alt="Sunset over hills" width="1200" height="800">
    <img src="/pixel.gif" width="1" height="1">
    <img src="/logo.svg" alt="Logo">
    <img src="data:image/png;base64,AAAA" alt="inline">
    <img data-src="/lazy.webp" alt='Lazy "quoted"'>
    <img srcset="/s-480.jpg 480w, /s-1080.jpg 1080w, /s-720.jpg 720w" alt="Responsive">
    <picture><source srcset="/p.avif 1x, /p@2x.webp 2x" type="image/webp"><img src="/p.jpg" alt="Picture"></picture>
    <video src="/clips/intro.mp4" poster="/clips/intro-poster.jpg" title="Intro"></video>
    <video><source src="/clips/b.webm" type="video/webm"></video>
    <audio src="/sounds/chime.mp3"></audio>
    <a href="/downloads/raw.mov">Raw footage</a>
    <a href="/about">About</a>
    <a href="/photos/sunset-over-hills.jpg">Same photo again</a>
  </body></html>`;

  const result = pageMediaCandidates(page, "https://example.com/gallery/index.html");

  it("reads the title", () => {
    expect(result.title).toBe("Golden & Hour — photos");
  });

  it("lists share images first, then page media in order, then media links, without duplicates", () => {
    expect(result.candidates.map((candidate) => candidate.url)).toEqual([
      "https://example.com/share.jpg",
      "https://cdn.example.com/share.jpg?x=1&y=2",
      "https://example.com/photos/sunset-over-hills.jpg",
      "https://example.com/lazy.webp",
      "https://example.com/s-1080.jpg",
      "https://example.com/p@2x.webp",
      "https://example.com/p.jpg",
      "https://example.com/clips/intro.mp4",
      "https://example.com/clips/intro-poster.jpg",
      "https://example.com/clips/b.webm",
      "https://example.com/sounds/chime.mp3",
      "https://example.com/downloads/raw.mov",
    ]);
  });

  it("keeps alt text, sizes and kinds", () => {
    const sunset = result.candidates.find((candidate) => candidate.url.endsWith("sunset-over-hills.jpg"))!;
    expect(sunset).toMatchObject({ kind: "image", alt: "Sunset over hills", width: 1200, height: 800, from: "img" });
    expect(result.candidates.find((candidate) => candidate.url.endsWith("lazy.webp"))?.alt).toBe('Lazy "quoted"');
    expect(result.candidates.find((candidate) => candidate.url.endsWith("intro.mp4"))?.kind).toBe("video");
    expect(result.candidates.find((candidate) => candidate.url.endsWith("chime.mp3"))?.kind).toBe("audio");
    expect(result.candidates.find((candidate) => candidate.url.endsWith("raw.mov"))).toMatchObject({ kind: "video", from: "link" });
  });

  it("follows <base href> and leaves out pixels, SVGs, inline data, comments and scripts", () => {
    const based = pageMediaCandidates(`<base href="https://media.example.org/root/"><img src="a.jpg">`, "https://example.com/x");
    expect(based.candidates[0]?.url).toBe("https://media.example.org/root/a.jpg");
    const urls = result.candidates.map((candidate) => candidate.url).join(" ");
    for (const absent of ["pixel.gif", "logo.svg", "data:", "commented.jpg", "in-script.jpg", "favicon", "youtube.com", "/about"]) expect(urls).not.toContain(absent);
  });

  it("never throws on broken markup", () => {
    expect(pageMediaCandidates("<img src=", "https://example.com").candidates).toEqual([]);
    expect(pageMediaCandidates(`<img src="http://[::1">`, "https://example.com").candidates).toEqual([]);
    expect(pageMediaCandidates("<img src='/a.jpg'>", "not a url").candidates).toEqual([]);
  });
});

describe("labelFor", () => {
  it("prefers the given label, then the file name, then the site", () => {
    expect(labelFor("https://example.com/a.jpg", "  My photo ")).toBe("My photo");
    expect(labelFor("https://example.com/photos/golden_hour-beach.jpg")).toBe("golden hour beach");
    expect(labelFor("https://cdn.example.com/0f1e2d3c4b5a69788796a5b4c3d2e1f0.jpg")).toBe("From cdn.example.com");
    expect(labelFor("https://example.com/")).toBe("From example.com");
  });
});
