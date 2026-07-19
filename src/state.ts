import { z } from "zod";

export interface Prompt { name: string; text: string; }
export interface Message { role: "system" | "user" | "assistant"; content: string; }

export const ChatCompletionSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string() }),
    finish_reason: z.string().nullable().optional(),
  })).optional(),
  error: z.object({ message: z.string() }).optional(),
});
export type ChatCompletion = z.infer<typeof ChatCompletionSchema>;

// ストリーミング (SSE) の 1 チャンク
export const ChatCompletionChunkSchema = z.object({
  choices: z.array(z.object({
    delta: z.object({ content: z.string().optional() }).optional(),
    finish_reason: z.string().nullable().optional(),
  })).optional(),
  error: z.object({ message: z.string() }).optional(),
});
export interface Settings {
  endpoint: string;
  model: string;
  temperature: number;
  maxTokens: number;
  hotkey: string;
  autoHide: boolean;
  theme: "auto" | "light" | "dark";
  /** ホットキーで即実行するモード。"" = オフ、"__last__" = 前回のモード、それ以外はプロンプト名 */
  autoRun: string;
  prompts: Prompt[];
}

export const DEFAULT_PROMPTS: Prompt[] = [
  { name: "翻訳（日→英）", text: "プロの翻訳者として、入力テキストを自然な英語に翻訳してください。翻訳文のみを返してください。出力形式のルール：入力の改行・段落構造を維持し、行同士を勝手に結合しないこと。入力が箇条書き（行頭の「- 」「・」「•」「*」や番号、または短い項目が改行で並ぶ形）の場合は、各項目を「- 」で始まる行として出力すること。「## 」「# 」で始まる行は翻訳後も同じ記号を付けること。見出しらしい単独の短い行は「## 」を付けて出力すること。" },
  { name: "翻訳（英→日）", text: "プロの翻訳者として、入力テキストを自然な日本語に翻訳してください。翻訳文のみを返してください。出力形式のルール：入力の改行・段落構造を維持し、行同士を勝手に結合しないこと。入力が箇条書き（行頭の「- 」「・」「•」「*」や番号、または短い項目が改行で並ぶ形）の場合は、各項目を「- 」で始まる行として出力すること。「## 」「# 」で始まる行は翻訳後も同じ記号を付けること。見出しらしい単独の短い行は「## 」を付けて出力すること。" },
  { name: "対訳（英→日）", text: "以下の英文を文単位で対訳形式に翻訳してください。必ず次のフォーマットで出力してください。%%ORIG%%の後に英文を1文、%%TRANS%%の後にその日本語訳を1文、を交互に繰り返してください。説明・前置き不要です。%%ORIG%%" },
  { name: "要約", text: "以下のテキストを日本語で3〜5つの箇条書きに要約してください。各ポイントは1〜2文で簡潔にまとめ、要約のみを返してください。" },
  { name: "校正", text: "プロの校正者として、入力テキストの誤字・脱字・文法エラーを修正してください。修正後のテキストのみを返し、変更点の説明は不要です。" },
  { name: "文構造（SVOC）", text: "以下の英文を文単位で対訳形式に翻訳してください。英文の各要素（英語テキストそのまま）を該当するタグで囲んでください。使用するタグ：%%S:...%% （主語）、%%VB:...%% （動詞）、%%O:...%% （目的語）、%%C:...%% （補語）、%%M:...%% （修飾語）。\n\nタグ付け規則（現代言語学の統語論ではなく、日本の学校文法の5文型に厳密に従うこと。両者が食い違う場合は必ず学校文法を優先する）：\n- 前置詞で始まる句は、動詞や形容詞が要求する必須の補部であっても（restricted to X, depend on X 等）、例外なく M とする。O と C に入れてよいのは名詞句・形容詞句のみ\n- There 構文：統語論では there が主語だが、学校文法では be 動詞の後の名詞句が S。there は必ず M とし、絶対に S としない。名詞句を C にもしない\n- 助動詞や不定詞でつながる動詞連鎖は1つの VB にまとめる（例：%%VB:have come to associate%%）\n- 分詞構文は内部を分割せず、句全体を1つの M とする\n- タグの入れ子は禁止。タグの中身は英語テキストのみ\n\n例：「She quietly loves music.」→ %%S:She%% %%M:quietly%% %%VB:loves%% %%O:music%%.\n例：「there is no warehouse, and none of the goods.」→ %%M:there%% %%VB:is%% %%S:no warehouse, and none of the goods%%.\n例：「Access is restricted to Costco members.」→ %%S:Access%% %%VB:is restricted%% %%M:to Costco members%%.\n\n日本語訳にはタグ不要。説明文・ラベルテキストは絶対に追加しないこと。%%ORIG%%の後にタグ付き英文を1文、%%TRANS%%の後に日本語訳を1文、交互に繰り返してください。%%ORIG%%" },
  { name: "辞書（英単語）", text: "入力された英単語・英フレーズを辞書形式で日本語で説明してください。必ず以下のMarkdown形式で答えてください。\n\n## [単語/フレーズ]\n**品詞：** 品詞\n**意味：** 日本語訳（主要な意味を1〜3個）\n\n**例文：**\n- 英語例文 → 日本語訳\n- 英語例文 → 日本語訳\n\n**メモ：** ニュアンス・使い分け・よく使う表現など（重要な場合のみ。不要なら省略）" },
  { name: "質問", text: "あなたは有能なアシスタントです。入力された質問・依頼に日本語で答えてください。結論から先に、簡潔に。必要に応じて Markdown（見出し・箇条書き・`コード`）で構造化してください。前置きや締めの挨拶は不要です。" },
];

export interface Conv {
  prompt: string;
  inputText: string;
  lastResult: string;
  mode: string;
  /** 原文＋メイン結果＋フォローアップのやりとり（user/assistant のペアで蓄積） */
  history: Message[];
}

export const state = {
  rawText: "",
  fontSize: parseInt(localStorage.getItem("snap-gloss:fontSize") ?? "16"),
  followupFontSize: parseInt(localStorage.getItem("snap-gloss:followupFontSize") ?? "16"),
  conv: { prompt: "", inputText: "", lastResult: "", mode: "", history: [] } as Conv,
  lastCall: null as { text: string; modeName: string; prompt: string } | null,
};
