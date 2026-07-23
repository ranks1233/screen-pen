use std::sync::Mutex;
use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewWindow,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const DEFAULT_HOTKEY: &str = "Ctrl+Alt+D";
const DEFAULT_DISABLE_HOTKEY: &str = "Ctrl+Alt+Shift+D";

struct AppState {
    drawing_active: Mutex<bool>,
    app_disabled: Mutex<bool>,
    activate_hotkey: Mutex<String>,
    disable_hotkey: Mutex<String>,
    activate_shortcut: Mutex<Option<Shortcut>>,
    disable_shortcut: Mutex<Option<Shortcut>>,
    disable_menu_item: Mutex<Option<CheckMenuItem<tauri::Wry>>>,
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

fn is_app_disabled(app: &AppHandle) -> bool {
    app.try_state::<AppState>()
        .and_then(|s| s.app_disabled.lock().ok().map(|g| *g))
        .unwrap_or(false)
}

fn dist_point_to_segment(px: f32, py: f32, x0: f32, y0: f32, x1: f32, y1: f32) -> f32 {
    let dx = x1 - x0;
    let dy = y1 - y0;
    let len_sq = dx * dx + dy * dy;
    if len_sq < 1e-6 {
        let ex = px - x0;
        let ey = py - y0;
        return (ex * ex + ey * ey).sqrt();
    }
    let t = ((px - x0) * dx + (py - y0) * dy) / len_sq;
    let t = t.clamp(0.0, 1.0);
    let cx = x0 + t * dx;
    let cy = y0 + t * dy;
    let ex = px - cx;
    let ey = py - cy;
    (ex * ex + ey * ey).sqrt()
}

fn draw_thick_line(
    rgba: &mut [u8],
    width: u32,
    height: u32,
    x0: f32,
    y0: f32,
    x1: f32,
    y1: f32,
    thickness: f32,
    color: [u8; 4],
) {
    let half = thickness / 2.0;
    let w = width as i32;
    let h = height as i32;
    for y in 0..h {
        for x in 0..w {
            let dist = dist_point_to_segment(x as f32, y as f32, x0, y0, x1, y1);
            if dist <= half {
                let i = ((y * w + x) * 4) as usize;
                if i + 3 < rgba.len() {
                    rgba[i] = color[0];
                    rgba[i + 1] = color[1];
                    rgba[i + 2] = color[2];
                    rgba[i + 3] = color[3];
                }
            }
        }
    }
}

/// Clone the app icon and stamp a diagonal strike so the tray shows "off".
fn icon_with_disabled_mark(base: &Image<'_>) -> Image<'static> {
    let width = base.width();
    let height = base.height();
    let mut rgba = base.rgba().to_vec();
    let min_dim = width.min(height) as f32;
    let core = (min_dim * 0.12).max(2.0);
    let outline = core + (min_dim * 0.06).max(1.5);
    // Inset endpoints so the strike reads clearly inside the glyph.
    let inset = min_dim * 0.12;
    let x0 = inset;
    let y0 = inset;
    let x1 = width as f32 - 1.0 - inset;
    let y1 = height as f32 - 1.0 - inset;
    draw_thick_line(
        &mut rgba,
        width,
        height,
        x0,
        y0,
        x1,
        y1,
        outline,
        [255, 255, 255, 255],
    );
    draw_thick_line(
        &mut rgba,
        width,
        height,
        x0,
        y0,
        x1,
        y1,
        core,
        [220, 45, 45, 255],
    );
    Image::new_owned(rgba, width, height)
}

fn update_tray_disabled_visual(app: &AppHandle, disabled: bool) {
    let Some(tray) = app.tray_by_id("main-tray") else {
        return;
    };
    let Some(base) = app.default_window_icon() else {
        return;
    };
    if disabled {
        let icon = icon_with_disabled_mark(base);
        let _ = tray.set_icon(Some(icon));
        let _ = tray.set_tooltip(Some("Screen Pen (disabled)"));
    } else {
        let _ = tray.set_icon(Some(base.clone()));
        let _ = tray.set_tooltip(Some("Screen Pen"));
    }
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(guard) = state.disable_menu_item.lock() {
            if let Some(item) = guard.as_ref() {
                let _ = item.set_checked(disabled);
            }
        }
    }
}

fn set_drawing_active(app: &AppHandle, active: bool) {
    if active && is_app_disabled(app) {
        return;
    }

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
    if is_app_disabled(app) {
        return;
    }
    let currently_active = app
        .try_state::<AppState>()
        .and_then(|s| s.drawing_active.lock().ok().map(|g| *g))
        .unwrap_or(false);
    set_drawing_active(app, !currently_active);
}

fn toggle_app_disabled(app: &AppHandle) {
    let currently_disabled = is_app_disabled(app);
    let next = !currently_disabled;
    if next {
        // Leaving drawing mode when turning the app off.
        set_drawing_active(app, false);
    }
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut flag) = state.app_disabled.lock() {
            *flag = next;
        }
    }
    update_tray_disabled_visual(app, next);
}

fn register_hotkeys(app: &AppHandle, activate: &str, disable: &str) -> Result<(), String> {
    if activate.trim().eq_ignore_ascii_case(disable.trim()) {
        return Err("Disable hotkey must differ from activate hotkey".into());
    }

    let activate_sc = parse_hotkey(activate)?;
    let disable_sc = parse_hotkey(disable)?;
    let state = app.state::<AppState>();

    app.global_shortcut()
        .unregister_all()
        .map_err(|e| e.to_string())?;

    app.global_shortcut()
        .register(activate_sc)
        .map_err(|e| e.to_string())?;
    app.global_shortcut()
        .register(disable_sc)
        .map_err(|e| e.to_string())?;

    if let Ok(mut current) = state.activate_hotkey.lock() {
        *current = activate.to_string();
    }
    if let Ok(mut current) = state.disable_hotkey.lock() {
        *current = disable.to_string();
    }
    // Re-parse for storage so register() can take ownership above.
    if let Ok(mut sc) = state.activate_shortcut.lock() {
        *sc = Some(parse_hotkey(activate)?);
    }
    if let Ok(mut sc) = state.disable_shortcut.lock() {
        *sc = Some(parse_hotkey(disable)?);
    }

    Ok(())
}

#[tauri::command]
fn deactivate_drawing(app: AppHandle) {
    set_drawing_active(&app, false);
}

#[tauri::command]
fn set_activate_hotkey(app: AppHandle, hotkey: String) -> Result<(), String> {
    let disable = app
        .state::<AppState>()
        .disable_hotkey
        .lock()
        .map(|g| g.clone())
        .unwrap_or_else(|_| DEFAULT_DISABLE_HOTKEY.to_string());
    register_hotkeys(&app, &hotkey, &disable)
}

#[tauri::command]
fn set_disable_hotkey(app: AppHandle, hotkey: String) -> Result<(), String> {
    let activate = app
        .state::<AppState>()
        .activate_hotkey
        .lock()
        .map(|g| g.clone())
        .unwrap_or_else(|_| DEFAULT_HOTKEY.to_string());
    register_hotkeys(&app, &activate, &hotkey)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    let Some(state) = app.try_state::<AppState>() else {
                        return;
                    };
                    let is_disable = state
                        .disable_shortcut
                        .lock()
                        .ok()
                        .and_then(|g| g.as_ref().map(|sc| sc == shortcut))
                        .unwrap_or(false);
                    if is_disable {
                        toggle_app_disabled(app);
                        return;
                    }
                    toggle_drawing(app);
                })
                .build(),
        )
        .manage(AppState {
            drawing_active: Mutex::new(false),
            app_disabled: Mutex::new(false),
            activate_hotkey: Mutex::new(DEFAULT_HOTKEY.to_string()),
            disable_hotkey: Mutex::new(DEFAULT_DISABLE_HOTKEY.to_string()),
            activate_shortcut: Mutex::new(None),
            disable_shortcut: Mutex::new(None),
            disable_menu_item: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            deactivate_drawing,
            set_activate_hotkey,
            set_disable_hotkey,
        ])
        .setup(|app| {
            let quit = MenuItem::with_id(app, "quit", "Quit Screen Pen", true, None::<&str>)?;
            let toggle =
                MenuItem::with_id(app, "toggle", "Start / Stop Drawing", true, None::<&str>)?;
            let disable =
                CheckMenuItem::with_id(app, "disable", "Disable", true, false, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle, &disable, &quit])?;

            if let Some(state) = app.try_state::<AppState>() {
                if let Ok(mut item) = state.disable_menu_item.lock() {
                    *item = Some(disable.clone());
                }
            }

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
                    "disable" => {
                        toggle_app_disabled(app);
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
                        let app = tray.app_handle();
                        if is_app_disabled(app) {
                            toggle_app_disabled(app);
                        } else {
                            toggle_drawing(app);
                        }
                    }
                })
                .build(app)?;

            if let Some(win) = app.get_webview_window("main") {
                let _ = win.hide();
            }

            let handle = app.handle().clone();
            register_hotkeys(&handle, DEFAULT_HOTKEY, DEFAULT_DISABLE_HOTKEY)
                .unwrap_or_else(|e| eprintln!("Failed to register default hotkeys: {e}"));

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
