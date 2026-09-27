use enigo::{Direction::Release, Enigo, Key, Keyboard, Settings};
use std::{thread, time::{Duration, Instant}};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// 設定と API キーの保存先フォルダ名。
///
/// Tauri の app_config_dir() はバンドル識別子（com.snapgloss.app）をそのまま
/// フォルダ名にするが、製品名が並ぶ %APPDATA% ではそれだけが浮く。
/// 識別子自体はインストーラーの製品同一性に使われるので変更しない
const CONFIG_DIR_NAME: &str = "SnapGloss";

/// 設定・API キーを置くフォルダ（%APPDATA%\SnapGloss）
fn config_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().config_dir()
        .map(|p| p.join(CONFIG_DIR_NAME))
        .map_err(|e| e.to_string())
}

fn key_file_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    config_dir(app).map(|p| p.join("apikey"))
}

#[tauri::command]
fn get_api_key(app: AppHandle) -> Result<String, String> {
    let path = key_file_path(&app)?;
    if !path.exists() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&path)
        .map(|s| s.trim().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_api_key(app: AppHandle, key: String) -> Result<(), String> {
    let path = key_file_path(&app)?;
    if key.is_empty() {
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, key).map_err(|e| e.to_string())
}

fn settings_file_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    config_dir(app).map(|p| p.join("settings.json"))
}

/// 保存先を %APPDATA%\com.snapgloss.app から %APPDATA%\SnapGloss へ移した際の移行。
/// 起動時に一度だけ呼ぶ。0.2.0 以前からの更新でも設定と API キーを引き継ぐためのもの
fn migrate_legacy_config_dir(app: &AppHandle) {
    let Ok(new_dir) = config_dir(app) else { return };
    let Ok(old_dir) = app.path().app_config_dir() else { return };
    migrate_config_files(&old_dir, &new_dir);
}

/// 旧フォルダから新フォルダへ設定ファイルを移す。
/// 新側に同名ファイルがあれば触らない（新しいほうが正）。移動できたものだけ消えるので、
/// 途中で失敗しても旧ファイルは残り、設定が失われることはない
fn migrate_config_files(old_dir: &std::path::Path, new_dir: &std::path::Path) {
    if old_dir == new_dir || !old_dir.is_dir() { return; }
    for name in ["apikey", "settings.json"] {
        let src = old_dir.join(name);
        let dst = new_dir.join(name);
        if !src.is_file() || dst.exists() { continue; }
        if std::fs::create_dir_all(new_dir).is_err() { return; }
        // 同一ボリュームなら rename。失敗したらコピーで代替し、旧ファイルは残す
        if std::fs::rename(&src, &dst).is_err() {
            let _ = std::fs::copy(&src, &dst);
        }
    }
    // 空になったときだけ旧フォルダを片付ける（中身が残っていれば失敗するので安全）
    let _ = std::fs::remove_dir(old_dir);
}

#[cfg(test)]
mod migrate_config_tests {
    use super::migrate_config_files;
    use std::fs;

    fn temp_root(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("snapgloss-test-{}-{tag}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn moves_files_and_removes_the_empty_old_dir() {
        let root = temp_root("move");
        let (old, new) = (root.join("com.snapgloss.app"), root.join("SnapGloss"));
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("apikey"), "sk-test").unwrap();
        fs::write(old.join("settings.json"), "{}").unwrap();

        migrate_config_files(&old, &new);

        assert_eq!(fs::read_to_string(new.join("apikey")).unwrap(), "sk-test");
        assert_eq!(fs::read_to_string(new.join("settings.json")).unwrap(), "{}");
        assert!(!old.exists(), "空になった旧フォルダは消える");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn never_overwrites_the_new_location() {
        let root = temp_root("keep");
        let (old, new) = (root.join("com.snapgloss.app"), root.join("SnapGloss"));
        fs::create_dir_all(&old).unwrap();
        fs::create_dir_all(&new).unwrap();
        fs::write(old.join("apikey"), "old").unwrap();
        fs::write(new.join("apikey"), "new").unwrap();

        migrate_config_files(&old, &new);

        assert_eq!(fs::read_to_string(new.join("apikey")).unwrap(), "new");
        assert_eq!(fs::read_to_string(old.join("apikey")).unwrap(), "old", "旧ファイルも残す");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn leaves_unrelated_files_and_the_old_dir_alone() {
        let root = temp_root("other");
        let (old, new) = (root.join("com.snapgloss.app"), root.join("SnapGloss"));
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("settings.json"), "{}").unwrap();
        fs::write(old.join("EBWebView-lock"), "x").unwrap();

        migrate_config_files(&old, &new);

        assert!(old.join("EBWebView-lock").is_file(), "見知らぬファイルは触らない");
        assert!(old.is_dir(), "空でない旧フォルダは残す");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn does_nothing_when_there_is_no_old_dir() {
        let root = temp_root("absent");
        let (old, new) = (root.join("com.snapgloss.app"), root.join("SnapGloss"));
        migrate_config_files(&old, &new);
        assert!(!new.exists(), "移すものがなければ新フォルダも作らない");
        fs::remove_dir_all(&root).unwrap();
    }
}

// エクスポート／インポート用（パスはネイティブダイアログでユーザーが選んだもの）
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_settings(app: AppHandle) -> Result<String, String> {
    let path = settings_file_path(&app)?;
    if !path.exists() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_settings(app: AppHandle, json: String) -> Result<(), String> {
    let path = settings_file_path(&app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, &json).map_err(|e| e.to_string())?;
    // ホットキー経路がディスクを読まずに済むよう、メモリ側も同時に更新する
    if let Some(list) = excluded_apps_from_settings(&json) {
        if let Some(state) = app.try_state::<ExcludedApps>() {
            if let Ok(mut current) = state.0.lock() { *current = list; }
        }
    }
    Ok(())
}

/// 既定の「選択範囲を自動取得しない」アプリ。
///
/// 載せる基準は「Ctrl+C がコピーではなく実行中プロセスへの割り込みになる」こと、
/// つまりターミナルであることだけ。内蔵ターミナルを持つエディタ・IDE（VS Code や
/// JetBrains 系）は載せない。内蔵パネルのために本体での選択取得を潰すほうが実害が
/// 大きく、しかもそれを名前で網羅するのは原理的に不可能なため。
/// 足りない・余計なぶんはユーザーが設定で編集する。
const DEFAULT_EXCLUDED_APPS: &[&str] = &[
    "windowsterminal.exe", "wt.exe",  // Windows Terminal
    "openconsole.exe", "conhost.exe", // コンソールホスト
    "powershell.exe", "pwsh.exe",     // PowerShell
    "cmd.exe",                        // コマンドプロンプト
    "mintty.exe",                     // Git Bash / MSYS2
    "alacritty.exe",
    "wezterm-gui.exe",
    "hyper.exe",
    "tabby.exe",
    "warp.exe",
    "conemu64.exe", "conemu.exe",
    "putty.exe", "kitty.exe",         // SSH クライアント（Ctrl+C はリモートに届く）
];

#[cfg(test)]
mod excluded_apps_tests {
    use super::{excluded_apps_from_settings, DEFAULT_EXCLUDED_APPS};

    #[test]
    fn reads_and_normalizes_the_list() {
        let raw = r#"{"excludedApps": ["  WT.exe ", "cmd.exe", "", "  "]}"#;
        assert_eq!(
            excluded_apps_from_settings(raw),
            Some(vec!["wt.exe".to_string(), "cmd.exe".to_string()])
        );
    }

    #[test]
    fn empty_list_means_exclude_nothing() {
        // 「既定に戻す」ではなく「全アプリで自動取得する」という有効な設定
        assert_eq!(excluded_apps_from_settings(r#"{"excludedApps": []}"#), Some(vec![]));
    }

    #[test]
    fn missing_or_broken_falls_back_to_defaults() {
        assert_eq!(excluded_apps_from_settings(r#"{"model": "x"}"#), None);
        assert_eq!(excluded_apps_from_settings(r#"{"excludedApps": "wt.exe"}"#), None);
        assert_eq!(excluded_apps_from_settings("not json"), None);
    }

    #[test]
    fn editors_are_not_excluded_by_default() {
        // 内蔵ターミナルを持つだけのアプリを既定で潰さない
        for app in ["code.exe", "cursor.exe", "idea64.exe", "fork.exe"] {
            assert!(!DEFAULT_EXCLUDED_APPS.contains(&app), "{app} should not be excluded");
        }
    }
}

/// 前面アプリの判定に使う除外リスト。settings.json を単一の正とし、起動時に読み込んで
/// ここに載せる。以降は set_settings が更新する
struct ExcludedApps(std::sync::Mutex<Vec<String>>);

#[tauri::command]
fn default_excluded_apps() -> Vec<String> {
    DEFAULT_EXCLUDED_APPS.iter().map(|s| s.to_string()).collect()
}

/// 比較しやすいよう小文字化・トリムし、空要素を落とす
fn normalize_app_names(names: &[serde_json::Value]) -> Vec<String> {
    names.iter()
        .filter_map(|v| v.as_str())
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .collect()
}

/// settings.json 本文から除外リストを取り出す。項目がなければ None（＝既定を使う）。
/// 空配列は「何も除外しない」という有効な設定なので Some(vec![]) を返す
fn excluded_apps_from_settings(raw: &str) -> Option<Vec<String>> {
    let value: serde_json::Value = serde_json::from_str(raw).ok()?;
    let names = value.get("excludedApps")?.as_array()?;
    Some(normalize_app_names(names))
}

#[tauri::command]
fn hide_window(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
}

// JS 側の window.show() は capability 制限で失敗するため Rust 側で行う
#[tauri::command]
fn show_window(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

#[tauri::command]
fn register_shortcut(app: AppHandle, shortcut_str: String) -> Result<(), String> {
    let shortcut = parse_shortcut(&shortcut_str)
        .ok_or_else(|| format!("解析できません: {} （例: ctrl+shift+z、alt+t）", shortcut_str))?;
    app.global_shortcut().unregister_all().map_err(|e| e.to_string())?;
    app.global_shortcut().register(shortcut).map_err(|e| e.to_string())
}

fn key_to_code(key: &str) -> Option<Code> {
    Some(match key {
        "a" => Code::KeyA, "b" => Code::KeyB, "c" => Code::KeyC, "d" => Code::KeyD,
        "e" => Code::KeyE, "f" => Code::KeyF, "g" => Code::KeyG, "h" => Code::KeyH,
        "i" => Code::KeyI, "j" => Code::KeyJ, "k" => Code::KeyK, "l" => Code::KeyL,
        "m" => Code::KeyM, "n" => Code::KeyN, "o" => Code::KeyO, "p" => Code::KeyP,
        "q" => Code::KeyQ, "r" => Code::KeyR, "s" => Code::KeyS, "t" => Code::KeyT,
        "u" => Code::KeyU, "v" => Code::KeyV, "w" => Code::KeyW, "x" => Code::KeyX,
        "y" => Code::KeyY, "z" => Code::KeyZ,
        "0" => Code::Digit0, "1" => Code::Digit1, "2" => Code::Digit2, "3" => Code::Digit3,
        "4" => Code::Digit4, "5" => Code::Digit5, "6" => Code::Digit6, "7" => Code::Digit7,
        "8" => Code::Digit8, "9" => Code::Digit9,
        "f1"  => Code::F1,  "f2"  => Code::F2,  "f3"  => Code::F3,  "f4"  => Code::F4,
        "f5"  => Code::F5,  "f6"  => Code::F6,  "f7"  => Code::F7,  "f8"  => Code::F8,
        "f9"  => Code::F9,  "f10" => Code::F10, "f11" => Code::F11, "f12" => Code::F12,
        "space" => Code::Space, "tab" => Code::Tab,
        "enter" | "return" => Code::Enter,
        "backspace" => Code::Backspace,
        "escape" | "esc" => Code::Escape,
        "delete" | "del" => Code::Delete,
        "home" => Code::Home, "end" => Code::End,
        "pageup" => Code::PageUp, "pagedown" => Code::PageDown,
        "up" => Code::ArrowUp, "down" => Code::ArrowDown,
        "left" => Code::ArrowLeft, "right" => Code::ArrowRight,
        _ => return None,
    })
}

fn parse_shortcut(s: &str) -> Option<Shortcut> {
    let mut mods = Modifiers::empty();
    let mut code: Option<Code> = None;
    for part in s.split('+').map(|p| p.trim().to_lowercase()) {
        match part.as_str() {
            "ctrl" | "control" => mods |= Modifiers::CONTROL,
            "shift"            => mods |= Modifiers::SHIFT,
            "alt"              => mods |= Modifiers::ALT,
            "win" | "meta" | "super" | "cmd" => mods |= Modifiers::META,
            key => { code = key_to_code(key); }
        }
    }
    Some(Shortcut::new(if mods.is_empty() { None } else { Some(mods) }, code?))
}

/// ウィンドウをマウスカーソルの近くに移動する。
/// カーソルのあるモニターの作業領域（タスクバー除く）内に収まるようクランプする。
fn move_window_to_cursor(app: &AppHandle, win: &tauri::WebviewWindow) {
    let Ok(cursor) = app.cursor_position() else { return };
    let Ok(size) = win.outer_size() else { return };

    let mut x = cursor.x + 12.0;
    let mut y = cursor.y + 12.0;

    if let Ok(Some(monitor)) = app.monitor_from_point(cursor.x, cursor.y) {
        let area = monitor.work_area();
        let min_x = area.position.x as f64;
        let min_y = area.position.y as f64;
        let max_x = min_x + area.size.width as f64 - size.width as f64;
        let max_y = min_y + area.size.height as f64 - size.height as f64;
        x = x.clamp(min_x, max_x.max(min_x));
        y = y.clamp(min_y, max_y.max(min_y));
    }

    let _ = win.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
}

// ── クリップボードの HTML フレーバー読み取り ────────────────────────────────
// ブラウザからのコピーはプレーンテキストだと箇条書き・見出しの構造が失われる。
// CF_HTML が存在する場合は Markdown に変換して構造を保つ（Obsidian の貼り付けと同じ発想）。

#[cfg(target_os = "windows")]
fn read_clipboard_html() -> Option<String> {
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
        RegisterClipboardFormatW,
    };
    use windows_sys::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};

    let name: Vec<u16> = "HTML Format\0".encode_utf16().collect();
    unsafe {
        let fmt = RegisterClipboardFormatW(name.as_ptr());
        if fmt == 0 || IsClipboardFormatAvailable(fmt) == 0 {
            return None;
        }
        if OpenClipboard(0) == 0 {
            return None;
        }
        let handle = GetClipboardData(fmt);
        if handle == 0 {
            CloseClipboard();
            return None;
        }
        let mem = handle as *mut core::ffi::c_void;
        let ptr = GlobalLock(mem) as *const u8;
        if ptr.is_null() {
            CloseClipboard();
            return None;
        }
        let size = GlobalSize(mem);
        let bytes = std::slice::from_raw_parts(ptr, size).to_vec();
        GlobalUnlock(mem);
        CloseClipboard();

        let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
        let raw = String::from_utf8_lossy(&bytes[..end]).into_owned();
        extract_cf_html_fragment(&raw)
    }
}

#[cfg(not(target_os = "windows"))]
fn read_clipboard_html() -> Option<String> {
    None
}

// CF_HTML のヘッダ（StartFragment/EndFragment のバイトオフセット）から本体を取り出す
fn extract_cf_html_fragment(raw: &str) -> Option<String> {
    let num = |key: &str| {
        raw.lines()
            .find_map(|l| l.strip_prefix(key))
            .and_then(|v| v.trim().parse::<usize>().ok())
    };
    if let (Some(s), Some(e)) = (num("StartFragment:"), num("EndFragment:")) {
        if s < e && e <= raw.len() {
            if let Some(frag) = raw.get(s..e) {
                return Some(frag.to_string());
            }
        }
    }
    // オフセットが壊れている場合はコメントマーカーで代用
    const START: &str = "<!--StartFragment-->";
    const END: &str = "<!--EndFragment-->";
    let s = raw.find(START).map(|i| i + START.len())?;
    let e = raw.find(END)?;
    (s <= e).then(|| raw[s..e].to_string())
}

/// クリップボードの HTML を Markdown に変換する。HTML がなければ None
fn clipboard_html_as_markdown() -> Option<String> {
    html_to_markdown(&read_clipboard_html()?)
}

fn html_to_markdown(html: &str) -> Option<String> {
    // Wikipedia 等の脚注 <sup>[1]</sup> は本文ではない上、属性が巨大なので変換前に丸ごと落とす
    let html = regex::Regex::new(r"(?is)<sup\b[^>]*>.*?</sup>")
        .ok()?
        .replace_all(html, "");
    let md = html2md::parse_html(&html);
    // レンダラーが対応しないリンク・画像はテキストだけ残す
    let md = regex::Regex::new(r"!\[[^\]]*\]\([^)]*\)").ok()?.replace_all(&md, "");
    let md = regex::Regex::new(r"\[([^\]]*)\]\([^)]*\)").ok()?.replace_all(&md, "$1");
    // html2md が未対応タグ（span 等）を生のまま素通しするので、残った HTML タグを除去する
    let md = regex::Regex::new(r"(?s)</?[a-zA-Z][a-zA-Z0-9-]*(\s[^>]*)?>")
        .ok()?
        .replace_all(&md, "");
    let md = md.trim().to_string();
    (!md.is_empty()).then_some(md)
}

#[cfg(test)]
mod html_to_markdown_tests {
    use super::html_to_markdown;

    #[test]
    fn strips_wikipedia_footnote_sups() {
        let html = r##"<b>Mount Fuji</b><sup about="#mwt39" class="mw-ref reference" data-mw="{&quot;name&quot;:&quot;ref&quot;}" style="line-height: 1;"><a href="https://en.wikipedia.org/wiki/Mount_Fuji#cite_note-5"><span class="mw-reflink-text">[a]</span></a></sup> is an active <a href="https://en.wikipedia.org/wiki/Stratovolcano">stratovolcano</a>."##;
        let md = html_to_markdown(html).unwrap();
        assert!(!md.contains('<'), "生タグが残っている: {md}");
        assert!(!md.contains("[a]"), "脚注が残っている: {md}");
        assert!(md.contains("**Mount Fuji**"));
        assert!(md.contains("stratovolcano"));
    }

    #[test]
    fn strips_passthrough_span_tags() {
        let html = r#"<p>Hello <span style="color: red;">world</span></p>"#;
        let md = html_to_markdown(html).unwrap();
        assert_eq!(md, "Hello world");
    }

    #[test]
    fn empty_html_returns_none() {
        assert_eq!(html_to_markdown(""), None);
    }
}

/// 環境変数 SNAPGLOSS_DEBUG が設定されているときだけ、一時ディレクトリの
/// snapgloss-hotkey.log に 1 行追記する。未設定なら何もしない。
/// ホットキー処理は他アプリのウィンドウが前面にある状態で走るため、
/// 対話的に観察できない。何が起きたかを残す手段がこれしかない。
fn debug_log(line: &str) {
    if std::env::var_os("SNAPGLOSS_DEBUG").is_none() { return; }
    use std::io::Write;
    let path = std::env::temp_dir().join("snapgloss-hotkey.log");
    let elapsed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "[{elapsed}] {line}");
    }
}

/// 修飾キー（Ctrl / Shift / Alt / Win）がすべて物理的に離されるまで待つ。
/// 離れたら true、タイムアウトしたら false。
///
/// ホットキーの修飾キーが押されたままだと、送った Ctrl+C が Ctrl+Alt+C 等になり
/// コピーが成立しない。Alt を含むホットキー（Alt+T など）で顕著。
#[cfg(target_os = "windows")]
fn wait_for_modifiers_released(timeout: Duration) -> bool {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
    };
    const KEYS: [i32; 5] = [
        VK_CONTROL as i32, VK_SHIFT as i32, VK_MENU as i32, VK_LWIN as i32, VK_RWIN as i32,
    ];
    let deadline = Instant::now() + timeout;
    loop {
        let held = unsafe { KEYS.iter().any(|&k| GetAsyncKeyState(k) as u16 & 0x8000 != 0) };
        if !held { return true; }
        if Instant::now() >= deadline { return false; }
        thread::sleep(Duration::from_millis(10));
    }
}

#[cfg(not(target_os = "windows"))]
fn wait_for_modifiers_released(_timeout: Duration) -> bool { false }

/// Alt を含むホットキーの後始末。ホットキーの本キー（Alt+T の T）は OS が飲み込むので、
/// 前面アプリには「Alt を押して何も押さず離した」だけが届く。Win32 アプリではそれが
/// メニューバー起動の操作なので、アプリはメニュー待ちに入り、続く Ctrl+C がテキスト欄に
/// 届かない。Alt が離される前に無害なキー（VK 0xFF。どのアプリも無視する）を 1 回挟むと
/// 「Alt 単独」ではなくなり、メニューが起動しない。AutoHotkey の A_MenuMaskKey と同じ手法
#[cfg(target_os = "windows")]
fn send_menu_mask_key() {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_MENU,
    };
    // Alt が押されていなければ不要（Ctrl+Shift+Z 等）
    if unsafe { GetAsyncKeyState(VK_MENU as i32) } as u16 & 0x8000 == 0 { return; }
    let key = |flags: u32| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: windows_sys::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
            ki: KEYBDINPUT { wVk: 0xFF, wScan: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 },
        },
    };
    let inputs = [key(0), key(KEYEVENTF_KEYUP)];
    unsafe { SendInput(inputs.len() as u32, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32); }
    debug_log("alt held at hotkey: sent menu mask key (vk 0xff)");
}

#[cfg(not(target_os = "windows"))]
fn send_menu_mask_key() {}

#[cfg(target_os = "windows")]
fn clipboard_sequence() -> u32 {
    use windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber;
    unsafe { GetClipboardSequenceNumber() }
}

#[cfg(not(target_os = "windows"))]
fn clipboard_sequence() -> u32 { 0 }

#[cfg(target_os = "windows")]
fn clipboard_changed_since(before: u32) -> bool { clipboard_sequence() != before }

#[cfg(not(target_os = "windows"))]
fn clipboard_changed_since(_before: u32) -> bool { true }

/// コピーが成立してテキストが実際に読めるようになるまで待つ。読めたら Some。
///
/// シーケンス番号は EmptyClipboard() の時点で増えるので、「番号が変わった＝データが読める」
/// ではない。番号を合図に読みにいくと、コピー処理の最中に割り込んで空文字を掴む
/// （Fork のように書き込みフォーマットが多いアプリで顕著）。
/// 他プロセスがクリップボードをロックしている間は読み取り自体も失敗するため、
/// どちらの場合も「テキストが取れるまで粘る」で吸収する。
///
/// 番号が動いた（＝元アプリがコピーを始めた）瞬間に `on_copy_started` を一度だけ呼ぶ。
/// 読めるまで 1 秒以上かかることがあり、その間 UI が無反応に見えるのを避けるための合図。
fn wait_for_copied_text(
    app: &AppHandle,
    before: u32,
    timeout: Duration,
    mut on_copy_started: impl FnMut(),
) -> Option<String> {
    let deadline = Instant::now() + timeout;
    let mut notified = false;
    loop {
        if clipboard_changed_since(before) {
            if !notified {
                notified = true;
                on_copy_started();
            }
            if let Ok(t) = app.clipboard().read_text() {
                if !t.is_empty() { return Some(t); }
            }
        }
        if Instant::now() >= deadline { return None; }
        thread::sleep(Duration::from_millis(25));
    }
}

/// コピー結果から表示に使うテキストを決める。
/// コピーが成立しなかったときに古いクリップボード内容へフォールバックしないのが要点
/// （失敗が「関係ない古い文章の表示」として現れるのを防ぐ）。
fn decide_text(copied: String, html_md: Option<String>, changed: bool) -> String {
    if !changed { return String::new(); }
    html_md.unwrap_or(copied)
}

#[cfg(test)]
mod decide_text_tests {
    use super::decide_text;

    #[test]
    fn prefers_html_flavor_when_copy_succeeded() {
        let t = decide_text("plain".into(), Some("**md**".into()), true);
        assert_eq!(t, "**md**");
    }

    #[test]
    fn falls_back_to_plain_text_when_no_html_flavor() {
        let t = decide_text("plain".into(), None, true);
        assert_eq!(t, "plain");
    }

    #[test]
    fn returns_empty_when_copy_did_not_happen() {
        // 古い HTML フレーバーが残っていても採用しない
        let t = decide_text("stale".into(), Some("**stale md**".into()), false);
        assert_eq!(t, "");
    }
}

/// ウィンドウをカーソル位置に出す。多重呼び出しを避けるため呼び出し側で一度だけ呼ぶこと
fn show_main_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    let win = app.get_webview_window("main")?;
    move_window_to_cursor(app, &win);
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_focus();
    Some(win)
}

/// ウィンドウをカーソル位置に出すが、フォーカスは奪わない（前景アプリはそのまま）。
/// ホットキー直後に呼び、取得を待つ間も「反応した」ことが見えるようにする。
/// 通常の show() は前面化を伴い、送った Ctrl+C が前景アプリに届かなくなる。
/// 一時的に focusable を外してから show() し、直後に戻す（戻さないと以後フォーカスできない）。
/// ShowWindow を直接呼ぶ方法は取らない。Tauri 側の表示状態が更新されず、
/// その後の hide() が「既に非表示」とみなされて効かなくなる
fn show_main_window_no_activate(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    let win = app.get_webview_window("main")?;
    move_window_to_cursor(app, &win);
    let _ = win.unminimize();
    let _ = win.set_focusable(false);
    let _ = win.show();
    let _ = win.set_focusable(true);
    Some(win)
}

/// 前景アプリに Ctrl+C を送る。
///
/// 押下・離上の間に間隔を入れないと、入力キューの処理が追いつかないアプリが
/// 修飾なしの `c` として受け取ったり丸ごと取りこぼしたりする（Fork のコミット
/// メッセージ欄で発生）。60ms の追加は体感できない範囲。
///
/// Windows では enigo を使わず自前で SendInput する。enigo の `Key::Unicode('c')` は
/// KEYEVENTF_UNICODE（VK_PACKET）で送るため、アプリには「仮想キー C」ではなく
/// 「文字 c」として届く。編集コントロールは WM_CHAR(0x03) で偶然コピーになるが、
/// アクセラレータや独自のキー処理で VK_C を見ているペイン（Fork の一覧・差分など）では
/// Ctrl+C と認識されず、クリップボードが一切動かない。仮想キー＋スキャンコードで送れば
/// 物理キーと同じ経路で届く
#[cfg(target_os = "windows")]
fn send_ctrl_c(_enigo: &mut Enigo) {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        MapVirtualKeyW, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
        MAPVK_VK_TO_VSC, VK_CONTROL,
    };
    const VK_C: u16 = 0x43;
    let key = |vk: u16, flags: u32| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: unsafe { MapVirtualKeyW(vk as u32, MAPVK_VK_TO_VSC) } as u16,
                dwFlags: flags, time: 0, dwExtraInfo: 0,
            },
        },
    };
    let gap = Duration::from_millis(20);
    let one = |input: INPUT| unsafe { SendInput(1, &input, std::mem::size_of::<INPUT>() as i32); };
    one(key(VK_CONTROL, 0));
    thread::sleep(gap);
    one(key(VK_C, 0));
    thread::sleep(gap);
    one(key(VK_C, KEYEVENTF_KEYUP));
    thread::sleep(gap);
    one(key(VK_CONTROL, KEYEVENTF_KEYUP));
}

#[cfg(not(target_os = "windows"))]
fn send_ctrl_c(enigo: &mut Enigo) {
    use enigo::Direction::Press;
    let gap = Duration::from_millis(20);
    let _ = enigo.key(Key::Control, Press);
    thread::sleep(gap);
    let _ = enigo.key(Key::Unicode('c'), Press);
    thread::sleep(gap);
    let _ = enigo.key(Key::Unicode('c'), Release);
    thread::sleep(gap);
    let _ = enigo.key(Key::Control, Release);
}

/// ホットキー時に何をするか
#[derive(Clone, Copy, PartialEq)]
enum Capture {
    /// 前景アプリに Ctrl+C を送って選択範囲を取る（通常）
    SendCopy,
    /// Ctrl+C は送らず、現在のクリップボードを使う（ターミナル等、送ると危険な前景アプリ）
    ClipboardOnly,
    /// 何も取らない（SnapGloss 自身が前景。自分に Ctrl+C を送っても意味がなく、
    /// 番号が動かないぶんタイムアウトまで待たされるだけになる）
    Skip,
}

fn hotkey_handler(app: &AppHandle, mode: Capture) {
    let app = app.clone();
    thread::spawn(move || {
        let prev_clipboard = app.clipboard().read_text().ok().unwrap_or_default();

        debug_log(&format!(
            "hotkey fired: mode={} foreground={} prev_clipboard_len={} {}",
            match mode { Capture::SendCopy => "send_copy", Capture::ClipboardOnly => "clipboard_only", Capture::Skip => "skip" },
            foreground_process_name(), prev_clipboard.chars().count(), foreground_focus_info()
        ));

        // Ctrl+C を送った直後にウィンドウを出す（フォーカスは奪わない）。選択がなくても
        // 押した瞬間に反応が見え、取得を待つ 2 秒近くが無反応にならない。
        // フォーカスは取得結果が確定してから移す（下の emit の直前）
        let mut shown = false;
        let show_pending = |app: &AppHandle, shown: &mut bool| {
            if *shown { return; }
            *shown = true;
            if let Some(win) = show_main_window_no_activate(app) {
                let _ = win.emit("hotkey-pending", ());
            }
        };

        let text = if mode == Capture::Skip {
            String::new()
        } else if mode == Capture::SendCopy {
            // Alt が離される前に済ませる必要があるので、待つより先に送る
            send_menu_mask_key();
            let released = wait_for_modifiers_released(Duration::from_millis(400));
            // Alt の解放を前景アプリが処理し終える前に Ctrl を押すと、同じ入力バッチとして
            // 扱われて Alt+Ctrl+C 相当に化けることがある。物理キーの解放から一呼吸おく
            thread::sleep(Duration::from_millis(50));
            let before_seq = clipboard_sequence();
            debug_log(&format!("modifiers_released={released} before_seq={before_seq} {}", foreground_focus_info()));
            let mut enigo = Enigo::new(&Settings::default()).ok();
            let enigo_ok = enigo.is_some();
            if let Some(enigo) = enigo.as_mut() {
                // 離れるのを待ちきれなかったときだけ、合成 Release で状態をこじ開ける
                if !released {
                    let _ = enigo.key(Key::Control, Release);
                    let _ = enigo.key(Key::Shift, Release);
                    let _ = enigo.key(Key::Alt, Release);
                    thread::sleep(Duration::from_millis(30));
                }
                send_ctrl_c(enigo);
            }
            show_pending(&app, &mut shown);
            let mut copied = wait_for_copied_text(&app, before_seq, Duration::from_millis(600), || {});
            // 600ms 経っても取れないときの原因は 2 通りあり、対処が逆になる。
            //
            // クリップボードが一度も動いていない → キー自体が届いていない。もう一度送る
            //   （ウィンドウは非アクティブ表示なので、前景アプリにそのまま届く）。
            // 番号が動いている → コピーは始まっていて読めるだけ遅い。送り直さず待つだけ
            //   （Fork のように書き込みフォーマットが多いアプリで起きる）。
            if copied.is_none() {
                if !clipboard_changed_since(before_seq) {
                    if let Some(enigo) = enigo.as_mut() {
                        debug_log("no clipboard change in 600ms, retrying ctrl+c");
                        send_ctrl_c(enigo);
                    }
                } else {
                    debug_log("copy started but text not readable in 600ms, waiting without resending");
                }
                copied = wait_for_copied_text(&app, before_seq, Duration::from_millis(1200), || {});
            }
            let changed = copied.is_some();
            let copied = copied.unwrap_or_default();
            // 元のクリップボードを復元する前に HTML フレーバーを読む
            let structured = if changed { clipboard_html_as_markdown() } else { None };
            debug_log(&format!(
                "enigo_ok={enigo_ok} changed={changed} after_seq={} copied_len={} html={}",
                clipboard_sequence(), copied.chars().count(),
                structured.as_ref().map(|s| s.chars().count() as i64).unwrap_or(-1)
            ));
            if changed && !prev_clipboard.is_empty() && prev_clipboard != copied {
                let _ = app.clipboard().write_text(prev_clipboard.clone());
            }
            decide_text(copied, structured, changed)
        } else {
            clipboard_html_as_markdown().unwrap_or(prev_clipboard)
        };

        // SendCopy 経路は非アクティブで表示済みなので、ここでフォーカスを移す。
        // それ以外（Skip・ClipboardOnly）はここで出す
        let win = if shown { app.get_webview_window("main") } else { show_main_window(&app) };
        if let Some(win) = win {
            if shown { let _ = win.set_focus(); }
            let _ = win.emit("hotkey-fired", text);
        }
    });
}

/// 前景ウィンドウのプロセス名（小文字, 例 "fork.exe"）。取れなければ空文字
#[cfg(target_os = "windows")]
fn foreground_process_name() -> String {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
    use windows_sys::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows_sys::Win32::Foundation::CloseHandle;
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd == 0 { return String::new(); }

        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 { return String::new(); }

        let hproc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if hproc == 0 { return String::new(); }

        let mut buf = [0u16; 512];
        let mut size = 512u32;
        QueryFullProcessImageNameW(hproc, 0, buf.as_mut_ptr(), &mut size);
        CloseHandle(hproc);

        let path = String::from_utf16_lossy(&buf[..size as usize]);
        path.rsplit('\\').next().unwrap_or("").to_lowercase()
    }
}

#[cfg(not(target_os = "windows"))]
fn foreground_process_name() -> String { String::new() }

/// 診断用：前景ウィンドウのタイトル、フォーカスのあるコントロールのクラス名、
/// マウスボタンが押されたままか。取りこぼしが「どのペインで」「どんな状態で」
/// 起きたかをログに残す（ドラッグ選択の途中でホットキーを押すと選択が確定していない、
/// 独自描画のペインにフォーカスがある、などを切り分ける）
#[cfg(target_os = "windows")]
fn foreground_focus_info() -> String {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetGUIThreadInfo, GetWindowTextW, GetWindowThreadProcessId, GUITHREADINFO,
    };
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd == 0 { return "no foreground".into(); }
        let mut title = [0u16; 128];
        let n = GetWindowTextW(hwnd, title.as_mut_ptr(), title.len() as i32);
        let title = String::from_utf16_lossy(&title[..n.max(0) as usize]);
        let tid = GetWindowThreadProcessId(hwnd, std::ptr::null_mut());
        let mut gti: GUITHREADINFO = std::mem::zeroed();
        gti.cbSize = std::mem::size_of::<GUITHREADINFO>() as u32;
        let mut focus_class = String::from("?");
        if GetGUIThreadInfo(tid, &mut gti) != 0 && gti.hwndFocus != 0 {
            let mut cls = [0u16; 128];
            let n = GetClassNameW(gti.hwndFocus, cls.as_mut_ptr(), cls.len() as i32);
            focus_class = String::from_utf16_lossy(&cls[..n.max(0) as usize]);
        }
        let mouse_down = GetAsyncKeyState(VK_LBUTTON as i32) as u16 & 0x8000 != 0
            || GetAsyncKeyState(VK_RBUTTON as i32) as u16 & 0x8000 != 0;
        format!("title=\"{}\" focus_class={} mouse_down={}", title.chars().take(60).collect::<String>(), focus_class, mouse_down)
    }
}

#[cfg(not(target_os = "windows"))]
fn foreground_focus_info() -> String { String::new() }

/// 前景ウィンドウが SnapGloss 自身か
#[cfg(target_os = "windows")]
fn foreground_is_self() -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd == 0 { return false; }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        pid == std::process::id()
    }
}

#[cfg(not(target_os = "windows"))]
fn foreground_is_self() -> bool { false }

/// 前面アプリに Ctrl+C を送ってよいか。プロセス名が取れないときは送らない（安全側）
#[cfg(target_os = "windows")]
fn foreground_is_safe(app: &AppHandle) -> bool {
    let name = foreground_process_name();
    if name.is_empty() { return false; }
    let Some(state) = app.try_state::<ExcludedApps>() else { return false };
    let safe = match state.0.lock() {
        Ok(excluded) => !excluded.iter().any(|e| e == &name),
        Err(_) => false,
    };
    safe
}

#[cfg(not(target_os = "windows"))]
fn foreground_is_safe(_app: &AppHandle) -> bool { true }

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // 2個目の起動は既存インスタンスのウィンドウを表示するだけにする
    // （ウィンドウ非表示のまま多重常駐するのを防ぐ。最初に登録すること）
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.unminimize();
            let _ = win.show();
            let _ = win.set_focus();
        }
    }));

    builder
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let mode = if foreground_is_self() {
                            Capture::Skip
                        } else if foreground_is_safe(app) {
                            Capture::SendCopy
                        } else {
                            Capture::ClipboardOnly
                        };
                        hotkey_handler(app, mode);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![hide_window, show_window, register_shortcut, get_api_key, set_api_key, get_settings, set_settings, default_excluded_apps, write_text_file, read_text_file])
        .setup(|app| {
            // 設定を読むより先に、旧フォルダからの引き継ぎを済ませる
            migrate_legacy_config_dir(app.handle());

            // 除外リストはホットキー登録より先に用意する（登録後は即座に発火しうる）
            let excluded = get_settings(app.handle().clone()).ok()
                .and_then(|raw| excluded_apps_from_settings(&raw))
                .unwrap_or_else(default_excluded_apps);
            app.manage(ExcludedApps(std::sync::Mutex::new(excluded)));

            let shortcut = Shortcut::new(
                Some(Modifiers::CONTROL | Modifiers::SHIFT),
                Code::KeyZ,
            );
            app.global_shortcut().register(shortcut)?;

            use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
            use tauri::tray::TrayIconBuilder;

            let show_item = MenuItem::with_id(app, "show", "SnapGloss を表示", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "終了", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[
                &show_item,
                &PredefinedMenuItem::separator(app)?,
                &quit_item,
            ])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("SnapGloss")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.unminimize();
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
