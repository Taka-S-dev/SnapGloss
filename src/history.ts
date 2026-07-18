import { state } from "./state";
import { buildHtml } from "./renderer";
import { $, updateContent } from "./ui";
import { HISTORY_MAX } from "./constants";

export interface HistoryEntry {
  mode: string;
  prompt: string;
  input: string;
  result: string;
  ts: number;
}

const KEY = "snap-gloss:history";

export function getHistory(): HistoryEntry[] {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function addHistory(entry: HistoryEntry) {
  const list = [entry, ...getHistory()].slice(0, HISTORY_MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // 容量超過時は古い半分を捨てて再試行
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, Math.ceil(list.length / 2)))); } catch { /* 保存は諦める */ }
  }
}

function removeEntry(ts: number) {
  localStorage.setItem(KEY, JSON.stringify(getHistory().filter(e => e.ts !== ts)));
}

function clearHistory() {
  localStorage.removeItem(KEY);
}

function restoreEntry(e: HistoryEntry) {
  state.rawText = e.result;
  state.conv = {
    prompt: e.prompt, inputText: e.input, lastResult: e.result, mode: e.mode,
    history: [
      { role: "user",      content: e.input },
      { role: "assistant", content: e.result },
    ],
  };
  state.lastCall = { text: e.input, modeName: e.mode, prompt: e.prompt };
  updateContent(buildHtml(e.result), e.mode);
  $("retry-box").style.display = "none";
  closeHistory();
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return sameDay ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

function renderList() {
  const list = $("history-list");
  list.innerHTML = "";
  const entries = getHistory();
  ($("history-clear") as HTMLButtonElement).style.display = entries.length ? "" : "none";
  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "履歴はまだありません";
    list.appendChild(empty);
    return;
  }
  for (const e of entries) {
    const item = document.createElement("div");
    item.className = "history-item";
    const head = document.createElement("div");
    head.className = "history-head";
    const modeEl = document.createElement("span");
    modeEl.className = "history-mode";
    modeEl.textContent = e.mode;
    const timeEl = document.createElement("span");
    timeEl.className = "history-time";
    timeEl.textContent = fmtTime(e.ts);
    const delEl = document.createElement("button");
    delEl.className = "history-del";
    delEl.textContent = "✕";
    delEl.title = "この履歴を削除";
    delEl.addEventListener("click", ev => {
      ev.stopPropagation();
      removeEntry(e.ts);
      renderList();
    });
    head.append(modeEl, timeEl, delEl);
    const snippet = document.createElement("div");
    snippet.className = "history-snippet";
    snippet.textContent = e.input.replace(/\s+/g, " ").slice(0, 60);
    item.append(head, snippet);
    item.addEventListener("click", () => restoreEntry(e));
    list.appendChild(item);
  }
}

// 全削除の誤クリック防止（1回目で確認表示、2回目で実行）
let _clearArmed = false;
function resetClearButton() {
  _clearArmed = false;
  const btn = $("history-clear");
  btn.textContent = "全削除";
  btn.classList.remove("armed");
}

export function openHistory() {
  resetClearButton();
  renderList();
  $("history-overlay").classList.add("open");
}

export function closeHistory() {
  resetClearButton();
  $("history-overlay").classList.remove("open");
}

export function isHistoryOpen(): boolean {
  return $("history-overlay").classList.contains("open");
}

export function initHistory() {
  $("history-btn").addEventListener("click", () => {
    if (isHistoryOpen()) closeHistory();
    else openHistory();
  });
  $("history-overlay").addEventListener("click", e => {
    if (e.target === $("history-overlay")) closeHistory();
  });
  $("history-clear").addEventListener("click", () => {
    if (!_clearArmed) {
      _clearArmed = true;
      const btn = $("history-clear");
      btn.textContent = "もう一度クリックで全削除";
      btn.classList.add("armed");
      return;
    }
    clearHistory();
    resetClearButton();
    renderList();
  });
}
