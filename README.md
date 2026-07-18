# SnapGloss

[![Test](https://github.com/Taka-S-dev/SnapGloss/actions/workflows/test.yml/badge.svg)](https://github.com/Taka-S-dev/SnapGloss/actions/workflows/test.yml)
[![Release](https://github.com/Taka-S-dev/SnapGloss/actions/workflows/release.yml/badge.svg)](https://github.com/Taka-S-dev/SnapGloss/actions/workflows/release.yml)
[![Latest Release](https://img.shields.io/github/v/release/Taka-S-dev/SnapGloss?include_prereleases)](https://github.com/Taka-S-dev/SnapGloss/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

ブラウザでも Word でも、アプリを問わずテキストを選んでホットキーを押すだけ。翻訳・要約・文法解析・自由質問をその場で即実行し、結果をストリーミング表示します。

> **Built with:** Tauri v2 · Rust · TypeScript

---

## こんな使い方に

- 英語記事を読みながら、わからない単語をクリックしてその場で意味と品詞を確認（読み上げ付き）
- TOEIC の問題文をホットキーで投げて、文構造（SVOC）を色分け表示
- 長い英文メールを選択して即座に日本語に翻訳、気になる箇所を選択してそのまま追加質問
- 何も選択せず開いて、ちょっとした質問を AI に投げるランチャーとして

---

## 機能

- **翻訳・対訳・要約・校正・SVOC 分析・辞書・自由質問** — 選択テキストをワンキーで処理。カスタムプロンプトも追加可能
- **ストリーミング表示** — 応答が届いたそばから描画。長文でも待たされない
- **追加質問スレッド** — 結果に対して会話形式で深掘り。文法解説モードでは引用箇所を本文中にハイライト
- **単語ツールチップ** — 対訳の原文で単語をクリック／選択すると訳・品詞・読み上げをポップアップ
- **右クリックメニュー** — 選択箇所を Web 検索、または「この部分について質問」
- **履歴** — 直近 20 件の結果を API を叩かずに再表示
- **リッチな描画** — Markdown（表・見出し・引用・コード）と mermaid 図を自動レンダリング
- **ライト／ダークテーマ** — OS 設定に追従、手動切替も可能
- **ホットキー即実行** — モード選択を飛ばして指定モードで即処理するオプション
- **設定のエクスポート／インポート** — プロンプトを含む設定一式を JSON ファイルで移行・共有（API キーは含まれない）

---

## セットアップ

### 必要環境

- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) 18+
- Windows 10/11
- OpenAI API キー（または互換 API）

### 起動

```bash
npm install
npm run tauri dev
```

### ビルド

```bash
npm run tauri build
```

インストーラーは `src-tauri/target/release/bundle/` に生成されます（`v*` タグの push で GitHub Actions が自動ビルドし、ドラフトリリースに添付します）。

### 初期設定

1. 右上の ⚙ から設定を開く
2. API キーを入力して保存
3. テキストを選択してホットキーを押す（デフォルト: `Ctrl+Shift+Z`）

ホットキー・モデル・テーマ等は設定から変更できます。Ollama 等のローカル LLM を使う場合はエンドポイントを変更すれば API キー不要で動作します。

設定とプロンプトは `%APPDATA%\com.snapgloss.app\settings.json`、API キーは同フォルダの `apikey` に保存されます。ブラウザからは読み取れません。

---

## 基本操作

| 操作                      | 説明                                                 |
| ------------------------- | ---------------------------------------------------- |
| テキスト選択 → ホットキー | モード選択を開く（デフォルト: `Ctrl+Shift+Z`）       |
| ホットキー 2度押し        | 前回と同じモードで即実行                             |
| `1`〜`9` / `↑↓`+`Enter`   | モードを選択                                         |
| `Ctrl+Enter`              | テキスト欄から選択中モードを実行                     |
| `Enter` / `Shift+Enter`   | 追加質問を送信 / 改行                                |
| `ESC`                     | 内容をリセットしてウィンドウを隠す                   |
| `Ctrl+C`                  | 結果をコピー（テキスト未選択時）                     |
| `Ctrl+ホイール`           | フォントサイズ変更                                   |
| 単語クリック              | 日本語訳・品詞・読み上げをポップアップ表示           |
| 右クリック                | 選択箇所を Web 検索／この部分について質問            |
| モード名クリック          | 直前のテキストでモード選択を開き直す                 |

アプリ内の「？」ボタンからも同じ一覧を確認できます。終了はタスクトレイの「終了」から。

---

## ファイル構成

```
SnapAI-tauri/
├── index.html            # UI 全体（オーバーレイ含む）
├── src/
│   ├── main.ts           # エントリーポイント
│   ├── state.ts          # 共有状態・型定義・デフォルトプロンプト
│   ├── constants.ts      # 定数（タイムアウト・フォントサイズ等）
│   ├── renderer.ts       # Markdown・対訳パーサー・SVOC タグ補正
│   ├── mermaidRender.ts  # mermaid 図の遅延レンダリング
│   ├── ui.ts             # DOM 操作・ハイライト
│   ├── api.ts            # API 呼び出し（ストリーミング・会話履歴）
│   ├── history.ts        # 結果履歴
│   ├── settings.ts       # 設定の読み書き・モーダル・エクスポート
│   ├── tooltip.ts        # 単語ツールチップ
│   ├── modeOverlay.ts    # モード選択オーバーレイ
│   ├── contextMenu.ts    # 右クリックメニュー
│   └── styles.css        # 配色トークン（ライト／ダーク）
└── src-tauri/
    ├── src/lib.rs        # Rust バックエンド（ホットキー・クリップボード・設定保存）
    └── tauri.conf.json
```

---

## ライセンス

[MIT](LICENSE)
