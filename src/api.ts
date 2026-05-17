import { invoke } from "@tauri-apps/api/core";
import { state, type Message, ChatCompletionSchema } from "./state";
import { loadSettings } from "./settings";
import { buildHtml, extractTagValues } from "./renderer";
import { $, updateContent, showError, showNotice, setLoading, highlightInContent, clearHighlights, wrapWordsInContent } from "./ui";
import { API_TIMEOUT_MS, TEXT_MAX_LENGTH, SPLIT_DEFAULT_PCT } from "./constants";

const POS_INSTRUCTION = `\n\n英文中の品詞を以下のタグで囲んでください（英語テキストにのみ適用）：%%V:動詞%% %%N:名詞%% %%ADJ:形容詞%% %%ADV:副詞%%。日本語訳には適用しないでください。`;

export async function callApi(messages: Message[]): Promise<string> {
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
        /^o\d/.test(s.model)
          ? { model: s.model, messages, max_completion_tokens: s.maxTokens }
          : { model: s.model, messages, temperature: s.temperature, max_tokens: s.maxTokens }
      ),
    }),
    timeout,
  ]);
  const data = ChatCompletionSchema.parse(await res.json());
  if (data.error) throw new Error(data.error.message);
  const content = data.choices?.[0]?.message.content;
  if (!content) throw new Error("レスポンスが空です");
  return content;
}

export async function processText(text: string, modeName: string, prompt: string) {
  if (text.length > TEXT_MAX_LENGTH) {
    text = text.slice(0, TEXT_MAX_LENGTH) + "...";
    showNotice(`テキストが長いため先頭 ${TEXT_MAX_LENGTH} 文字のみ送信します`);
  }
  state.lastCall = { text, modeName, prompt };
  $("retry-box").style.display = "none";
  try {
    const isBilingual = prompt.includes("%%ORIG%%");
    const result = await callApi([
      { role: "system", content: isBilingual ? prompt : prompt + POS_INSTRUCTION },
      { role: "user",   content: text },
    ]);
    state.conv = { prompt, inputText: text, lastResult: result, mode: modeName };
    state.rawText = result;
    const html = buildHtml(result);
    if (!html.trim()) {
      showError("結果が空でした。");
      $("retry-box").style.display = "flex";
    } else {
      updateContent(html, modeName);
    }
  } catch (e) {
    showError(String(e));
    $("retry-box").style.display = "flex";
  } finally {
    setLoading(false);
  }
}

const FOLLOWUP_SYSTEM = `あなたは優秀なアシスタントです。
回答でコンテンツの特定箇所を指す場合は %%HL:該当テキスト%% の形式で囲んでください。
テキストは必ず元のコンテンツから一字一句そのまま抜き出してください。複数箇所指定可能です。`;

const GRAMMAR_SYSTEM = `あなたは英語学習を支援する専門家です。
ユーザーの質問に日本語で答えてください。
回答の中で英単語・英フレーズ、またはその日本語訳を引用する際は、必ず %%HL:引用テキスト%% という記法で囲んでください。これはUIが自動的に処理するテキストマーカーです（あなたが色を付ける必要はありません）。
- 英語の引用：英文からそのまま抜き出す → %%HL:explosive%%
- 日本語訳の引用：日本語訳からそのまま抜き出す → %%HL:爆発的な%%
- 必ずセットでマークする：%%HL:explosive%%（%%HL:爆発的な%%）は形容詞で…
- マークなしで語句を引用することは禁止です`;

export async function processFollowup(followupText: string, mode: "qa" | "grammar" = "qa") {
  clearHighlights();
  try {
    const systemPrompt = mode === "grammar" ? GRAMMAR_SYSTEM : FOLLOWUP_SYSTEM;
    const result = await callApi([
      { role: "system",    content: systemPrompt },
      { role: "user",      content: state.conv.inputText },
      { role: "assistant", content: state.conv.lastResult },
      { role: "user",      content: followupText },
    ]);
    state.conv.lastResult = result;

    const highlights = extractTagValues(result, "HL");
    if (highlights.length) highlightInContent(highlights);

    const fc = $("content-followup");
    fc.innerHTML = buildHtml(result);
    wrapWordsInContent(fc);
    fc.style.fontSize = state.followupFontSize + "px";
    fc.scrollTop = 0;
    $("wrapper").classList.add("split");
    const pct = parseFloat(localStorage.getItem("snap-gloss:splitPct") ?? String(SPLIT_DEFAULT_PCT));
    ($("content") as HTMLElement).style.flex = `0 0 ${pct}%`;
    $("error-box").style.display = "none";
  } catch (e) {
    showError(String(e));
  } finally {
    setLoading(false);
  }
}
