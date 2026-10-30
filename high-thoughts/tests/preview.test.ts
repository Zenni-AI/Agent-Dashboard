// @ts-nocheck — the client ships as plain ES modules.
import { describe, expect, it } from "vitest";
import { sanitizePrototype } from "../public/preview.js";

const of = (html: string) => sanitizePrototype(html).html;

describe("the policy injected into every creation", () => {
  it("denies everything by default", () => {
    expect(of("<html><head></head></html>")).toContain("default-src 'none'");
  });

  it("closes the exfiltration route the sandbox leaves open", () => {
    // This single directive is what stops a creation that has read something
    // from sending it anywhere. Sandboxing alone does not.
    expect(of("<html><head></head></html>")).toContain("connect-src 'none'");
  });

  it("blocks navigation, nested frames and re-based URLs", () => {
    const html = of("<html><head></head></html>");
    for (const directive of ["form-action 'none'", "frame-src 'none'", "base-uri 'none'", "object-src 'none'"]) {
      expect(html).toContain(directive);
    }
  });

  it("lands before anything it governs", () => {
    const html = of("<html><head><title>t</title></head><body>x</body></html>");
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("<title>"));
  });

  it("builds a document around a bare fragment", () => {
    const html = of("<p>just a fragment</p>");
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("just a fragment");
  });
});

describe("stripping what must never load", () => {
  const hostile = `<html><head>
    <link rel="stylesheet" href="https://evil.test/x.css">
    <base href="https://evil.test/">
    <meta http-equiv="refresh" content="0;url=https://evil.test">
    <meta http-equiv="Content-Security-Policy" content="default-src *">
  </head><body>
    <script src="https://evil.test/x.js"></script>
    <iframe src="https://evil.test"></iframe>
    <object data="https://evil.test/o"></object>
  </body></html>`;

  it("removes every off-origin reference", () => {
    const { html, removed } = sanitizePrototype(hostile);
    expect(html).not.toMatch(/evil\.test/);
    expect(removed.length).toBeGreaterThanOrEqual(6);
  });

  it("refuses to let a creation set its own weaker policy", () => {
    const html = of(hostile);
    expect(html).not.toContain("default-src *");
    expect(html).toContain("connect-src 'none'");
  });

  it("keeps inline script, which is the whole point of a creation", () => {
    const html = of("<html><body><script>var a=1;</script></body></html>");
    expect(html).toContain("var a=1");
  });

  it("strips a markdown fence the model wrapped it in", () => {
    expect(of("```html\n<html><body>hi</body></html>\n```")).not.toContain("```");
  });

  it("survives junk without throwing", () => {
    for (const junk of [null, undefined, "", "<<<", 42]) {
      expect(() => sanitizePrototype(junk as never)).not.toThrow();
    }
  });
});
