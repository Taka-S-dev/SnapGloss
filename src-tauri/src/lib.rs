use enigo::{
    Direction::{Click, Press, Release},
    Enigo, Key, Keyboard, Settings,
};
use std::{thread, time::Duration};
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

fn hotkey_handler(app: &AppHandle, safe_to_copy: bool) {
    let app = app.clone();
    thread::spawn(move || {
        let prev_clipboard = app.clipboard().read_text().ok().unwrap_or_default();

        let text = if safe_to_copy {
            thread::sleep(Duration::from_millis(100));
            if let Ok(mut enigo) = Enigo::new(&Settings::default()) {
                let _ = enigo.key(Key::Control, Release);
                let _ = enigo.key(Key::Shift, Release);
                let _ = enigo.key(Key::Alt, Release);
                thread::sleep(Duration::from_millis(30));
                let _ = enigo.key(Key::Control, Press);
                let _ = enigo.key(Key::Unicode('c'), Click);
                let _ = enigo.key(Key::Control, Release);
            }
            thread::sleep(Duration::from_millis(150));
            let copied = app.clipboard().read_text().ok().unwrap_or_default();
            if !prev_clipboard.is_empty() && prev_clipboard != copied {
                let _ = app.clipboard().write_text(prev_clipboard.clone());
            }
            copied
        } else {
            prev_clipboard
        };

        if let Some(win) = app.get_webview_window("main") {
            move_window_to_cursor(&app, &win);
            let _ = win.unminimize();
            let _ = win.show();
            let _ = win.set_focus();
            let _ = win.emit("hotkey-fired", text);
        }
    });
}

#[cfg(target_os = "windows")]
fn foreground_is_safe() -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
    use windows_sys::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows_sys::Win32::Foundation::CloseHandle;
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd == 0 { return false; }

        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 { return false; }

        let hproc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if hproc == 0 { return false; }

        let mut buf = [0u16; 512];
        let mut size = 512u32;
        QueryFullProcessImageNameW(hproc, 0, buf.as_mut_ptr(), &mut size);
        CloseHandle(hproc);

        let path = String::from_utf16_lossy(&buf[..size as usize]);
        let name = path.rsplit('\\').next().unwrap_or("").to_lowercase();

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
                        hotkey_handler(app, foreground_is_safe());
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
