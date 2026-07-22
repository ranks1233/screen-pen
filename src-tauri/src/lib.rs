use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewWindow,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const DEFAULT_HOTKEY: &str = "Ctrl+Alt+D";

struct AppState {
    drawing_active: Mutex<bool>,
    current_hotkey: Mutex<String>,
}

fn parse_hotkey(hotkey: &str) -> Result<Shortcut, String> {
    let mut modifiers = Modifiers::empty();
    let mut key_code: Option<Code> = None;

    for part in hotkey.split('+').map(|p| p.trim()) {
        match part.to_ascii_lowercase().as_str() {
            "ctrl" | "control" | "commandorcontrol" | "cmdorctrl" => {
                modifiers |= Modifiers::CONTROL
            }
            "alt" => modifiers |= Modifiers::ALT,
            "shift" => modifiers |= Modifiers::SHIFT,
            "super" | "meta" | "win" | "cmd" | "command" => modifiers |= Modifiers::SUPER,
            other => {
                key_code = Some(code_from_str(other)?);
            }
        }
    }

    let code = key_code.ok_or_else(|| format!("No key found in hotkey: {hotkey}"))?;
    Ok(Shortcut::new(
        if modifiers.is_empty() {
            None
        } else {
            Some(modifiers)
        },
        code,
    ))
}

fn code_from_str(s: &str) -> Result<Code, String> {
    let upper = s.to_ascii_uppercase();
    match upper.as_str() {
        "A" => Ok(Code::KeyA),
        "B" => Ok(Code::KeyB),
        "C" => Ok(Code::KeyC),
        "D" => Ok(Code::KeyD),
        "E" => Ok(Code::KeyE),
        "F" => Ok(Code::KeyF),
        "G" => Ok(Code::KeyG),
        "H" => Ok(Code::KeyH),
        "I" => Ok(Code::KeyI),
        "J" => Ok(Code::KeyJ),
        "K" => Ok(Code::KeyK),
        "L" => Ok(Code::KeyL),
        "M" => Ok(Code::KeyM),
        "N" => Ok(Code::KeyN),
        "O" => Ok(Code::KeyO),
        "P" => Ok(Code::KeyP),
        "Q" => Ok(Code::KeyQ),
        "R" => Ok(Code::KeyR),
        "S" => Ok(Code::KeyS),
        "T" => Ok(Code::KeyT),
        "U" => Ok(Code::KeyU),
        "V" => Ok(Code::KeyV),
        "W" => Ok(Code::KeyW),
        "X" => Ok(Code::KeyX),
        "Y" => Ok(Code::KeyY),
        "Z" => Ok(Code::KeyZ),
        "0" => Ok(Code::Digit0),
        "1" => Ok(Code::Digit1),
        "2" => Ok(Code::Digit2),
        "3" => Ok(Code::Digit3),
        "4" => Ok(Code::Digit4),
        "5" => Ok(Code::Digit5),
        "6" => Ok(Code::Digit6),
        "7" => Ok(Code::Digit7),
        "8" => Ok(Code::Digit8),
        "9" => Ok(Code::Digit9),
        "F1" => Ok(Code::F1),
        "F2" => Ok(Code::F2),
        "F3" => Ok(Code::F3),
        "F4" => Ok(Code::F4),
        "F5" => Ok(Code::F5),
        "F6" => Ok(Code::F6),
        "F7" => Ok(Code::F7),
        "F8" => Ok(Code::F8),
        "F9" => Ok(Code::F9),
        "F10" => Ok(Code::F10),
        "F11" => Ok(Code::F11),
        "F12" => Ok(Code::F12),
        "SPACE" => Ok(Code::Space),
        "TAB" => Ok(Code::Tab),
        "ESCAPE" | "ESC" => Ok(Code::Escape),
        other => Err(format!("Unsupported key: {other}")),
    }
}

fn drawing_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

fn set_drawing_active(app: &AppHandle, active: bool) {
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut flag) = state.drawing_active.lock() {
            *flag = active;
        }
    }

    if let Some(win) = drawing_window(app) {
        if active {
            let _ = win.show();
            let _ = win.set_always_on_top(true);
            let _ = win.set_focus();
            let _ = app.emit("drawing-activated", ());
        } else {
            let _ = app.emit("drawing-deactivated", ());
            let _ = win.hide();
        }
    }
}

fn toggle_drawing(app: &AppHandle) {
    let currently_active = app
        .try_state::<AppState>()
        .and_then(|s| s.drawing_active.lock().ok().map(|g| *g))
        .unwrap_or(false);
    set_drawing_active(app, !currently_active);
}

fn register_activate_hotkey(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    let shortcut = parse_hotkey(hotkey)?;
    let state = app.state::<AppState>();

    app.global_shortcut()
        .unregister_all()
        .map_err(|e| e.to_string())?;

    app.global_shortcut()
        .register(shortcut)
        .map_err(|e| e.to_string())?;

    if let Ok(mut current) = state.current_hotkey.lock() {
        *current = hotkey.to_string();
    }

    Ok(())
}

#[tauri::command]
fn deactivate_drawing(app: AppHandle) {
    set_drawing_active(&app, false);
}

#[tauri::command]
fn set_activate_hotkey(app: AppHandle, hotkey: String) -> Result<(), String> {
    register_activate_hotkey(&app, &hotkey)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        toggle_drawing(app);
                    }
                })
                .build(),
        )
        .manage(AppState {
            drawing_active: Mutex::new(false),
            current_hotkey: Mutex::new(String::new()),
        })
        .invoke_handler(tauri::generate_handler![
            deactivate_drawing,
            set_activate_hotkey,
        ])
        .setup(|app| {
            let quit = MenuItem::with_id(app, "quit", "Quit Screen Pen", true, None::<&str>)?;
            let toggle =
                MenuItem::with_id(app, "toggle", "Start / Stop Drawing", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle, &quit])?;

            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("Screen Pen")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "toggle" => {
                        toggle_drawing(app);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_drawing(tray.app_handle());
                    }
                })
                .build(app)?;

            if let Some(win) = app.get_webview_window("main") {
                let _ = win.hide();
            }

            let handle = app.handle().clone();
            register_activate_hotkey(&handle, DEFAULT_HOTKEY)
                .unwrap_or_else(|e| eprintln!("Failed to register default hotkey: {e}"));

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
