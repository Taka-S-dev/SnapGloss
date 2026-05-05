import { invoke } from "@tauri-apps/api/core";
import { loadSettings } from "./settings";
import { he } from "./renderer";
import { $ } from "./ui";
import { showContextMenu } from "./contextMenu";
import { TOOLTIP_TIMEOUT_MS } from "./constants";

let _tooltipAbort: AbortController | null = null;
const _tooltipCache = new Map<string, { ja: string; pos: string }>();
const _audioCache = new Map<string, Blob>();
let _currentWord = "";

// ── 同単語ハイライト ───────────────────────────────────────────────────────────
let _occWord = "";

function applyWordHighlights(word: string) {
  clearWordHighlights();
  if (word.length < 2) return;
  _occWord = word;
  const lower = word.toLowerCase();
  $("wrapper").querySelectorAll<HTMLElement>("span.w").forEach(span => {
    if ((span.textContent ?? "").toLowerCase() === lower) span.classList.add("word-occ");
  });
}

function clearWordHighlights() {
  $("wrapper").querySelectorAll("span.w.word-occ").forEach(s => s.classList.remove("word-occ"));
  _occWord = "";
}

async function speakWord(word: string) {
  const s = loadSettings();
  const apiKey = await invoke<string>("get_api_key");
  if (!apiKey) return;
  try {
    let blob = _audioCache.get(word);
    if (!blob) {
      const base = s.endpoint.replace(/\/chat\/completions$/, "");
      const res = await fetch(`${base}/audio/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({ model: "tts-1-hd", input: `${word}.`, voice: "shimmer" }),
      });
      if (!res.ok) return;
      blob = await res.blob();
      _audioCache.set(word, blob);
    }
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.play();
    audio.onended = () => URL.revokeObjectURL(url);
  } catch { /* silent fail */ }
}

function showTooltip(x: number, y: number, html: string, loading = false) {
  const tip = $("word-tooltip");
  tip.innerHTML = loading
    ? html
    : `${html}<button class="tip-speak" title="読み上げ">🔊</button>`;
  if (!loading) {
    tip.querySelector(".tip-speak")!.addEventListener("click", e => {
      e.stopPropagation();
      speakWord(_currentWord);
    });
  }
  tip.className = "visible" + (loading ? " loading" : "");
  const tx = Math.min(x + 8, window.innerWidth - 240);
  const ty = y - 44 < 0 ? y + 16 : y - 44;
  tip.style.left = tx + "px";
  tip.style.top  = ty + "px";
}

function hideTooltip() {
  $("word-tooltip").className = "";
  _tooltipAbort?.abort();
  _tooltipAbort = null;
}

async function lookupWord(word: string, sentence: string, translation: string, x: number, y: number) {
  _currentWord = word;
  const cacheKey = `${word}::${sentence}`;
  const cached = _tooltipCache.get(cacheKey);
  if (cached) {
    _tooltipAbort?.abort();
    _tooltipAbort = null;
    const posLabel = cached.pos ? `<span class="tip-pos-label">${he(cached.pos)}：</span>` : "";
    showTooltip(x, y, `${posLabel}<span class="tip-ja">${he(cached.ja)}</span><span class="tip-word">${he(word)}</span>`);
    return;
  }

  _tooltipAbort?.abort();
  _tooltipAbort = new AbortController();
  const signal = _tooltipAbort.signal;
  showTooltip(x, y, "調べています…", true);

  try {
    const s = loadSettings();
    const apiKey = await invoke<string>("get_api_key");
    if (!apiKey) { hideTooltip(); return; }
    const isLocal = s.endpoint.includes("localhost") || s.endpoint.includes("127.0.0.1");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (!isLocal) headers["Authorization"] = `Bearer ${apiKey}`;

    const context = translation
      ? `英文「${sentence}」の日本語訳は「${translation}」です。この文での`
      : `英文「${sentence}」での`;
    const body = JSON.stringify({
      model: s.model,
      messages: [{
        role: "user",
        content: `${context}「${word}」を次のJSON形式のみで答えてください:\n{"ja":"日本語訳","pos":"品詞"}\n品詞は 名詞/動詞/形容詞/副詞/前置詞/接続詞/代名詞/その他 のいずれか。${translation ? "訳は日本語訳から該当部分を優先。" : ""}`,
      }],
      max_tokens: 60,
      temperature: 0,
    });

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), TOOLTIP_TIMEOUT_MS)
    );
    const res = await Promise.race([
      fetch(s.endpoint, { method: "POST", headers, signal, body }),
      timeout,
    ]);

    if (signal.aborted) return;
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content?.trim() ?? "";

    let ja = word, pos = "";
    try {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) { const obj = JSON.parse(m[0]); ja = obj.ja ?? word; pos = obj.pos ?? ""; }
    } catch { ja = raw || word; }

    _tooltipCache.set(cacheKey, { ja, pos });
    const posLabel = pos ? `<span class="tip-pos-label">${he(pos)}：</span>` : "";
    showTooltip(x, y, `${posLabel}<span class="tip-ja">${he(ja)}</span><span class="tip-word">${he(word)}</span>`);
  } catch {
    if (!signal.aborted) hideTooltip();
  }
}

export function initWordTooltip() {
  $("wrapper").addEventListener("click", e => {
    const sel = window.getSelection()?.toString() ?? "";
    if (sel) return;
    const target = e.target as HTMLElement;
    const wSpan = target.closest<HTMLElement>("span.w");
    if (wSpan) {
      const word = wSpan.textContent ?? "";
      if (word === _occWord) { clearWordHighlights(); hideTooltip(); return; }
      applyWordHighlights(word);
      const origEl = wSpan.closest<HTMLElement>(".orig");
      if (origEl) {
        const sentence = origEl.textContent ?? "";
        const translation = origEl.closest<HTMLElement>(".pair")?.querySelector<HTMLElement>(".trans")?.textContent ?? "";
        lookupWord(word, sentence, translation, e.clientX, e.clientY);
      }
    } else {
      clearWordHighlights();
      hideTooltip();
    }
  });

  $("content").addEventListener("mouseup", async e => {
    const sel = window.getSelection();
    const word = sel?.toString().trim() ?? "";
    if (!word || word.length > 50 || word.split(/\s+/).length > 3) {
      hideTooltip(); return;
    }
    const range = sel?.getRangeAt(0);
    const origEl = (range?.commonAncestorContainer as Node)?.parentElement?.closest<HTMLElement>(".orig");
    if (!origEl) { hideTooltip(); return; }
    const sentence = origEl.textContent ?? "";
    const translation = origEl.closest<HTMLElement>(".pair")?.querySelector<HTMLElement>(".trans")?.textContent ?? "";
    await lookupWord(word, sentence, translation, e.clientX, e.clientY);
  });

  document.addEventListener("mousedown", e => {
    if (!($("word-tooltip") as HTMLElement).contains(e.target as Node)) {
      hideTooltip();
    }
  });

  $("word-tooltip").addEventListener("contextmenu", e => {
    e.preventDefault();
    if (_currentWord) showContextMenu(e.clientX, e.clientY, _currentWord);
  });
}
