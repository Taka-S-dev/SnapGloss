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
  $("wrapper").classList.remove("split", "chat");
  c.style.flex = "";
  $("content-followup").innerHTML = "";
  // ボタン自体の textContent を書き換えるとアイコンとラベル要素が消えるので、ラベルだけ戻す
  $("copy-label").textContent = "コピー";
  $("copy-btn").classList.remove("copied");
  const fi = $("followup-input") as HTMLTextAreaElement;
  fi.value = "";
  fi.style.height = "auto";
  c.scrollTop = 0;
  setTimeout(() => ($("followup-input") as HTMLInputElement).focus(), 50);
}

export function resetContent(hotkeyStr = "ctrl+shift+z") {
  state.rawText = "";
  state.conv = { prompt: "", inputText: "", lastResult: "", mode: "", history: [] };
  const hotkey = hotkeyStr.toUpperCase().replace(/\+/g, " + ");
  $("content").innerHTML = `<div id="empty"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>テキストを選択して ${hotkey} を押すと処理されます</div>`;
  $("content-followup").innerHTML = "";
  $("wrapper").classList.remove("split", "chat");
  ($("content") as HTMLElement).style.flex = "";
  $("followup-area").classList.remove("visible");
  $("error-box").style.display = "none";
  $("mode-label").textContent = "";
}

const CHAT_EMPTY_HINT = `<div class="chat-empty">質問を入力して Enter で送信</div>`;

/** 翻訳文脈なしの AI チャット画面に切り替える（スレッドペインを全画面にする） */
export function enterChatMode() {
  state.rawText = "";
  state.conv = { prompt: "", inputText: "", lastResult: "", mode: "チャット", history: [] };
  clearHighlights();
  $("content").innerHTML = "";
  $("content-followup").innerHTML = CHAT_EMPTY_HINT;
  $("wrapper").classList.remove("split");
  $("wrapper").classList.add("chat");
  ($("content") as HTMLElement).style.flex = "";
  $("mode-label").textContent = "チャット";
  $("error-box").style.display = "none";
  $("followup-area").classList.add("visible");
  const fi = $("followup-input") as HTMLTextAreaElement;
  fi.value = "";
  fi.style.height = "auto";
  setTimeout(() => fi.focus(), 50);
}

/** フォローアップの会話だけをリセットする（メイン結果と原文の文脈は残す） */
export function clearFollowupThread() {
  const h = state.conv.history;
  if (h.length === 0) return;
  // チャットモード（原文なし）は履歴の先頭2件が文脈ではないので全消しする
  const ctx = state.conv.inputText ? 2 : 0;
  state.conv.history = h.slice(0, ctx);
  state.conv.lastResult = ctx && h[1] ? h[1].content : "";
  clearHighlights();
  $("content-followup").innerHTML = ctx ? "" : CHAT_EMPTY_HINT;
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
