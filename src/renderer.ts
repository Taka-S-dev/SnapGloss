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
  let afterTag = false;
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
          if (renderer) { out += renderer(content); i = end + 2; afterTag = true; continue; }
        }
      }
      // タグとして解釈できない迷子の %% は表示せず読み飛ばす
      // （AI が HL: を付け忘れて %%...%% で括るケース等）
      i += 2;
      continue;
    }
    // AI がタグを入れ子にすると外側のタグが内側の開始 %% を「閉じ」として
    // 消費し、"TAG:content%%" だけが残る。直前がタグだった場合に限り救済する。
    if (afterTag) {
      const rest = text.slice(i);
      const m = /^([A-Z+\-]{1,5}):/.exec(rest);
      if (m && INLINE_TAGS[m[1]]) {
        const close = rest.indexOf("%%");
        if (close > m[0].length) {
          out += INLINE_TAGS[m[1]](rest.slice(m[0].length, close));
          i += close + 2;
          continue;
        }
      }
      afterTag = false;
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
  const tableBuf: string[] = [];

  const closeList = () => {
    if (inSub) { result.push("</ul>"); inSub = false; }
    if (inList) { result.push(`</${inList}>`); inList = ""; }
  };

  // GFM テーブル：| で始まる行を貯めて、2行目が区切り行ならテーブルとして描画
  const flushTable = () => {
    if (!tableBuf.length) return;
    const rows = tableBuf.map(l =>
      l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim())
    );
    const isSep = rows.length >= 2 && rows[1].every(c => /^:?-+:?$/.test(c));
    if (isSep) {
      closeList();
      const cells = (r: string[], tag: string) => r.map(c => `<${tag}>${inline(c)}</${tag}>`).join("");
      result.push(
        `<table><thead><tr>${cells(rows[0], "th")}</tr></thead><tbody>` +
        rows.slice(2).map(r => `<tr>${cells(r, "td")}</tr>`).join("") +
        "</tbody></table>"
      );
    } else {
      // テーブルの体裁でなければ通常の段落として出す
      closeList();
      for (const l of tableBuf) result.push(`<p>${inline(l)}</p>`);
    }
    tableBuf.length = 0;
  };

  for (const line of text.split("\n")) {
    if (line.startsWith("```")) {
      flushTable();
      if (!inCode) {
        closeList();
        // mermaid ブロックは後段（mermaidRender.ts）が SVG に差し替える目印を付ける
        const lang = line.slice(3).trim().toLowerCase();
        result.push(lang === "mermaid" ? '<pre class="mermaid-src"><code>' : "<pre><code>");
        inCode = true;
      } else {
        result.push("</code></pre>");
        inCode = false;
      }
      continue;
    }
    if (inCode) { result.push(he(line) + "\n"); continue; }

    if (line.trim().startsWith("|")) { tableBuf.push(line); continue; }
    flushTable();

    let m = line.match(/^#{3,}\s+(.+)/);
    if (m) { closeList(); result.push(`<h3>${inline(m[1])}</h3>`); continue; }
    m = line.match(/^#{2}\s+(.+)/);
    if (m) { closeList(); result.push(`<h2>${inline(m[1])}</h2>`); continue; }
    m = line.match(/^#\s+(.+)/);
    if (m) { closeList(); result.push(`<h1>${inline(m[1])}</h1>`); continue; }
    m = line.match(/^>\s?(.*)/);
    if (m) { closeList(); result.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
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
  flushTable();
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

// ── SVOC タグの決定的補正 ─────────────────────────────────────────────────────
// プロンプトで指示してもモデルが繰り返し間違える学校文法のルールを機械的に直す。
// 1) 前置詞で始まる句は O・C にならない → M へ
// 2) There 構文（there + be）: there は M、be の後の名詞句列が実質主語 S

const PREPOSITION = /^(?:to|of|in|on|at|by|for|from|with|about|into|onto|over|under|through|during|between|among|against|without|within|toward|towards|across|behind|beyond|upon|near|off)\b/i;

export function normalizeSvocTags(text: string): string {
  // there を S にしてしまった場合は M に付け替える
  text = text.replace(/%%S:([Tt]here)%%(\s*%%VB:(?:is|are|was|were)\b[^%]*%%)/g, "%%M:$1%%$2");
  // 前置詞で始まる O/C は M へ
  text = text.replace(/%%[OC]:([^%]*)%%/g, (full, content: string) =>
    PREPOSITION.test(content.trim()) ? `%%M:${content}%%` : full);
  // there + be の直後に続く C/O タグ列（間の「, and」等は許容）を S へ
  const marker = /%%M:[Tt]here%%\s*%%VB:(?:is|are|was|were)\b[^%]*%%/g;
  let out = "", last = 0;
  let m: RegExpExecArray | null;
  while ((m = marker.exec(text)) !== null) {
    if (m.index < last) continue;
    const start = m.index + m[0].length;
    out += text.slice(last, start);
    let i = start;
    for (;;) {
      const rest = text.slice(i);
      const gap = /^(?:[\s,]|and\s|or\s)*/.exec(rest)![0];
      const tag = /^%%[OC]:([^%]*)%%/.exec(rest.slice(gap.length));
      if (!tag) break;
      out += gap + `%%S:${tag[1]}%%`;
      i += gap.length + tag[0].length;
    }
    last = i;
  }
  out += text.slice(last);
  return out;
}

// 行をまたぐ **太字** を行ごとの **太字** に分割する（インライン処理は行単位のため）。
// コードフェンス内は触らない。
function normalizeMultilineBold(text: string): string {
  const parts = text.split(/(```[\s\S]*?(?:```|$))/);
  return parts.map((part, idx) =>
    idx % 2 === 1 ? part : part.replace(/\*\*([^*]+?)\*\*/g, (full, inner: string) =>
      inner.includes("\n") ? "**" + inner.replace(/\n/g, "**\n**") + "**" : full)
  ).join("");
}

export function buildHtml(text: string): string {
  if (!text.trim()) return "";
  text = normalizeSvocTags(text);
  text = normalizeMultilineBold(text);
  if (text.includes("%%ORIG%%")) {
    const html = bilingual(text);
    if (html) return html;
  }
  return markdown(text);
}
