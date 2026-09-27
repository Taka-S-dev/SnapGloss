import { describe, it, expect } from "vitest";
import { detectTextKind } from "./textKind";

describe("detectTextKind", () => {
  it("treats one to three English words as a word lookup", () => {
    expect(detectTextKind("serendipity")).toBe("word");
    expect(detectTextKind("give up")).toBe("word");
    expect(detectTextKind("state of the art")).toBe("en"); // 4 語は文章扱い
  });

  it("classifies English prose", () => {
    expect(detectTextKind("The quick brown fox jumps over the lazy dog.")).toBe("en");
    expect(detectTextKind("- On machines where the shell does not emit OSC 7,\n  the path is asked for.")).toBe("en");
  });

  it("classifies Japanese prose, including mixed text with English terms", () => {
    expect(detectTextKind("ホットキーを押すと選択中のテキストを取得します。")).toBe("ja");
    expect(detectTextKind("この API は OpenAI 互換です。")).toBe("ja");
  });

  it("keeps English prose that quotes a Japanese word as English", () => {
    expect(detectTextKind("The word 猫 means cat in Japanese.")).toBe("en");
  });

  it("classifies code and symbol-heavy text as other", () => {
    expect(detectTextKind("fn main() {\n    let x = vec![1, 2, 3];\n    println!(\"{:?}\", x);\n}")).toBe("other");
    expect(detectTextKind("const a = items.map(i => ({ id: i.id, v: i.v * 2 }));")).toBe("other");
  });

  it("returns other for empty or non-letter input", () => {
    expect(detectTextKind("")).toBe("other");
    expect(detectTextKind("   \n ")).toBe("other");
    expect(detectTextKind("12345 67890")).toBe("other");
  });
});
