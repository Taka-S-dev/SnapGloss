import { state, type Prompt } from "./state";
import { loadSettings, saveSettings } from "./settings";
import { $, setLoading, showNotice } from "./ui";
import { processText } from "./api";
import { findHistory, restoreEntry } from "./history";
import { detectTextKind, TEXT_KIND_LABELS } from "./textKind";
import { showModeOverlay } from "./modeOverlay";

// ツールバーのモード名をクリックすると開く小さなメニュー。
// 「まず既定で実行し、違えばここで切り替える」ための導線。本文のレイアウトには触らない
// （行を差し込むと完了時に本文が動いて画面が切り替わったように見える）。
// 切り替えは常に一時的で、既定を変えるのは「既定にする」を押したときだけ。

const PIN_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 3h6l-1 7 3 3H7l3-3z"/></svg>`;

function closeMenu() { $("mode-menu").classList.remove("open"); }

/** 別モードで処理し直す。同じ原文を同じモードで処理済みなら API を叩かずに履歴から出す */
function switchMode(p: Prompt) {
  closeMenu();
  const call = state.lastCall;
  if (!call || p.name === call.modeName) return;
  const cached = findHistory(call.text, p.name);
  if (cached) {
    restoreEntry(cached);
    showNotice("履歴から表示しました（API は呼んでいません）");
    return;
  }
  localStorage.setItem("snap-gloss:lastMode", p.name);
  setLoading(true, p.name);
  processText(call.text, p.name, p.text);
}

/** 同じモードで API を呼び直す（履歴から復元した古い結果を引き直す、プロンプト修正後に確かめる） */
function rerun() {
  closeMenu();
  const call = state.lastCall;
  if (!call) return;
  setLoading(true, call.modeName);
  processText(call.text, call.modeName, call.prompt);
}

function pinAsDefault(modeName: string, text: string) {
  closeMenu();
  const s = loadSettings();
  const kind = detectTextKind(text);
  saveSettings({ ...s, defaultModes: { ...s.defaultModes, [kind]: modeName } });
  showNotice(`「${TEXT_KIND_LABELS[kind]}」の既定を「${modeName}」にしました`);
}

function item(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = cls;
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function openMenu() {
  const menu = $("mode-menu");
  const call = state.lastCall;
  if (!call || !call.text.trim()) return;
  const s = loadSettings();
  const kind = detectTextKind(call.text);
  const def = s.defaultModes[kind];
  menu.innerHTML = "";
  for (const p of s.prompts) {
    const b = item(p.name, "mm-item", () => switchMode(p));
    b.classList.toggle("active", p.name === call.modeName);
    if (p.name === def) {
      b.classList.add("default");
      b.title = `${TEXT_KIND_LABELS[kind]}の既定モード`;
    }
    menu.appendChild(b);
  }
  const sep = document.createElement("div");
  sep.className = "mm-sep";
  menu.appendChild(sep);
  menu.appendChild(item(`「${call.modeName}」でもう一度実行`, "mm-item mm-more", rerun));
  // 表示中のモードが既定でないときだけ、既定にする手段を出す
  if (call.modeName !== def) {
    const pin = item("", "mm-item mm-pin", () => pinAsDefault(call.modeName, call.text));
    pin.innerHTML = `${PIN_ICON}<span>「${call.modeName}」を${TEXT_KIND_LABELS[kind]}の既定にする</span>`;
    menu.appendChild(pin);
  }
  menu.appendChild(item("モード選択を開く…", "mm-item mm-more", () => {
    closeMenu();
    showModeOverlay(call.text);
  }));
  menu.classList.add("open");
}

export function initModeTabs() {
  const label = $("mode-label");
  label.title = "クリックでモードを切り替え";
  label.addEventListener("click", e => {
    e.stopPropagation();
    if ($("mode-menu").classList.contains("open")) { closeMenu(); return; }
    // 結果がない（空状態・チャット）ときは従来どおりモード選択を開く
    if (!state.lastCall) { showModeOverlay(""); return; }
    openMenu();
  });
  document.addEventListener("click", e => {
    if (!(e.target as HTMLElement).closest("#mode-menu")) closeMenu();
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenu(); });
  document.addEventListener("snap-gloss:result-started", closeMenu);
  document.addEventListener("snap-gloss:result-cleared", closeMenu);
}
