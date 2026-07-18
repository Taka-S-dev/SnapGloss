import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

import { state } from "./state";
import { loadSettings, initSettings } from "./settings";
import { FONT_BASE, FONT_MIN, FONT_MAX, PANE_MIN_HEIGHT, COPY_FEEDBACK_MS, FONT_INDICATOR_MS } from "./constants";
import { $, setLoading, resetContent, clearFollowupThread } from "./ui";
import { openSettings, closeSettings, initSettingsModal, applyTheme } from "./settings";
import { showModeOverlay, closeModeOverlay, initModeOverlay, runLastMode, runPrompt, resolveAutoRunPrompt } from "./modeOverlay";
import { initWordTooltip } from "./tooltip";
import { initContextMenu, showContextMenu } from "./contextMenu";
import { processFollowup, processText } from "./api";
import { initHistory, closeHistory, isHistoryOpen } from "./history";

let _copyTimer: ReturnType<typeof setTimeout> | null = null;
function showCopyFeedback() {
  const btn = $("copy-btn");
  $("copy-label").textContent = "コピー済 ✓";
  btn.classList.add("copied");
  if (_copyTimer) clearTimeout(_copyTimer);
  _copyTimer = setTimeout(() => {
    $("copy-label").textContent = "コピー";
    btn.classList.remove("copied");
  }, COPY_FEEDBACK_MS);
}

function submitFollowup() {
  const input = $("followup-input") as HTMLTextAreaElement;
  const text = input.value.trim();
  if (!text || !state.conv.lastResult) return;
  const mode = ($("followup-mode") as HTMLSelectElement).value as "qa" | "grammar";
  input.value = "";
  input.style.height = "auto";
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
  // 設定ファイルを最初に読み込む（以降の loadSettings は同期キャッシュ）
  await initSettings();
  applyTheme();
  // 「自動」のとき OS のテーマ切替に即追従する
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

  await listen<string>("hotkey-fired", event => {
    // オーバーレイ表示中にもう一度ホットキー → 前回モードで即実行
    if ($("mode-overlay").classList.contains("open")) {
      runLastMode(event.payload);
      return;
    }
    // 設定・履歴が開いたままだと重なって表示されるので、先に閉じる
    if ($("settings-overlay").classList.contains("open")) closeSettings();
    if (isHistoryOpen()) closeHistory();
    // 即実行が設定されていて取得テキストがあれば、モード選択を飛ばす
    const auto = resolveAutoRunPrompt(loadSettings().autoRun);
    if (auto && event.payload.trim()) {
      runPrompt(event.payload, auto);
      return;
    }
    showModeOverlay(event.payload);
  });

  await getCurrentWindow().onCloseRequested(event => {
    event.preventDefault();
    invoke("hide_window");
  });

  // オプション：フォーカスが外れたら自動で隠す（設定でオンにした場合のみ）
  // タイトルバーのクリックやドラッグでも WebView は一時的に blur するため、
  // 少し待ってからウィンドウ自体が非アクティブになったかを確認して判定する
  let autoHideTimer: ReturnType<typeof setTimeout> | null = null;
  await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
    if (focused) {
      if (autoHideTimer) { clearTimeout(autoHideTimer); autoHideTimer = null; }
      return;
    }
    if (!loadSettings().autoHide) return;
    autoHideTimer = setTimeout(async () => {
      autoHideTimer = null;
      if (await getCurrentWindow().isFocused().catch(() => true)) return;
      // モード選択が開いたまま隠れると、次のホットキーが「2度押し」扱いになるので閉じておく
      closeModeOverlay();
      invoke("hide_window");
    }, 250);
  });

  initSettingsModal();
  initModeOverlay();
  initWordTooltip();
  initContextMenu();
  initPaneSep();
  initHistory();

  for (const id of ["content", "content-followup"]) {
    $(id).addEventListener("contextmenu", e => {
      const selected = window.getSelection()?.toString().trim();
      const spanWord = (e.target as HTMLElement).closest<HTMLElement>("span.w")?.textContent?.trim();
      const word = selected || spanWord;
      if (word) { e.preventDefault(); showContextMenu(e.clientX, e.clientY, word); }
    });
  }

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
    showCopyFeedback();
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
  // 即実行オプション使用時の逃げ道：モード名クリックでモード選択を開く
  $("mode-label").title = "クリックでモード選択を開く";
  $("mode-label").addEventListener("click", () => showModeOverlay(state.lastCall?.text ?? ""));
  $("help-btn").addEventListener("click", () => $("help-overlay").classList.toggle("open"));
  $("help-overlay").addEventListener("click", e => {
    if (e.target === $("help-overlay")) $("help-overlay").classList.remove("open");
  });
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
  $("followup-clear").addEventListener("click", clearFollowupThread);
  const followupInput = $("followup-input") as HTMLTextAreaElement;
  followupInput.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitFollowup(); }
  });
  // 入力量に応じて欄を伸ばす（上限は CSS の max-height）
  followupInput.addEventListener("input", () => {
    followupInput.style.height = "auto";
    followupInput.style.height = followupInput.scrollHeight + "px";
  });

  // キーボードショートカット
  document.addEventListener("keydown", async e => {
    if (e.key === "Escape") {
      if ($("mode-overlay").classList.contains("open"))     { closeModeOverlay(); invoke("hide_window"); }
      else if ($("settings-overlay").classList.contains("open")) closeSettings();
      else if (isHistoryOpen()) closeHistory();
      else if ($("help-overlay").classList.contains("open")) $("help-overlay").classList.remove("open");
      else { resetContent(); invoke("hide_window"); }
    } else if (e.key === "c" && e.ctrlKey && !e.shiftKey && !e.altKey) {
      if (state.rawText && !window.getSelection()?.toString()) {
        e.preventDefault();
        await writeText(state.rawText);
        showCopyFeedback();
      }
    }
  });

  resetContent();

  // 起動完了後にウィンドウを表示する（設定の visible: false は初期描画のちらつき防止。
  // 非表示のままだと起動に気づけないため、案内付きの空状態を最初に見せる）
  await invoke("show_window");
}

init();
