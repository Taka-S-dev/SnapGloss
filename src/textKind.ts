// 取り込んだテキストの種類。種類ごとに既定モードを持ち、ホットキーで即実行するときの
// モード選択に使う（settings.defaultModes）。判定は文字種の比率だけで行い、API は呼ばない
export type TextKind = "word" | "en" | "ja" | "other";

export const TEXT_KIND_LABELS: Record<TextKind, string> = {
  word:  "英単語・短いフレーズ",
  en:    "英語の文章",
  ja:    "日本語の文章",
  other: "その他（コード・判定不能）",
};

// 1〜3語の英単語・英フレーズ
export function looksLikeWord(text: string): boolean {
  return /^[A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*){0,2}$/.test(text.trim());
}

// コードらしさ：行頭のインデントや記号の密度で見る。英文の散文と混同しないよう、
// 記号は文章にも出る「.,'"-」を除いて数え、インデントは 4 桁以上か Tab に限る
// （メールやコミットメッセージの 2 桁の継続行を拾わない）
function looksLikeCode(text: string): boolean {
  const lines = text.split("\n").filter(l => l.trim());
  if (!lines.length) return false;
  const indented = lines.filter(l => /^(\s{4,}|\t)/.test(l)).length;
  const symbols = (text.match(/[{}()\[\];=<>|\\/#$@`]/g) ?? []).length;
  const nonSpace = text.replace(/\s/g, "").length || 1;
  return (indented >= 2 && indented / lines.length >= 0.5) || symbols / nonSpace >= 0.08;
}

export function detectTextKind(text: string): TextKind {
  const t = text.trim();
  if (!t) return "other";
  if (looksLikeWord(t)) return "word";
  const ja = (t.match(/[぀-ヿ㐀-鿿ｦ-ﾟ]/g) ?? []).length;
  const latin = (t.match(/[A-Za-z]/g) ?? []).length;
  if (ja === 0 && latin === 0) return "other";
  // 日本語は 1 文字の情報量が多い（英単語 1 語 ≈ 5 文字、日本語 1 語 ≈ 2 文字）ので
  // 2 倍の重みで比べる。英文中に日本語が 1〜2 語混ざる程度では日本語にしない
  if (ja * 2 >= latin) return "ja";
  if (looksLikeCode(t)) return "other";
  return "en";
}
