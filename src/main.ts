import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

import { state } from "./state";
import { loadSettings, initSettings } from "./settings";
import { FONT_BASE, FONT_MIN, FONT_MAX, PANE_MIN_HEIGHT, COPY_FEEDBACK_MS, FONT_INDICATOR_MS } from "./constants";
import { $, setLoading, resetContent, clearFollowupThread } from "./ui";
import { openSettings, closeSettings, initSettingsModal, applyTheme } from "./settings";
import { enlargeForOverlay, restoreAfterOverlay, isTemporaryResize, SANE_MIN_W, SANE_MIN_H } from "./windowFit";
import { showModeOverlay, closeModeOverlay, initModeOverlay, runLastMode, runPrompt, resolveAutoRunPrompt,
         setModePending, isModePending, fillPendingText, consumePendingCancel } from "./modeOverlay";
import { initWordTooltip } from "./tooltip";
import { initContextMenu, showContextMenu } from "./contextMenu";
import { processFollowup, processText } from "./api";
import { toPlainText } from "./renderer";
import { initHistory, closeHistory, isHistoryOpen } from "./history";
import { initModeTabs } from "./modeTabs";

let _copyTimer: ReturnType<typeof setTimeout> | null = null;
function showCopyFeedback() {
  const btn = $("copy-btn");
  $("copy-label").textContent = "コピー済 ✓";
  btn.classList.add("copied");
  if (_copyTimer) clearTimeout(_copyTimer);
  _copyTimer = setTimeout(() => {
    $("copy-label").textContent = "";
    btn.classList.remove("copied");
  }, COPY_FEEDBACK_MS);
}

// 追加質問の入力行は、読んでいる間は畳んで「AIに質問」ボタンだけにしておき、
// ボタン・文字入力・Enter のいずれかで開く。空のまま Esc で閉じる
function isComposing(): boolean { return $("followup-area").classList.contains("composing"); }

function openComposer(prefill = "") {
  const area = $("followup-area");
  if (!area.classList.contains("visible")) return;
  const input = $("followup-input") as HTMLTextAreaElement;
  area.classList.add("composing");
  if (prefill) {
    input.value += prefill;
    area.classList.add("has-text");
  }
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function closeComposerIfEmpty(): boolean {
  const input = $("followup-input") as HTMLTextAreaElement;
  if (!isComposing() || input.value.trim()) return false;
  // 会話が続いている間（スプリット表示・チャット）は畳まない
  if ($("wrapper").classList.contains("split") || $("wrapper").classList.contains("chat")) return false;
  input.value = "";
  $("followup-area").classList.remove("composing", "has-text");
  input.blur();
  return true;
}

// 本文を読んでいるときに文字を打ち始めたら、その文字ごと入力行を開く
function shouldOpenComposerOnKey(e: KeyboardEvent): boolean {
  if (!$("followup-area").classList.contains("visible") || isComposing()) return false;
  if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return false;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return false;
  for (const id of ["mode-overlay", "settings-overlay", "help-overlay", "history-overlay"]) {
    if ($(id).classList.contains("open")) return false;
  }
  return e.key === "Enter" || e.key.length === 1;
}

function submitFollowup() {
  const input = $("followup-input") as HTMLTextAreaElement;
  const text = input.value.trim();
  // チャットモードは翻訳結果（lastResult）なしで会話を始められる
  if (!text) return;
  if (!state.conv.lastResult && state.conv.mode !== "チャット") return;
  const mode = ($("followup-mode") as HTMLSelectElement).value as "qa" | "grammar";
  input.value = "";
  input.style.height = "auto";
  $("followup-area").classList.remove("has-text");
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

  // 元アプリがコピーを始めた合図。テキストが読めるまで 1 秒以上かかることがあるので、
  // 先にオーバーレイを開いて取得中であることを見せる
  await listen("hotkey-pending", () => {
    if ($("mode-overlay").classList.contains("open")) return;
    if ($("settings-overlay").classList.contains("open")) closeSettings();
    if (isHistoryOpen()) closeHistory();
    showModeOverlay("");
    setModePending(true);
  });

  await listen<string>("hotkey-fired", event => {
    // 取得を待っている間に閉じられていたら、遅れて届いたテキストで開き直さない
    if (consumePendingCancel()) return;

    if (isModePending()) {
      // 取得できなかった（選択なし・コピー失敗）ときは、空欄のまま手入力を待つ
      if (!event.payload.trim()) { setModePending(false); return; }
      const auto = resolveAutoRunPrompt(loadSettings().autoRun, event.payload);
      if (auto) {
        setModePending(false);
        runPrompt(event.payload, auto);
        return;
      }
      fillPendingText(event.payload);
      return;
    }

    // オーバーレイ表示中にもう一度ホットキー → 前回モードで即実行
    if ($("mode-overlay").classList.contains("open")) {
      runLastMode(event.payload);
      return;
    }
    // 設定・履歴が開いたままだと重なって表示されるので、先に閉じる
    if ($("settings-overlay").classList.contains("open")) closeSettings();
    if (isHistoryOpen()) closeHistory();
    // 即実行が設定されていて取得テキストがあれば、モード選択を飛ばす
    const auto = resolveAutoRunPrompt(loadSettings().autoRun, event.payload);
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
  initModeTabs();

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
  // 異常に小さい保存値（過渡状態で保存されたもの）は使わず、設定の既定サイズのままにする
  if (savedW >= SANE_MIN_W && savedH >= SANE_MIN_H) {
    // 失敗は権限不足（capabilities の core:window:allow-set-size）がほぼ唯一の原因なので、黙らせない
    getCurrentWindow().setSize(new LogicalSize(savedW, savedH)).catch(e => console.error("setSize failed:", e));
  }
  let _resizeTimer: ReturnType<typeof setTimeout> | null = null;
  window.addEventListener("resize", () => {
    if (_resizeTimer) clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => {
      // オーバーレイのための一時的な拡大と、過渡状態の異常な小ささは保存しない
      if (isTemporaryResize()) return;
      if (window.innerWidth < SANE_MIN_W || window.innerHeight < SANE_MIN_H) return;
      localStorage.setItem("snap-gloss:winW", String(window.innerWidth));
      localStorage.setItem("snap-gloss:winH", String(window.innerHeight));
    }, 400);
  });

  $("content").style.fontSize = state.fontSize + "px";
  $("content-followup").style.fontSize = state.followupFontSize + "px";

  // 下のバーのボタン
  $("copy-btn").addEventListener("click", async () => {
    if (!state.rawText) return;
    await writeText(toPlainText(state.rawText));
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
  // モード名クリックの挙動は modeTabs.ts（切替メニュー）が持つ
  const openHelp  = () => { void enlargeForOverlay(); $("help-overlay").classList.add("open"); };
  const closeHelp = () => { $("help-overlay").classList.remove("open"); void restoreAfterOverlay(); };
  $("help-btn").addEventListener("click", () => {
    if ($("help-overlay").classList.contains("open")) closeHelp(); else openHelp();
  });
  $("help-overlay").addEventListener("click", e => {
    if (e.target === $("help-overlay")) closeHelp();
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
  $("ask-btn").addEventListener("click", () => openComposer());
  const followupInput = $("followup-input") as HTMLTextAreaElement;
  followupInput.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitFollowup(); }
  });
  // 入力量に応じて欄を伸ばす（上限は CSS の max-height）。
  // 文字があるときだけバーを「入力中」の見た目にする（styles.css の .has-text）
  followupInput.addEventListener("input", () => {
    $("followup-area").classList.toggle("has-text", followupInput.value.length > 0);
    followupInput.style.height = "auto";
    followupInput.style.height = followupInput.scrollHeight + "px";
  });

  // キーボードショートカット
  document.addEventListener("keydown", async e => {
    if (e.key === "Escape") {
      if ($("mode-overlay").classList.contains("open"))     { closeModeOverlay(); invoke("hide_window"); }
      else if ($("settings-overlay").classList.contains("open")) closeSettings();
      else if (isHistoryOpen()) closeHistory();
      else if ($("help-overlay").classList.contains("open")) { $("help-overlay").classList.remove("open"); void restoreAfterOverlay(); }
      else if (closeComposerIfEmpty()) { /* 入力行を畳んだだけ。ウィンドウは残す */ }
      else { resetContent(loadSettings().hotkey); invoke("hide_window"); }
    } else if (shouldOpenComposerOnKey(e)) {
      e.preventDefault();
      openComposer(e.key === "Enter" ? "" : e.key);
    } else if (e.key === "c" && e.ctrlKey && !e.shiftKey && !e.altKey) {
      if (state.rawText && !window.getSelection()?.toString()) {
        e.preventDefault();
        await writeText(toPlainText(state.rawText));
        showCopyFeedback();
      }
    }
  });

  resetContent(loadSettings().hotkey);

  // 起動完了後にウィンドウを表示する（設定の visible: false は初期描画のちらつき防止。
  // 非表示のままだと起動に気づけないため、案内付きの空状態を最初に見せる）
  await invoke("show_window");
}

init();
