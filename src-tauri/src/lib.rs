use enigo::{
    Direction::{Click, Press, Release},
    Enigo, Key, Keyboard, Settings,
};
use std::{thread, time::{Duration, Instant}};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

fn key_file_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_config_dir()
        .map(|p| p.join("apikey"))
        .map_err(|e| e.to_string())
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
    app.path().app_config_dir()
        .map(|p| p.join("settings.json"))
        .map_err(|e| e.to_string())
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
    std::fs::write(&path, json).map_err(|e| e.to_string())
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
            "hotkey fired: mode={} foreground={} prev_clipboard_len={}",
            match mode { Capture::SendCopy => "send_copy", Capture::ClipboardOnly => "clipboard_only", Capture::Skip => "skip" },
            foreground_process_name(), prev_clipboard.chars().count()
        ));

        // コピー開始を検知した時点でウィンドウを出す。取得完了まで 1 秒以上かかることがあり、
        // それまで何も出ないと固まったように見える。Ctrl+C を送る前に出すと
        // フォーカスを奪って前景アプリにキーが届かなくなるため、この順序でなければならない
        let mut shown = false;
        let show_pending = |app: &AppHandle, shown: &mut bool| {
            if *shown { return; }
            *shown = true;
            if let Some(win) = show_main_window(app) {
                let _ = win.emit("hotkey-pending", ());
            }
        };

        let text = if mode == Capture::Skip {
            String::new()
        } else if mode == Capture::SendCopy {
            let released = wait_for_modifiers_released(Duration::from_millis(400));
            let before_seq = clipboard_sequence();
            debug_log(&format!("modifiers_released={released} before_seq={before_seq}"));
            let mut enigo_ok = false;
            if let Ok(mut enigo) = Enigo::new(&Settings::default()) {
                enigo_ok = true;
                // 離れるのを待ちきれなかったときだけ、合成 Release で状態をこじ開ける
                if !released {
                    let _ = enigo.key(Key::Control, Release);
                    let _ = enigo.key(Key::Shift, Release);
                    let _ = enigo.key(Key::Alt, Release);
                    thread::sleep(Duration::from_millis(30));
                }
                let _ = enigo.key(Key::Control, Press);
                let _ = enigo.key(Key::Unicode('c'), Click);
                let _ = enigo.key(Key::Control, Release);
            }
            let copied = wait_for_copied_text(&app, before_seq, Duration::from_millis(1500), || {
                show_pending(&app, &mut shown);
            });
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

        // コピー開始を検知できていれば表示済み。それ以外（取得失敗・Skip・ClipboardOnly）はここで出す
        let win = if shown { app.get_webview_window("main") } else { show_main_window(&app) };
        if let Some(win) = win {
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

#[cfg(target_os = "windows")]
fn foreground_is_safe() -> bool {
    let name = foreground_process_name();
    if name.is_empty() { return false; }
    {
        !matches!(name.as_str(),
            "windowsterminal.exe" | "wt.exe" | // Windows Terminal
            "powershell.exe" | "pwsh.exe"     | // PowerShell
            "cmd.exe"                          | // コマンドプロンプト
            "code.exe"                         | // VS Code（統合ターミナル含む）
            "conhost.exe"                      | // コンソールホスト
            "mintty.exe"                       | // Git Bash
            "alacritty.exe"                      // Alacritty
        )
    }
}

#[cfg(not(target_os = "windows"))]
fn foreground_is_safe() -> bool { true }

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
                        } else if foreground_is_safe() {
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
        .invoke_handler(tauri::generate_handler![hide_window, show_window, register_shortcut, get_api_key, set_api_key, get_settings, set_settings, write_text_file, read_text_file])
        .setup(|app| {
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
