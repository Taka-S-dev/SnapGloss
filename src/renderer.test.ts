import { describe, it, expect } from "vitest";
import { he, extractTagValues, buildHtml, normalizeSvocTags } from "./renderer";

describe("he (HTML escape)", () => {
  it("escapes & < >", () => {
    expect(he("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
  });

  it("returns empty for empty input", () => {
    expect(he("")).toBe("");
  });

  it("does not escape safe characters", () => {
    expect(he("hello world")).toBe("hello world");
  });
});

describe("extractTagValues", () => {
  it("extracts single tag", () => {
    expect(extractTagValues("foo %%HL:bar%% baz", "HL")).toEqual(["bar"]);
  });

  it("extracts multiple tags", () => {
    expect(extractTagValues("%%HL:a%% %%HL:b%% %%HL:c%%", "HL")).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("returns empty array when no tags", () => {
    expect(extractTagValues("plain text", "HL")).toEqual([]);
  });

  it("only extracts requested tag", () => {
    expect(extractTagValues("%%HL:keep%% %%V:skip%%", "HL")).toEqual(["keep"]);
  });
});

describe("buildHtml", () => {
  it("returns empty string for empty input", () => {
    expect(buildHtml("")).toBe("");
  });

  it("wraps plain text in p tag", () => {
    expect(buildHtml("hello")).toBe("<p>hello</p>");
  });

  it("renders h1", () => {
    expect(buildHtml("# Title")).toBe("<h1>Title</h1>");
  });

  it("renders h2", () => {
    expect(buildHtml("## Sub")).toBe("<h2>Sub</h2>");
  });

  it("renders h3 and deeper as h3", () => {
    expect(buildHtml("### Point")).toBe("<h3>Point</h3>");
    expect(buildHtml("#### Deep")).toBe("<h3>Deep</h3>");
  });

  it("renders blockquote", () => {
    expect(buildHtml("> quoted text")).toBe("<blockquote>quoted text</blockquote>");
  });

  it("renders unordered list", () => {
    expect(buildHtml("- item1\n- item2")).toBe(
      "<ul><li>item1</li><li>item2</li></ul>",
    );
  });

  it("renders bold inline", () => {
    expect(buildHtml("**bold**")).toBe("<p><strong>bold</strong></p>");
  });

  it("renders bold spanning multiple lines", () => {
    expect(buildHtml("**line1\nline2**")).toBe(
      "<p><strong>line1</strong></p><p><strong>line2</strong></p>",
    );
  });

  it("leaves unpaired ** untouched", () => {
    expect(buildHtml("2 ** 3")).toBe("<p>2 ** 3</p>");
  });

  it("renders bilingual format", () => {
    const input = "%%ORIG%%\nHello.\n%%TRANS%%\nこんにちは。";
    const result = buildHtml(input);
    expect(result).toContain('class="orig"');
    expect(result).toContain('class="trans"');
    expect(result).toContain("Hello.");
    expect(result).toContain("こんにちは。");
  });

  it("renders HL highlight tag", () => {
    expect(buildHtml("%%HL:important%%")).toBe(
      '<p><mark class="hl">important</mark></p>',
    );
  });

  it("drops stray %% markers instead of rendering them literally", () => {
    // AI が HL: を付け忘れて %%...%% で括ったケース
    expect(buildHtml("%%Unlike the typical footprint%%")).toBe(
      "<p>Unlike the typical footprint</p>",
    );
  });

  it("drops an unclosed %% marker", () => {
    expect(buildHtml("text with %% dangling")).toBe("<p>text with  dangling</p>");
  });

  it("salvages a nest-broken tag missing its opening marker", () => {
    // %%M:that %%S:members%% → 外側タグが内側の開始 %% を閉じとして消費したケース
    expect(buildHtml("%%M:that %%S:members%% rest")).toBe(
      '<p><ruby class="svoc svoc-m">that <rt>M</rt></ruby>' +
      '<ruby class="svoc svoc-s">members<rt>S</rt></ruby> rest</p>',
    );
  });

  it("does not salvage TAG:-like text after plain text", () => {
    expect(buildHtml("see NOTE: this is fine")).toBe("<p>see NOTE: this is fine</p>");
  });
});

describe("mermaid fence", () => {
  it("marks mermaid code blocks for later rendering", () => {
    expect(buildHtml("```mermaid\ngraph TD\n```")).toBe(
      '<pre class="mermaid-src"><code>graph TD\n</code></pre>',
    );
  });

  it("keeps normal code blocks unmarked", () => {
    expect(buildHtml("```js\nlet a = 1;\n```")).toBe(
      "<pre><code>let a = 1;\n</code></pre>",
    );
  });
});

describe("markdown table", () => {
  it("renders a GFM table", () => {
    expect(buildHtml("| A | B |\n|---|---|\n| 1 | 2 |")).toBe(
      "<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody>" +
      "<tr><td>1</td><td>2</td></tr></tbody></table>",
    );
  });

  it("applies inline formatting inside cells", () => {
    expect(buildHtml("| word |\n|---|\n| **bold** |")).toContain("<strong>bold</strong>");
  });

  it("falls back to paragraphs when separator row is missing", () => {
    expect(buildHtml("| just | pipes |")).toBe("<p>| just | pipes |</p>");
  });
});

describe("normalizeSvocTags", () => {
  it("converts prepositional O/C tags to M", () => {
    expect(normalizeSvocTags("%%VB:is restricted%% %%C:to members%%"))
      .toBe("%%VB:is restricted%% %%M:to members%%");
    expect(normalizeSvocTags("%%VB:associate%% %%O:with a trip%%"))
      .toBe("%%VB:associate%% %%M:with a trip%%");
  });

  it("keeps non-prepositional O/C tags", () => {
    expect(normalizeSvocTags("%%VB:loves%% %%O:music%%"))
      .toBe("%%VB:loves%% %%O:music%%");
    expect(normalizeSvocTags("%%VB:acting%% %%C:as a giant%%"))
      .toBe("%%VB:acting%% %%C:as a giant%%");
  });

  it("relabels there-construction complements as S", () => {
    expect(normalizeSvocTags("%%M:there%% %%VB:is%% %%C:no warehouse%%, and %%C:no food court%%"))
      .toBe("%%M:there%% %%VB:is%% %%S:no warehouse%%, and %%S:no food court%%");
  });

  it("fixes there tagged as S and stops at non-O/C tags", () => {
    expect(normalizeSvocTags("%%S:there%% %%VB:is%% %%C:no store%% %%M:that%% %%S:members%% %%VB:like%% %%O:it%%"))
      .toBe("%%M:there%% %%VB:is%% %%S:no store%% %%M:that%% %%S:members%% %%VB:like%% %%O:it%%");
  });
});
