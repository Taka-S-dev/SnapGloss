# SnapGloss のタスク定義。`just` だけ打つとこの一覧が出る。
# 実体は package.json の scripts で、ここはその入口（just を入れていなくても npm だけで作業できる）
set windows-shell := ["powershell.exe", "-NoLogo", "-Command"]

# タスク一覧を表示する
default:
    @just --list

# 開発モードで起動する
dev:
    npm run tauri dev

# ホットキー取得のログを %TEMP%\snapgloss-hotkey.log に残して起動する
debug:
    $env:SNAPGLOSS_DEBUG = "1"; npm run tauri dev

# フロントエンドのテスト
test:
    npm test

# 型チェックとフロントエンドのビルド
build:
    npm run build

# Rust のテストと静的解析
test-rust:
    cd src-tauri; cargo test
    cd src-tauri; cargo clippy --all-targets

# リリースビルド（src-tauri/target/release/bundle/ に出力）
bundle:
    npm run tauri build

# アイコンを src-tauri/icons/*.svg から作り直す（要 Pillow）
icons:
    python scripts/make-icons.py

# push 前の一通り（CI が落ちる変更を手元で見つける）
check: build test test-rust
