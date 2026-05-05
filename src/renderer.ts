export function he(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── インラインタグ定義 ─────────────────────────────────────────────────────────
// 新しいタグはここに1行追加するだけ

const svoc = (label: string, cls: string) => (c: string) =>
  `<ruby class="svoc ${cls}">${he(c)}<rt>${label}</rt></ruby>`;

const INLINE_TAGS: Record<string, (content: string) => string> = {
  "HL":      (c) => `<mark class="hl">${he(c)}</mark>`,
  "DIFF+":   (c) => `<ins class="diff-add">${he(c)}</ins>`,
  "DIFF-":   (c) => `<del class="diff-del">${he(c)}</del>`,
  "NOTE":    (c) => `<span class="note" title="${he(c)}">※</span>`,
  "V":       (c) => `<span class="pos pos-v">${he(c)}</span>`,
  "N":       (c) => `<span class="pos pos-n">${he(c)}</span>`,
  "ADJ":     (c) => `<span class="pos pos-adj">${he(c)}</span>`,
  "ADV":     (c) => `<span class="pos pos-adv">${he(c)}</span>`,
  "S":       svoc("S", "svoc-s"),
  "VB":      svoc("V", "svoc-v"),
  "O":       svoc("O", "svoc-o"),
  "C":       svoc("C", "svoc-c"),
  "M":       svoc("M", "svoc-m"),
};

// %%TAG:content%% 形式のインラインタグを HTML に変換
function inline(text: string): string {
  let out = "", i = 0;
  while (i < text.length) {
    // カスタムインラインタグ: %%TAG:content%%
    if (text.slice(i, i + 2) === "%%") {
      const end = text.indexOf("%%", i + 2);
      if (end > 0) {
        const inner = text.slice(i + 2, end);
        const colon = inner.indexOf(":");
        if (colon > 0) {
          const tag = inner.slice(0, colon);
          const content = inner.slice(colon + 1);
          const renderer = INLINE_TAGS[tag];
          if (renderer) { out += renderer(content); i = end + 2; continue; }
        }
      }
    }
    if (text.slice(i, i + 2) === "**") {
      const j = text.indexOf("**", i + 2);
      if (j > 0) { out += `<strong>${he(text.slice(i + 2, j))}</strong>`; i = j + 2; continue; }
    } else if (text[i] === "`") {
      const j = text.indexOf("`", i + 1);
      if (j > 0) { out += `<code>${he(text.slice(i + 1, j))}</code>`; i = j + 1; continue; }
    }
    out += he(text[i]); i++;
  }
  return out;
}

// 指定タグの値を全て抽出（HL タグのハイライト適用等に使用）
export function extractTagValues(text: string, tag: string): string[] {
  const regex = new RegExp(`%%${tag}:([^%]*)%%`, "g");
  const values: string[] = [];
  let m;
  while ((m = regex.exec(text)) !== null) values.push(m[1]);
  return values;
}

function markdown(text: string): string {
  const result: string[] = [];
  let inCode = false, inList = "", inSub = false;

  const closeList = () => {
    if (inSub) { result.push("</ul>"); inSub = false; }
    if (inList) { result.push(`</${inList}>`); inList = ""; }
  };

  for (const line of text.split("\n")) {
    if (line.startsWith("```")) {
      if (!inCode) { closeList(); result.push("<pre><code>"); inCode = true; }
      else { result.push("</code></pre>"); inCode = false; }
      continue;
    }
    if (inCode) { result.push(he(line) + "\n"); continue; }

    let m = line.match(/^#{2}\s+(.+)/);
    if (m) { closeList(); result.push(`<h2>${inline(m[1])}</h2>`); continue; }
    m = line.match(/^#\s+(.+)/);
    if (m) { closeList(); result.push(`<h1>${inline(m[1])}</h1>`); continue; }
    if (/^(---+|===+)\s*$/.test(line)) { closeList(); result.push("<hr>"); continue; }

    m = line.match(/^(?:  +|\t)[-*]\s+(.+)/);
    if (m) {
      if (!inList) { result.push("<ul>"); inList = "ul"; }
      if (!inSub)  { result.push("<ul>"); inSub = true; }
      result.push(`<li>${inline(m[1])}</li>`); continue;
    }
    m = line.match(/^[-*]\s+(.+)/);
    if (m) {
      if (inSub)           { result.push("</ul>"); inSub = false; }
      if (inList === "ol") { result.push("</ol>"); inList = ""; }
      if (!inList)         { result.push("<ul>"); inList = "ul"; }
      result.push(`<li>${inline(m[1])}</li>`); continue;
    }
    m = line.match(/^\d+\.\s+(.+)/);
    if (m) {
      if (inSub)           { result.push("</ul>"); inSub = false; }
      if (inList === "ul") { result.push("</ul>"); inList = ""; }
      if (!inList)         { result.push("<ol>"); inList = "ol"; }
      result.push(`<li>${inline(m[1])}</li>`); continue;
    }
    if (!line.trim()) { closeList(); continue; }
    closeList(); result.push(`<p>${inline(line)}</p>`);
  }
  if (inSub)  result.push("</ul>");
  if (inList) result.push(`</${inList}>`);
  if (inCode) result.push("</code></pre>");
  return result.join("");
}

function bilingual(text: string): string {
  const normalized = text
    .replace(/%%ORIG%%/g, "\n%%ORIG%%\n")
    .replace(/%%TRANS%%/g, "\n%%TRANS%%\n");
  const pairs: [string, string][] = [];
  let orig: string[] = [], trans: string[] = [], mode = "";
  for (const raw of normalized.split("\n")) {
    const line = raw.trim();
    if (line === "%%ORIG%%") {
      if (orig.length && trans.length) pairs.push([orig.join(" "), trans.join(" ")]);
      orig = []; trans = []; mode = "orig";
    } else if (line === "%%TRANS%%") {
      mode = "trans";
    } else if (line) {
      (mode === "orig" ? orig : trans).push(line);
    }
  }
  if (orig.length && trans.length) pairs.push([orig.join(" "), trans.join(" ")]);
  return pairs.map(([o, t]) =>
    `<div class="pair"><p class="orig">${inline(o)}</p><p class="trans">${inline(t)}</p></div>`
  ).join("\n");
}

export function buildHtml(text: string): string {
  if (!text.trim()) return "";
  if (text.includes("%%ORIG%%")) {
    const html = bilingual(text);
    if (html) return html;
  }
  return markdown(text);
}
