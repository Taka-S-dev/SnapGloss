import { type Prompt, AUTO_RUN_BY_KIND, AUTO_RUN_LAST } from "./state";
import { loadSettings } from "./settings";
import { detectTextKind, looksLikeWord } from "./textKind";
import { $, setLoading, enterChatMode } from "./ui";
import { PENDING_INDICATOR_DELAY_MS } from "./constants";
import { processText } from "./api";

interface ModeItem { p: Prompt; num: number; }
let _filteredItems: ModeItem[] = [];
let _activeIdx = 0;

// AI チャットは通常モードとは別枠（リスト下の固定行と Tab キー）から入る
function startChat() {
  closeModeOverlay();
  enterChatMode();
}

// 全角英数字を半角に寄せる（IME オンのまま数字や英字を打ったケースの救済）
function normalizeQuery(query: string): string {
  return query
    .replace(/[０-９ａ-ｚＡ-Ｚ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toLowerCase()
    .trim();
}

// 一覧は件数が多いとき 2 列にする（縦 1 列だと 9 件でスクロールが要り、箱も背が高くなる）。
// 番号は左の列を上から、次に右の列、の順（grid-auto-flow: column）
const LIST_ROWS_FOR_TWO_COLUMNS = 6;
function listRows(n: number): number {
  return n > LIST_ROWS_FOR_TWO_COLUMNS ? Math.ceil(n / 2) : n;
}

function renderFilteredList(query: string) {
  const s = loadSettings();
  const q = normalizeQuery(query);
  // 番号はフィルタ前の並び順で固定。数字クエリは番号の前方一致で絞り込む
  const all = s.prompts.map((p, i) => ({ p, num: i + 1 }));
  _filteredItems =
    !q ? all :
    /^\d+$/.test(q) ? all.filter(it => String(it.num).startsWith(q)) :
    all.filter(it => it.p.name.toLowerCase().includes(q));
  _activeIdx = Math.min(_activeIdx, Math.max(_filteredItems.length - 1, 0));

  const list = $("mo-list");
  list.innerHTML = "";
  list.classList.toggle("two-col", _filteredItems.length > LIST_ROWS_FOR_TWO_COLUMNS);
  list.style.setProperty("--mo-rows", String(listRows(_filteredItems.length)));
  _filteredItems.forEach((it, i) => {
    const btn = document.createElement("button");
    const num = document.createElement("span");
    num.className = "mo-num";
    num.textContent = String(it.num);
    btn.appendChild(num);
    btn.appendChild(document.createTextNode(it.p.name));
    btn.classList.toggle("active", i === _activeIdx);
    btn.onclick = () => selectMode(it.p.name, it.p.text);
    btn.addEventListener("mouseenter", () => { _activeIdx = i; updateActiveBtn(); });
    list.appendChild(btn);
  });
}

function updateActiveBtn() {
  const btns = document.querySelectorAll<HTMLElement>("#mo-list button");
  btns.forEach((b, i) => b.classList.toggle("active", i === _activeIdx));
  btns[_activeIdx]?.scrollIntoView({ block: "nearest" });
}

function selectMode(modeName: string, prompt: string) {
  const text = ($("mo-text") as HTMLTextAreaElement).value.trim();
  if (!text) return;
  localStorage.setItem("snap-gloss:lastMode", modeName);
  closeModeOverlay();
  setLoading(true, modeName);
  processText(text, modeName, prompt);
}

/** 指定プロンプトで即実行する（オーバーレイを経由しない） */
export function runPrompt(text: string, p: Prompt) {
  const ta = $("mo-text") as HTMLTextAreaElement;
  ta.value = text;
  selectMode(p.name, p.text);
}

/** テキストの種類に対する既定モードのプロンプト。設定のモード名が消えていれば null */
export function defaultPromptFor(text: string): Prompt | null {
  const s = loadSettings();
  const name = s.defaultModes[detectTextKind(text)];
  return s.prompts.find(pr => pr.name === name) ?? null;
}

/** 設定の「即実行」値からプロンプトを解決する。見つからなければ null（＝モード選択を出す） */
export function resolveAutoRunPrompt(autoRun: string, text: string): Prompt | null {
  if (!autoRun) return null;
  if (autoRun === AUTO_RUN_BY_KIND) return defaultPromptFor(text);
  const prompts = loadSettings().prompts;
  const name = autoRun === AUTO_RUN_LAST ? localStorage.getItem("snap-gloss:lastMode") ?? "" : autoRun;
  return prompts.find(pr => pr.name === name) ?? null;
}

/** ホットキー2度押し用：前回使ったモードで即実行する */
export function runLastMode(text: string) {
  const ta = $("mo-text") as HTMLTextAreaElement;
  const t = text.trim() || ta.value.trim();
  if (!t) return;
  const prompts = loadSettings().prompts;
  const lastMode = localStorage.getItem("snap-gloss:lastMode");
  const p = prompts.find(pr => pr.name === lastMode) ?? prompts[0];
  if (!p) return;
  runPrompt(t, p);
}

// 選択範囲の取得待ち。Ctrl+C を送ってからテキストが読めるまで 1 秒以上かかることがあるので、
// その間はオーバーレイを先に出してプログレスを見せる（ホットキーが効いたことが分かるように）
let _pending = false;
let _cancelledWhilePending = false;
let _pendingTimer: ReturnType<typeof setTimeout> | null = null;

export function isModePending() { return _pending; }

export function setModePending(on: boolean) {
  _pending = on;
  if (_pendingTimer) { clearTimeout(_pendingTimer); _pendingTimer = null; }
  if (!on) { $("mode-box").classList.remove("pending"); return; }
  // 大半の取得は数十 ms で終わる。即座に出すとその都度ちらつくので、
  // 実際に待たされるときだけ表示する
  _pendingTimer = setTimeout(() => {
    _pendingTimer = null;
    $("mode-box").classList.add("pending");
  }, PENDING_INDICATOR_DELAY_MS);
}

/** 取得待ちの間に ESC 等で閉じられていたら true（一度読むとクリアされる）。
 *  遅れて届いたテキストでウィンドウが勝手に開き直すのを防ぐ */
export function consumePendingCancel(): boolean {
  const c = _cancelledWhilePending;
  _cancelledWhilePending = false;
  return c;
}

/** 取得待ちの状態に、届いたテキストを入れる */
export function fillPendingText(text: string) {
  const ta = $("mo-text") as HTMLTextAreaElement;
  const search = $("mo-search") as HTMLInputElement;
  // 待っている間にユーザーが打ち始めていたら、その入力を壊さない
  const untouched = ta.value === "" && search.value === "";
  setModePending(false);
  if (untouched) showModeOverlay(text);
}

export function closeModeOverlay() {
  if (_pending) {
    setModePending(false);
    _cancelledWhilePending = true;
  }
  $("mode-overlay").classList.remove("open");
}

// テキスト欄の高さを中身に合わせる。上限は CSS 側（箱の max-height と flex）が決めるので
// ここでは scrollHeight をそのまま入れるだけでよい。表示中でないと scrollHeight が 0 に
// なるので、オーバーレイを開いてから呼ぶこと
function fitTextarea(ta: HTMLTextAreaElement) {
  ta.style.height = "auto";
  ta.style.height = `${ta.scrollHeight + 2}px`; // +2 は上下 border
}

// ここでは windowFit の一時拡大を使わない。ホットキー直後は非アクティブ表示・位置決め・
// モニター間の再スケールが同時に走っていて、その途中で読んだサイズを「元のサイズ」として
// 覚えてしまい、戻すときに壊れる。低いウィンドウでは箱の中でスクロールさせる（styles.css）
export function showModeOverlay(text: string) {
  if (_pending) setModePending(false);
  const ta = $("mo-text") as HTMLTextAreaElement;
  ta.value = text;
  ta.scrollTop = 0;
  ($("mo-search") as HTMLInputElement).value = "";
  _activeIdx = 0;
  const prompts = loadSettings().prompts;
  const lastMode = localStorage.getItem("snap-gloss:lastMode");
  if (lastMode) {
    const idx = prompts.findIndex(p => p.name === lastMode);
    if (idx >= 0) _activeIdx = idx;
  }
  // 1〜3語の英単語・英フレーズなら辞書モードを初期選択にする
  if (looksLikeWord(text)) {
    const idx = prompts.findIndex(p => p.name.startsWith("辞書"));
    if (idx >= 0) _activeIdx = idx;
  }
  renderFilteredList("");
  $("mode-overlay").classList.add("open");
  fitTextarea(ta);
  ($("mo-search") as HTMLInputElement).focus();
}

export function initModeOverlay() {
  $("mode-overlay").addEventListener("click", e => {
    if (e.target === $("mode-overlay")) closeModeOverlay();
  });
  $("mo-chat").addEventListener("click", startChat);
  // ✕：テキストを消して質問などを打ち込むための導線
  $("mo-clear").addEventListener("click", () => {
    const ta = $("mo-text") as HTMLTextAreaElement;
    ta.value = "";
    fitTextarea(ta);
    ta.focus();
  });
  // テキスト欄から Ctrl+Enter で選択中モードを即実行。Tab は検索欄へ
  ($("mo-text") as HTMLTextAreaElement).addEventListener("keydown", e => {
    if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      const it = _filteredItems[_activeIdx];
      if (it) selectMode(it.p.name, it.p.text);
    } else if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      ($("mo-search") as HTMLInputElement).focus();
    }
  });
  // 番号入力が1件に絞れたら即実行（9個以下なら1桁で決まるので従来の一発実行と同じ）。
  // IME 変換中は確定前のテキストで暴発しないよう保留し、確定時に改めて判定する
  const maybeRunByNumber = (raw: string) => {
    const q = normalizeQuery(raw);
    if (/^\d+$/.test(q) && _filteredItems.length === 1) {
      const it = _filteredItems[0];
      selectMode(it.p.name, it.p.text);
    }
  };
  ($("mo-search") as HTMLInputElement).addEventListener("input", e => {
    _activeIdx = 0;
    const v = (e.target as HTMLInputElement).value;
    renderFilteredList(v);
    if (!(e as InputEvent).isComposing) maybeRunByNumber(v);
  });
  ($("mo-search") as HTMLInputElement).addEventListener("compositionend", e => {
    maybeRunByNumber((e.target as HTMLInputElement).value);
  });
  ($("mo-search") as HTMLInputElement).addEventListener("keydown", e => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      _activeIdx = Math.min(_activeIdx + 1, _filteredItems.length - 1);
      updateActiveBtn();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      _activeIdx = Math.max(_activeIdx - 1, 0);
      updateActiveBtn();
    } else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && _filteredItems.length > LIST_ROWS_FOR_TWO_COLUMNS) {
      // 2 列表示のとき ←→ で隣の列へ（番号は列ごとに上から振ってあるので 1 列分だけ跳ぶ）
      e.preventDefault();
      const rows = listRows(_filteredItems.length);
      const next = _activeIdx + (e.key === "ArrowRight" ? rows : -rows);
      if (next >= 0 && next < _filteredItems.length) { _activeIdx = next; updateActiveBtn(); }
    } else if (e.key === "Enter" && !e.isComposing) {
      // 変換確定の Enter で実行しない（モード名は日本語なので検索欄で IME を使う）
      e.preventDefault();
      const it = _filteredItems[_activeIdx];
      if (it) selectMode(it.p.name, it.p.text);
    } else if (e.key === "Tab") {
      // Tab で AI チャットに直行
      e.preventDefault();
      startChat();
    }
  });
}
