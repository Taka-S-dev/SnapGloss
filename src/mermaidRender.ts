// ```mermaid ブロックの SVG 描画。
// mermaid 本体（約2MB）は初めてブロックが現れたときだけ動的 import する。
// 構文エラー・ロード失敗時は何もしない＝コードブロック表示のまま（安全側フォールバック）。

let _mermaid: typeof import("mermaid").default | null = null;
let _seq = 0;

export async function renderMermaidIn(root: HTMLElement) {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>("pre.mermaid-src:not([data-mm-done])"));
  if (!blocks.length) return;
  try {
    if (!_mermaid) _mermaid = (await import("mermaid")).default;
  } catch {
    return; // ロード失敗：コード表示のまま
  }
  const dark = document.documentElement.dataset.theme === "dark";
  _mermaid.initialize({ startOnLoad: false, theme: dark ? "dark" : "default", securityLevel: "strict" });

  for (const pre of blocks) {
    pre.dataset.mmDone = "1";
    // モデルが図の中にも %%HL:...%% 等のタグを付けてくることがあるので、中身だけ残して剥がす
    // （mermaid 自身のコメント構文 %% text は TAG: 形式でないため誤爆しない）
    const src = (pre.textContent ?? "").trim()
      .replace(/%%[A-Z+\-]{1,5}:([^%]*)%%/g, "$1");
    if (!src) continue;
    try {
      const { svg } = await _mermaid.render(`mm-graph-${_seq++}`, src);
      const fig = document.createElement("div");
      fig.className = "mermaid-figure";
      fig.innerHTML = svg;
      // mermaid はコンテナ幅に収まるよう図を縮小する（横長の図は文字が潰れる）。
      // 原寸（inline の max-width に入っている自然幅）で表示し、あふれた分は横スクロールさせる。
      const svgEl = fig.querySelector<SVGSVGElement>("svg");
      if (svgEl) {
        const natural = parseFloat(svgEl.style.maxWidth || "0");
        if (natural > 0) {
          svgEl.style.maxWidth = "none";
          svgEl.style.width = natural + "px";
        }
      }
      pre.replaceWith(fig);
    } catch {
      // 構文エラー：コードブロックのまま残す
    }
  }
}
