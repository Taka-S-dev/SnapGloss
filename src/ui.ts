import { state } from "./state";
import { NOTICE_DURATION_MS } from "./constants";
import { renderMermaidIn } from "./mermaidRender";

export const $ = (id: string) => document.getElementById(id)!;

export function setLoading(on: boolean, label = "処理中…") {
  $("loading-bar").style.display = on ? "block" : "none";
  $("loading-overlay").classList.toggle("on", on);
  $("loading-label").textContent = on ? label : "";
  ($("followup-send") as HTMLButtonElement).disabled = on;
  ($("followup-input") as HTMLTextAreaElement).disabled = on;
  ($("followup-clear") as HTMLButtonElement).disabled = on;
}

export function wrapWordsInContent(root: HTMLElement) {
  const pattern = /[a-zA-Z]+/g;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let n;
  while ((n = walker.nextNode())) {
    if ((n as Text).parentElement?.closest("rt")) continue;
    nodes.push(n as Text);
  }
  for (const node of nodes) {
    const text = node.textContent ?? "";
    pattern.lastIndex = 0;
    if (!pattern.test(text)) continue;
    pattern.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0, m;
    while ((m = pattern.exec(text)) !== null) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const span = document.createElement("span");
      span.className = "w";
      span.textContent = m[0];
      frag.appendChild(span);
      last = pattern.lastIndex;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode?.replaceChild(frag, node);
  }
}

export function updateContent(html: string, mode: string) {
  const c = $("content");
  c.style.fontSize = state.fontSize + "px";
  c.innerHTML = html;
  wrapWordsInContent(c);
  void renderMermaidIn(c);
  $("mode-label").textContent = mode;
  $("error-box").style.display = "none";
  $("notice").style.display = "none";
  $("followup-area").classList.add("visible");
  $("wrapper").classList.remove("split");
  c.style.flex = "";
  $("content-followup").innerHTML = "";
  const btn = $("copy-btn");
  btn.textContent = "コピー"; btn.classList.remove("copied");
  const fi = $("followup-input") as HTMLTextAreaElement;
  fi.value = "";
  fi.style.height = "auto";
  c.scrollTop = 0;
  setTimeout(() => ($("followup-input") as HTMLInputElement).focus(), 50);
}

export function resetContent() {
  state.rawText = "";
  state.conv = { prompt: "", inputText: "", lastResult: "", mode: "", history: [] };
  const hotkey = (localStorage.getItem("snap-gloss:hotkey") ?? "ctrl+shift+z").toUpperCase().replace(/\+/g, " + ");
  $("content").innerHTML = `<div id="empty"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>テキストを選択して ${hotkey} を押すと処理されます</div>`;
  $("content-followup").innerHTML = "";
  $("wrapper").classList.remove("split");
  ($("content") as HTMLElement).style.flex = "";
  $("followup-area").classList.remove("visible");
  $("error-box").style.display = "none";
  $("mode-label").textContent = "";
}

/** フォローアップの会話だけをリセットする（メイン結果と原文の文脈は残す） */
export function clearFollowupThread() {
  const h = state.conv.history;
  if (h.length === 0) return;
  state.conv.history = h.slice(0, 2);
  if (h[1]) state.conv.lastResult = h[1].content;
  clearHighlights();
  $("content-followup").innerHTML = "";
  $("wrapper").classList.remove("split");
  ($("content") as HTMLElement).style.flex = "";
  ($("followup-input") as HTMLTextAreaElement).focus();
}

export function clearHighlights() {
  $("content").querySelectorAll("mark.hl-content").forEach(mark => {
    while (mark.firstChild) mark.parentNode?.insertBefore(mark.firstChild, mark);
    mark.remove();
  });
  $("content").querySelectorAll("span.w.hl-content").forEach(s => s.classList.remove("hl-content"));
}

function wrapGapBetween(spanA: HTMLElement, spanB: HTMLElement) {
  const ancA: Node[] = [], ancB: Node[] = [];
  let n: Node | null = spanA;
  while (n) { ancA.push(n); n = n.parentNode; }
  n = spanB;
  while (n) { ancB.push(n); n = n.parentNode; }

  let childA: Node | null = null, childB: Node | null = null;
  for (const a of ancA) {
    const bi = ancB.indexOf(a);
    if (bi >= 0) {
      childA = ancA[ancA.indexOf(a) - 1];
      childB = ancB[bi - 1];
      break;
    }
  }
  if (!childA || !childB || childA === childB) return;

  const toWrap: Text[] = [];
  let cur: Node | null = childA.nextSibling;
  while (cur && cur !== childB) {
    if (cur.nodeType === Node.TEXT_NODE && /^\s+$/.test(cur.textContent ?? "")) toWrap.push(cur as Text);
    cur = cur.nextSibling;
  }
  for (const t of toWrap) {
    const mark = document.createElement("mark");
    mark.className = "hl-content";
    t.parentNode?.insertBefore(mark, t);
    mark.appendChild(t);
  }
}

export function highlightInContent(words: string[]) {
  if (!words.length) return;
  const content = $("content");
  const spans = Array.from(content.querySelectorAll<HTMLElement>("span.w"));

  for (const phrase of words) {
    const tokens = phrase.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    for (let i = 0; i <= spans.length - tokens.length; i++) {
      let match = true;
      for (let j = 0; j < tokens.length; j++) {
        if ((spans[i + j].textContent ?? "").toLowerCase() !== tokens[j]) { match = false; break; }
      }
      if (!match) continue;
      for (let j = 0; j < tokens.length; j++) spans[i + j].classList.add("hl-content");
      // マッチしたスパン間のスペースのみギャップ埋め
      for (let j = 0; j < tokens.length - 1; j++) wrapGapBetween(spans[i + j], spans[i + j + 1]);
    }
  }
}

export function showError(msg: string) {
  const el = $("error-box");
  el.textContent = msg; el.style.display = "block";
}

export function showNotice(msg: string) {
  const el = $("notice");
  el.textContent = msg; el.style.display = "block";
  setTimeout(() => el.style.display = "none", NOTICE_DURATION_MS);
}
