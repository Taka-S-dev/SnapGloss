import { z } from "zod";

export interface Prompt { name: string; text: string; }
export interface Message { role: "system" | "user" | "assistant"; content: string; }

export const ChatCompletionSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string() }),
  })).optional(),
  error: z.object({ message: z.string() }).optional(),
});
export type ChatCompletion = z.infer<typeof ChatCompletionSchema>;
export interface Settings {
  endpoint: string;
  model: string;
  temperature: number;
  maxTokens: number;
  hotkey: string;
  prompts: Prompt[];
}

export const DEFAULT_PROMPTS: Prompt[] = [
  { name: "翻訳（日→英）", text: "プロの翻訳者として、入力テキストを自然な英語に翻訳してください。翻訳文のみを返してください。出力形式のルール：「- 」で始まる行は翻訳後も必ず「- 」で始めること。「## 」「# 」で始まる行は翻訳後も同じ記号を付けること。" },
  { name: "翻訳（英→日）", text: "プロの翻訳者として、入力テキストを自然な日本語に翻訳してください。翻訳文のみを返してください。出力形式のルール：「- 」で始まる行は翻訳後も必ず「- 」で始めること。「## 」「# 」で始まる行は翻訳後も同じ記号を付けること。" },
  { name: "対訳（英→日）", text: "以下の英文を文単位で対訳形式に翻訳してください。必ず次のフォーマットで出力してください。%%ORIG%%の後に英文を1文、%%TRANS%%の後にその日本語訳を1文、を交互に繰り返してください。説明・前置き不要です。%%ORIG%%" },
  { name: "要約", text: "以下のテキストを日本語で3〜5つの箇条書きに要約してください。各ポイントは1〜2文で簡潔にまとめ、要約のみを返してください。" },
  { name: "校正", text: "プロの校正者として、入力テキストの誤字・脱字・文法エラーを修正してください。修正後のテキストのみを返し、変更点の説明は不要です。" },
  { name: "文構造（SVOC）", text: "以下の英文を文単位で対訳形式に翻訳してください。英文の各要素（英語テキストそのまま）を該当するタグで囲んでください。使用するタグ：%%S:...%% （主語）、%%VB:...%% （動詞）、%%O:...%% （目的語）、%%C:...%% （補語）、%%M:...%% （修飾語）。例：「She quietly loves music.」→ %%S:She%% %%M:quietly%% %%VB:loves%% %%O:music%%. タグの中身は必ず英語テキストのみ。日本語訳にはタグ不要。説明文・ラベルテキストは絶対に追加しないこと。%%ORIG%%の後にタグ付き英文を1文、%%TRANS%%の後に日本語訳を1文、交互に繰り返してください。%%ORIG%%" },
  { name: "辞書（英単語）", text: "入力された英単語・英フレーズを辞書形式で日本語で説明してください。必ず以下のMarkdown形式で答えてください。\n\n## [単語/フレーズ]\n**品詞：** 品詞\n**意味：** 日本語訳（主要な意味を1〜3個）\n\n**例文：**\n- 英語例文 → 日本語訳\n- 英語例文 → 日本語訳\n\n**メモ：** ニュアンス・使い分け・よく使う表現など（重要な場合のみ。不要なら省略）" },
];

export const state = {
  rawText: "",
  fontSize: parseInt(localStorage.getItem("snap-gloss:fontSize") ?? "16"),
  followupFontSize: parseInt(localStorage.getItem("snap-gloss:followupFontSize") ?? "16"),
  conv: { prompt: "", inputText: "", lastResult: "", mode: "" },
  lastCall: null as { text: string; modeName: string; prompt: string } | null,
};
