// @ts-nocheck — the client is plain ES modules, shipped to the browser unbuilt.
import { describe, expect, it } from "vitest";
import { escapeHtml, extractSnippet, extractTitle, renderMarkdown } from "../public/markdown.js";

describe("escapeHtml", () => {
  it("neutralises every character that could open a tag or attribute", () => {
    expect(escapeHtml(`<img src=x onerror="alert('x')">`)).toBe(
      "&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;",
    );
  });
});

describe("renderMarkdown", () => {
  it("renders headings at their level", () => {
    expect(renderMarkdown("# Sideways Doors")).toBe("<h1>Sideways Doors</h1>");
    expect(renderMarkdown("## The idea")).toBe("<h2>The idea</h2>");
  });

  it("joins wrapped lines into one paragraph and splits on blank lines", () => {
    expect(renderMarkdown("one\ntwo\n\nthree")).toBe("<p>one two</p><p>three</p>");
  });

  it("renders bold and italic", () => {
    expect(renderMarkdown("a **b** and *c*")).toBe("<p>a <strong>b</strong> and <em>c</em></p>");
  });

  it("renders ordered and bulleted lists", () => {
    expect(renderMarkdown("1. one\n2. two")).toBe("<ol><li>one</li><li>two</li></ol>");
    expect(renderMarkdown("- one\n- two")).toBe("<ul><li>one</li><li>two</li></ul>");
  });

  it("continues a wrapped list item instead of breaking the list", () => {
    expect(renderMarkdown("1. one\n   continued\n2. two")).toBe(
      "<ol><li>one continued</li><li>two</li></ol>",
    );
  });

  it("escapes model output before it can become markup", () => {
    const html = renderMarkdown("## <script>alert(1)</script>");
    expect(html).toBe("<h2>&lt;script&gt;alert(1)&lt;/script&gt;</h2>");
    expect(html).not.toContain("<script>");
  });

  it("escapes html inside emphasis too", () => {
    expect(renderMarkdown("**<b>x</b>**")).toBe("<p><strong>&lt;b&gt;x&lt;/b&gt;</strong></p>");
  });

  it("survives a half-streamed line without throwing", () => {
    expect(() => renderMarkdown("# Half a tit")).not.toThrow();
    expect(renderMarkdown("some **unclosed")).toBe("<p>some **unclosed</p>");
  });

  it("returns nothing for empty input", () => {
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown("   \n\n  ")).toBe("");
  });
});

describe("tables", () => {
  it("renders a pipe table with a header row", () => {
    const html = renderMarkdown("| A | B |\n| --- | --- |\n| 1 | 2 |");
    expect(html).toContain("<th>A</th><th>B</th>");
    expect(html).toContain("<td>1</td><td>2</td>");
  });

  it("wraps it so a wide table scrolls inside itself", () => {
    expect(renderMarkdown("| A |\n| --- |\n| 1 |")).toMatch(/^<div class="scroll-x">/);
  });

  it("needs the separator row — a lone pipe line stays a paragraph", () => {
    expect(renderMarkdown("| just a pipe line")).toBe("<p>| just a pipe line</p>");
  });

  it("resumes normal rendering after the table ends", () => {
    const html = renderMarkdown("| A |\n| --- |\n| 1 |\n\nafter");
    expect(html).toContain("<p>after</p>");
  });

  it("escapes cell content", () => {
    const html = renderMarkdown("| A |\n| --- |\n| <script>x</script> |");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});

describe("marking", () => {
  it("numbers paragraphs and list items in document order", () => {
    const html = renderMarkdown("## H\n\npara\n\n- one\n- two", { markable: true });
    expect(html).toContain('<p data-mark="0">');
    expect(html).toContain('<li data-mark="1">');
    expect(html).toContain('<li data-mark="2">');
  });

  it("applies stored mark states", () => {
    const html = renderMarkdown("a\n\nb", { markable: true, marks: { 0: "keep", 1: "kill" } });
    expect(html).toContain('class="mark-keep"');
    expect(html).toContain('class="mark-kill"');
  });

  it("emits no mark attributes unless asked", () => {
    expect(renderMarkdown("a\n\nb")).toBe("<p>a</p><p>b</p>");
  });

  it("does not number headings — only lines worth a decision", () => {
    const html = renderMarkdown("# T\n\n## S\n\npara", { markable: true });
    expect(html).toContain('<p data-mark="0">');
    expect(html).not.toContain("<h1 data-mark");
    expect(html).not.toContain("<h2 data-mark");
  });
});

describe("extractTitle", () => {
  it("takes the leading h1", () => {
    expect(extractTitle("# Rent-Paying Clouds\n\n## The idea\nyes", "raw")).toBe(
      "Rent-Paying Clouds",
    );
  });

  it("strips quotes the model wrapped it in", () => {
    expect(extractTitle('# "Sideways Doors"', "raw")).toBe("Sideways Doors");
  });

  it("falls back to the first words of the raw thought", () => {
    expect(extractTitle("## No title here", "what if the clouds paid rent to the sky itself")).toBe(
      "what if the clouds paid rent",
    );
  });

  it("never returns an empty string", () => {
    expect(extractTitle("", "   ")).toBe("Untitled");
  });
});

describe("extractSnippet", () => {
  it("takes the first line of prose, skipping every heading", () => {
    expect(extractSnippet("# Title\n\n## The idea\n\nA **bold** claim.")).toBe("A bold claim.");
  });

  it("finds prose even when every block opens with a heading", () => {
    const answer = "# T\n\n## One\nfirst line\n\n## Two\nsecond line";
    expect(extractSnippet(answer)).toBe("first line");
  });

  it("strips list markers so a list-first answer still previews", () => {
    expect(extractSnippet("# T\n\n## One\n1. the first escalation")).toBe("the first escalation");
  });

  it("returns an empty string when there is no body yet", () => {
    expect(extractSnippet("# Title")).toBe("");
    expect(extractSnippet("# Title\n\n## The idea")).toBe("");
  });
});
