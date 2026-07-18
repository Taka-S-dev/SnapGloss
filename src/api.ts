import { invoke } from "@tauri-apps/api/core";
import { state, type Message, ChatCompletionSchema, ChatCompletionChunkSchema } from "./state";
import { loadSettings } from "./settings";
import { buildHtml, extractTagValues, he } from "./renderer";
import { $, updateContent, showError, showNotice, setLoading, highlightInContent, clearHighlights, wrapWordsInContent } from "./ui";
import { renderMermaidIn } from "./mermaidRender";
import { API_TIMEOUT_MS, TEXT_MAX_LENGTH, SPLIT_DEFAULT_PCT, FOLLOWUP_HISTORY_MAX, STREAM_RENDER_INTERVAL_MS } from "./constants";
import { addHistory } from "./history";

const POS_INSTRUCTION = `\n\n英文中の品詞を以下のタグで囲んでください（英語テキストにのみ適用）：%%V:動詞%% %%N:名詞%% %%ADJ:形容詞%% %%ADV:副詞%%。日本語訳には適用しないでください。`;

// 進行中より古いリクエストの結果を捨てるための世代カウンター。
// processText / processFollowup で共有する（後勝ち）。
let _gen = 0;
export function nextGen(): number { return ++_gen; }
export function isStale(gen: number): boolean { return gen !== _gen; }

function httpErrorMessage(status: number, bodyText: string): string {
  let detail = "";
  try { detail = JSON.parse(bodyText)?.error?.message ?? ""; } catch { /* HTML など非JSONはそのまま無視 */ }
  const hint =
    status === 401 ? "APIキーが不正です" :
    status === 429 ? "レート制限または残高不足です" :
    status >= 500  ? "サーバー側のエラーです。時間をおいて再試行してください" : "";
  return `APIエラー (HTTP ${status})${detail ? `: ${detail}` : hint ? `: ${hint}` : ""}`;
}

// reader.read() を無応答タイムアウト付きで待つ。
// WebView2 では AbortController が不安定なため、タイマーとの race で確実に打ち切る。
async function readWithTimeout<T>(read: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`タイムアウト（${ms / 1000}秒間応答なし）`)), ms);
  });
  try {
    return await Promise.race([read, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Chat Completions API を stream: true で呼ぶ。
 * onDelta には蓄積済みの全文が渡される（差分ではない）。
 * SSE 非対応のエンドポイントは通常の JSON レスポンスにフォールバックする。
 */
export async function callApi(messages: Message[], onDelta?: (fullText: string) => void): Promise<string> {
  const s = loadSettings();
  const apiKey = await invoke<string>("get_api_key").catch(e => { throw new Error("APIキー読み取りエラー: " + e); });
  if (!apiKey) {
    throw new Error("APIキーが未設定です。⚙ 設定から入力してください。");
  }
  const isLocal = s.endpoint.includes("localhost") || s.endpoint.includes("127.0.0.1");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!isLocal) headers["Authorization"] = `Bearer ${apiKey}`;

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`タイムアウト（${API_TIMEOUT_MS / 1000}秒）`)), API_TIMEOUT_MS)
  );
  const res = await Promise.race([
    fetch(s.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(
        // o1/o3 系と GPT-5 系は max_tokens・temperature 指定を受け付けない
        /^(o\d|gpt-5)/.test(s.model)
          ? { model: s.model, messages, max_completion_tokens: s.maxTokens, stream: true }
          : { model: s.model, messages, temperature: s.temperature, max_tokens: s.maxTokens, stream: true }
      ),
    }),
    timeout,
  ]);

  if (!res.ok) {
    const bodyText = await readWithTimeout(res.text(), API_TIMEOUT_MS).catch(() => "");
    throw new Error(httpErrorMessage(res.status, bodyText));
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!res.body || !contentType.includes("text/event-stream")) {
    // ストリーム非対応エンドポイント（stream 指定を無視して JSON を返すケース）
    const data = ChatCompletionSchema.parse(await readWithTimeout(res.json(), API_TIMEOUT_MS));
    if (data.error) throw new Error(data.error.message);
    const content = data.choices?.[0]?.message.content;
    if (!content) throw new Error("レスポンスが空です");
    onDelta?.(content);
    return content;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "", full = "";
  try {
    for (;;) {
      const { done, value } = await readWithTimeout(reader.read(), API_TIMEOUT_MS);
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        let json: unknown;
        try { json = JSON.parse(payload); } catch { continue; }
        const chunk = ChatCompletionChunkSchema.safeParse(json);
        if (!chunk.success) continue;
        if (chunk.data.error) throw new Error(chunk.data.error.message);
        const delta = chunk.data.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          onDelta?.(full);
        }
      }
    }
  } catch (e) {
    reader.cancel().catch(() => {});
    throw e;
  }
  if (!full) throw new Error("レスポンスが空です");
  return full;
}

// ストリーミング中の途中経過を間引いて描画するレンダラーを作る
function makeStreamRenderer(render: (html: string) => void) {
  let lastRender = 0;
  let firstChunk = true;
  return (text: string) => {
    const now = performance.now();
    if (!firstChunk && now - lastRender < STREAM_RENDER_INTERVAL_MS) return;
    const html = buildHtml(text);
    if (!html.trim()) return;
    if (firstChunk) {
      // 最初の描画が出たらスピナーを外す（入力欄は完了まで無効のまま）
      $("loading-overlay").classList.remove("on");
      firstChunk = false;
    }
    lastRender = now;
    render(html);
  };
}

export async function processText(text: string, modeName: string, prompt: string) {
  const gen = nextGen();
  if (text.length > TEXT_MAX_LENGTH) {
    text = text.slice(0, TEXT_MAX_LENGTH) + "...";
    showNotice(`テキストが長いため先頭 ${TEXT_MAX_LENGTH} 文字のみ送信します`);
  }
  state.lastCall = { text, modeName, prompt };
  $("retry-box").style.display = "none";
  const renderPartial = makeStreamRenderer(html => {
    const c = $("content");
    c.style.fontSize = state.fontSize + "px";
    c.innerHTML = html;
    $("mode-label").textContent = modeName;
  });
  try {
    const isBilingual = prompt.includes("%%ORIG%%");
    const result = await callApi(
      [
        { role: "system", content: isBilingual ? prompt : prompt + POS_INSTRUCTION },
        { role: "user",   content: text },
      ],
      partial => { if (!isStale(gen)) renderPartial(partial); }
    );
    if (isStale(gen)) return;
    state.conv = {
      prompt, inputText: text, lastResult: result, mode: modeName,
      history: [
        { role: "user",      content: text },
        { role: "assistant", content: result },
      ],
    };
    state.rawText = result;
    const html = buildHtml(result);
    if (!html.trim()) {
      showError("結果が空でした。");
      $("retry-box").style.display = "flex";
    } else {
      updateContent(html, modeName);
      addHistory({ mode: modeName, prompt, input: text, result, ts: Date.now() });
    }
  } catch (e) {
    if (isStale(gen)) return;
    showError(String(e));
    $("retry-box").style.display = "flex";
  } finally {
    if (!isStale(gen)) setLoading(false);
  }
}

const FOLLOWUP_SYSTEM = `あなたは優秀なアシスタントです。
回答でコンテンツの特定箇所を指す場合は %%HL:該当テキスト%% の形式で囲んでください。
テキストは必ず元のコンテンツから一字一句そのまま抜き出してください。複数箇所指定可能です。
ただしコードブロックや mermaid 図の内部では %%HL%% を使わないでください。`;

const GRAMMAR_SYSTEM = `あなたは英語学習を支援する専門家です。
ユーザーの質問に日本語で答えてください。
回答の中で英単語・英フレーズ、またはその日本語訳を引用する際は、必ず %%HL:引用テキスト%% という記法で囲んでください。これはUIが自動的に処理するテキストマーカーです（あなたが色を付ける必要はありません）。
- 英語の引用：英文からそのまま抜き出す → %%HL:explosive%%
- 日本語訳の引用：日本語訳からそのまま抜き出す → %%HL:爆発的な%%
- 必ずセットでマークする：%%HL:explosive%%（%%HL:爆発的な%%）は形容詞で…
- マークなしで語句を引用することは禁止です
- ただしコードブロックや mermaid 図の内部では %%HL%% を使わないでください`;

// 原文＋メイン結果（先頭2件）は必ず残し、フォローアップ部分だけ直近分に丸める
function trimmedHistory(): Message[] {
  const h = state.conv.history;
  if (h.length <= 2 + FOLLOWUP_HISTORY_MAX) return h;
  return [...h.slice(0, 2), ...h.slice(-FOLLOWUP_HISTORY_MAX)];
}

// 過去のフォローアップ（原文＋メイン結果を除く）をスレッド形式の HTML にする
function followupThreadHtml(): string {
  const parts: string[] = [];
  const fups = state.conv.history.slice(2);
  for (let i = 0; i < fups.length; i += 2) {
    const q = fups[i], a = fups[i + 1];
    if (q) parts.push(`<div class="fu-q">${he(q.content)}</div>`);
    if (a) parts.push(`<div class="fu-a">${buildHtml(a.content)}</div>`);
  }
  return parts.join("");
}

export async function processFollowup(followupText: string, mode: "qa" | "grammar" = "qa") {
  const gen = nextGen();
  clearHighlights();
  const fc = $("content-followup");
  const pct = parseFloat(localStorage.getItem("snap-gloss:splitPct") ?? String(SPLIT_DEFAULT_PCT));
  // この時点の history には今回の質問はまだ入っていない
  const pastThread = followupThreadHtml();
  const pendingQ = `<div class="fu-q">${he(followupText)}</div>`;
  const renderPartial = makeStreamRenderer(html => {
    fc.innerHTML = pastThread + pendingQ + `<div class="fu-a">${html}</div>`;
    fc.style.fontSize = state.followupFontSize + "px";
    $("wrapper").classList.add("split");
    ($("content") as HTMLElement).style.flex = `0 0 ${pct}%`;
    fc.scrollTop = fc.scrollHeight;
  });
  try {
    const systemPrompt = mode === "grammar" ? GRAMMAR_SYSTEM : FOLLOWUP_SYSTEM;
    const result = await callApi(
      [
        { role: "system", content: systemPrompt },
        ...trimmedHistory(),
        { role: "user",   content: followupText },
      ],
      partial => { if (!isStale(gen)) renderPartial(partial); }
    );
    if (isStale(gen)) return;
    state.conv.history.push(
      { role: "user",      content: followupText },
      { role: "assistant", content: result },
    );
    state.conv.lastResult = result;

    const highlights = extractTagValues(result, "HL");
    if (highlights.length) highlightInContent(highlights);

    fc.innerHTML = followupThreadHtml();
    wrapWordsInContent(fc);
    void renderMermaidIn(fc);
    fc.style.fontSize = state.followupFontSize + "px";
    $("wrapper").classList.add("split");
    ($("content") as HTMLElement).style.flex = `0 0 ${pct}%`;
    fc.scrollTop = fc.scrollHeight;
    $("error-box").style.display = "none";
  } catch (e) {
    if (isStale(gen)) return;
    showError(String(e));
  } finally {
    if (!isStale(gen)) {
      setLoading(false);
      // 連続質問できるようフォーカスを入力欄に戻す（disabled 解除でフォーカスが外れるため）
      ($("followup-input") as HTMLInputElement).focus();
    }
  }
}
