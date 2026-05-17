import { describe, it, expect } from "vitest";
import { he, extractTagValues, buildHtml } from "./renderer";

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

  it("renders unordered list", () => {
    expect(buildHtml("- item1\n- item2")).toBe(
      "<ul><li>item1</li><li>item2</li></ul>",
    );
  });

  it("renders bold inline", () => {
    expect(buildHtml("**bold**")).toBe("<p><strong>bold</strong></p>");
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
});
