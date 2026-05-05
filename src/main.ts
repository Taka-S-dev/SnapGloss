import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

import { state } from "./state";
import { loadSettings } from "./settings";
import { FONT_BASE, FONT_MIN, FONT_MAX, PANE_MIN_HEIGHT, COPY_FEEDBACK_MS, FONT_INDICATOR_MS } from "./constants";
import { $, setLoading, resetContent } from "./ui";
import { openSettings, closeSettings, initSettingsModal } from "./settings";
import { showModeOverlay, closeModeOverlay, initModeOverlay } from "./modeOverlay";
import { initWordTooltip } from "./tooltip";
import { initContextMenu, showContextMenu } from "./contextMenu";
import { processFollowup, processText } from "./api";

function submitFollowup() {
  const input = $("followup-input") as HTMLInputElement;
  const text = input.value.trim();
  if (!text || !state.conv.lastResult) return;
  const mode = ($("followup-mode") as HTMLSelectElement).value as "qa" | "grammar";
  input.value = "";
  setLoading(true, mode === "grammar" ? "文法解析中…" : "追加質問中…");
  processFollowup(text, mode);
}

function initPaneSep() {
  const sep = $("pane-sep");
  let dragging = false, startY = 0, startContentH = 0;

  sep.addEventListener("mousedown", e => {
    dragging = true;
    startY = e.clientY;
    startContentH = $("content").getBoundingClientRect().height;
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  });
  document.addEventListener("mousemove", e => {
    if (!dragging) return;
    const wrapperH = $("wrapper").getBoundingClientRect().height;
    const newH = Math.min(Math.max(startContentH + (e.clientY - startY), PANE_MIN_HEIGHT), wrapperH - PANE_MIN_HEIGHT);
    const pct = (newH / wrapperH) * 100;
    ($("content") as HTMLElement).style.flex = `0 0 ${pct}%`;
    localStorage.setItem("snap-gloss:splitPct", String(pct));
  });
  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });
}

async function init() {
  await listen<string>("hotkey-fired", event => {
    showModeOverlay(event.payload);
  });

  await getCurrentWindow().onCloseRequested(event => {
    event.preventDefault();
    invoke("hide_window");
  });

  initSettingsModal();
  initModeOverlay();
  initWordTooltip();
  initContextMenu();
  initPaneSep();

  $("content").addEventListener("contextmenu", e => {
    const selected = window.getSelection()?.toString().trim();
    const spanWord = (e.target as HTMLElement).closest<HTMLElement>("span.w")?.textContent?.trim();
    const word = selected || spanWord;
    if (word) { e.preventDefault(); showContextMenu(e.clientX, e.clientY, word); }
  });

  const savedHotkey = loadSettings().hotkey;
  if (savedHotkey !== "ctrl+shift+z") {
    invoke("register_shortcut", { shortcutStr: savedHotkey }).catch(() => {});
  }

  // ウィンドウサイズを復元
  const savedW = parseInt(localStorage.getItem("snap-gloss:winW") ?? "0");
  const savedH = parseInt(localStorage.getItem("snap-gloss:winH") ?? "0");
  if (savedW > 0 && savedH > 0) {
    getCurrentWindow().setSize(new LogicalSize(savedW, savedH)).catch(() => {});
  }
  let _resizeTimer: ReturnType<typeof setTimeout> | null = null;
  window.addEventListener("resize", () => {
    if (_resizeTimer) clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => {
      localStorage.setItem("snap-gloss:winW", String(window.innerWidth));
      localStorage.setItem("snap-gloss:winH", String(window.innerHeight));
    }, 400);
  });

  $("content").style.fontSize = state.fontSize + "px";
  $("content-followup").style.fontSize = state.followupFontSize + "px";

  // ツールバー
  $("copy-btn").addEventListener("click", async () => {
    if (!state.rawText) return;
    await writeText(state.rawText);
    const btn = $("copy-btn");
    btn.textContent = "コピー済 ✓"; btn.classList.add("copied");
    setTimeout(() => { btn.textContent = "コピー"; btn.classList.remove("copied"); }, COPY_FEEDBACK_MS);
  });
  let _fontIndicatorTimer: ReturnType<typeof setTimeout> | null = null;
  const showFontIndicator = (pct: number) => {
    const ind = $("font-indicator");
    ind.textContent = `${pct}%`;
    ind.classList.add("visible");
    if (_fontIndicatorTimer) clearTimeout(_fontIndicatorTimer);
    _fontIndicatorTimer = setTimeout(() => ind.classList.remove("visible"), FONT_INDICATOR_MS);
  };
  $("content-followup").addEventListener("wheel", e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    e.stopPropagation();
    state.followupFontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, state.followupFontSize + (e.deltaY < 0 ? 1 : -1)));
    $("content-followup").style.fontSize = state.followupFontSize + "px";
    localStorage.setItem("snap-gloss:followupFontSize", String(state.followupFontSize));
    showFontIndicator(Math.round((state.followupFontSize / FONT_BASE) * 100));
  }, { passive: false });
  $("wrapper").addEventListener("wheel", e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    state.fontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, state.fontSize + (e.deltaY < 0 ? 1 : -1)));
    $("content").style.fontSize = state.fontSize + "px";
    localStorage.setItem("snap-gloss:fontSize", String(state.fontSize));
    showFontIndicator(Math.round((state.fontSize / FONT_BASE) * 100));
  }, { passive: false });
  $("settings-btn").addEventListener("click", openSettings);
  $("retry-btn").addEventListener("click", () => {
    if (!state.lastCall) return;
    const { text, modeName, prompt } = state.lastCall;
    ($("retry-btn") as HTMLButtonElement).disabled = true;
    setLoading(true, modeName);
    processText(text, modeName, prompt).finally(() => {
      ($("retry-btn") as HTMLButtonElement).disabled = false;
    });
  });

  // フォローアップ
  $("followup-mode").addEventListener("change", () => {
    const isGrammar = ($("followup-mode") as HTMLSelectElement).value === "grammar";
    $("followup-area").classList.toggle("grammar-mode", isGrammar);
  });
  $("followup-send").addEventListener("click", submitFollowup);
  ($("followup-input") as HTMLInputElement).addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitFollowup(); }
  });

  // キーボードショートカット
  document.addEventListener("keydown", async e => {
    if (e.key === "Escape") {
      if ($("mode-overlay").classList.contains("open"))     { closeModeOverlay(); invoke("hide_window"); }
      else if ($("settings-overlay").classList.contains("open")) closeSettings();
      else { resetContent(); invoke("hide_window"); }
    } else if (e.key === "c" && e.ctrlKey && !e.shiftKey && !e.altKey) {
      if (state.rawText && !window.getSelection()?.toString()) {
        e.preventDefault();
        await writeText(state.rawText);
        const btn = $("copy-btn");
        btn.textContent = "コピー済 ✓"; btn.classList.add("copied");
        setTimeout(() => { btn.textContent = "コピー"; btn.classList.remove("copied"); }, COPY_FEEDBACK_MS);
      }
    }
  });

  resetContent();
}

init();
