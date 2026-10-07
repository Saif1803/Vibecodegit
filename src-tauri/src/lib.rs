mod claude;
mod codex;
mod gemini;
mod commands;
mod git;
mod placement;
mod taskbar;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use placement::{exclude_bar, place, Area};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WindowEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_store::StoreExt;

const SETTINGS_STORE: &str = "settings.json";
const SHORTCUT_KEY: &str = "shortcut";
const DEFAULT_SHORTCUT: &str = "Ctrl+Shift+G";

const MAIN: &str = "main";
const TRAY: &str = "tray";
const EDGE_MARGIN: i32 = 12;
/// Default logical sizes: the tray popup, and with a detail pane (diff, commit, graph) open.
/// The user can resize either; each mode remembers its own size.
const COMPACT: (f64, f64) = (420.0, 500.0);
const EXPANDED: (f64, f64) = (960.0, 640.0);
/// Smallest sizes the layout still works at (the detail pane sits beside a 380 px column).
const COMPACT_MIN: (f64, f64) = (340.0, 420.0);
const EXPANDED_MIN: (f64, f64) = (720.0, 480.0);
/// Where the dragged position and resized sizes are kept between launches.
const LAYOUT_STORE: &str = "window.json";
/// A tray click this soon after a blur-hide is the same click that caused the blur,
/// so it should leave the window hidden rather than re-open it.
const BLUR_CLICK_GRACE: Duration = Duration::from_millis(400);
/// After a tray click, Explorer re-activates the taskbar once it finishes handling the
/// click, stealing focus from the window we just showed. A blur this soon after showing
/// is that steal, so we take focus back instead of hiding.
const SHOW_GRACE: Duration = Duration::from_millis(500);
const REFOCUS_DELAY: Duration = Duration::from_millis(60);
/// Dragging or resizing the window also blurs the webview, while the window itself stays in
/// front. A blur is only acted on if, this much later, something else really is in front.
const BLUR_CHECK_DELAY: Duration = Duration::from_millis(120);

#[derive(Default)]
struct WindowState {
    /// Off while a native dialog (e.g. the folder picker) owns focus.
    blur_hide: AtomicBool,
    last_blur_hide: Mutex<Option<Instant>>,
    shown_at: Mutex<Option<Instant>>,
    layout: Mutex<Layout>,
    /// The currently registered shortcut string (e.g. "Ctrl+Shift+G").
    shortcut_str: Mutex<String>,
}

/// Where the user put the window and how big they made it. Until they drag it, it opens
/// next to the tray; until they resize a mode, that mode uses its default size.
#[derive(Debug, Default, Clone, Copy)]
struct Layout {
    /// Top-left, physical pixels.
    pos: Option<(i32, i32)>,
    /// Logical sizes per mode.
    compact: Option<(f64, f64)>,
    expanded: Option<(f64, f64)>,
    expanded_now: bool,
    /// The position and inner size we last set, to tell the user's moves and resizes from ours.
    placed: Option<((i32, i32), (i32, i32))>,
}

fn load_layout(app: &AppHandle) -> Layout {
    fn get<T: serde::de::DeserializeOwned>(store: &tauri_plugin_store::Store<tauri::Wry>, key: &str) -> Option<T> {
        store.get(key).and_then(|v| serde_json::from_value(v).ok())
    }
    let Ok(store) = app.store(LAYOUT_STORE) else { return Layout::default() };
    Layout { pos: get(&store, "pos"), compact: get(&store, "compact"), expanded: get(&store, "expanded"), ..Layout::default() }
}

fn save_layout(app: &AppHandle, l: &Layout) {
    let Ok(store) = app.store(LAYOUT_STORE) else { return };
    let put = |k: &str, v: Option<serde_json::Value>| match v {
        Some(v) => store.set(k, v),
        None => {
            store.delete(k);
        }
    };
    put("pos", l.pos.map(|p| serde_json::json!(p)));
    put("compact", l.compact.map(|s| serde_json::json!(s)));
    put("expanded", l.expanded.map(|s| serde_json::json!(s)));
    let _ = store.save();
}

/// Record a drag or resize the user made since we last placed the window.
fn capture(app: &AppHandle, window: &WebviewWindow) {
    let (Ok(pos), Ok(size), Ok(scale)) = (window.outer_position(), window.inner_size(), window.scale_factor()) else {
        return;
    };
    let state = app.state::<WindowState>();
    let mut l = state.layout.lock().unwrap();
    let Some((placed_pos, placed_size)) = l.placed else { return };
    let (pos, size) = ((pos.x, pos.y), (size.width as i32, size.height as i32));
    let mut changed = false;
    if placement::differs(placed_pos, pos) {
        l.pos = Some(pos);
        changed = true;
    }
    if placement::differs(placed_size, size) {
        let logical = Some((size.0 as f64 / scale, size.1 as f64 / scale));
        if l.expanded_now {
            l.expanded = logical;
        } else {
            l.compact = logical;
        }
        changed = true;
    }
    l.placed = Some((pos, size));
    if changed {
        save_layout(app, &l);
    }
}

fn default_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyG)
}

/// Parse a user-facing shortcut string like "Ctrl+Shift+G" or "Alt+F2" into a Shortcut.
fn parse_shortcut(s: &str) -> std::result::Result<Shortcut, String> {
    let parts: Vec<&str> = s.split('+').map(|p| p.trim()).collect();
    if parts.is_empty() {
        return Err("Empty shortcut".into());
    }
    let mut mods = Modifiers::empty();
    for &part in &parts[..parts.len() - 1] {
        match part.to_lowercase().as_str() {
            "ctrl" | "control" => mods |= Modifiers::CONTROL,
            "shift" => mods |= Modifiers::SHIFT,
            "alt" => mods |= Modifiers::ALT,
            "super" | "win" | "meta" | "cmd" => mods |= Modifiers::SUPER,
            other => return Err(format!("Unknown modifier: {other}")),
        }
    }
    let key_str = *parts.last().ok_or("No key specified")?;
    let code = match key_str.to_lowercase().as_str() {
        // Letters
        "a" => Code::KeyA, "b" => Code::KeyB, "c" => Code::KeyC, "d" => Code::KeyD,
        "e" => Code::KeyE, "f" => Code::KeyF, "g" => Code::KeyG, "h" => Code::KeyH,
        "i" => Code::KeyI, "j" => Code::KeyJ, "k" => Code::KeyK, "l" => Code::KeyL,
        "m" => Code::KeyM, "n" => Code::KeyN, "o" => Code::KeyO, "p" => Code::KeyP,
        "q" => Code::KeyQ, "r" => Code::KeyR, "s" => Code::KeyS, "t" => Code::KeyT,
        "u" => Code::KeyU, "v" => Code::KeyV, "w" => Code::KeyW, "x" => Code::KeyX,
        "y" => Code::KeyY, "z" => Code::KeyZ,
        // Digits
        "0" => Code::Digit0, "1" => Code::Digit1, "2" => Code::Digit2, "3" => Code::Digit3,
        "4" => Code::Digit4, "5" => Code::Digit5, "6" => Code::Digit6, "7" => Code::Digit7,
        "8" => Code::Digit8, "9" => Code::Digit9,
        // Function keys
        "f1" => Code::F1, "f2" => Code::F2, "f3" => Code::F3, "f4" => Code::F4,
        "f5" => Code::F5, "f6" => Code::F6, "f7" => Code::F7, "f8" => Code::F8,
        "f9" => Code::F9, "f10" => Code::F10, "f11" => Code::F11, "f12" => Code::F12,
        // Others
        "space" => Code::Space, "enter" | "return" => Code::Enter,
        "tab" => Code::Tab, "escape" | "esc" => Code::Escape,
        "backspace" => Code::Backspace, "delete" | "del" => Code::Delete,
        "insert" | "ins" => Code::Insert, "home" => Code::Home, "end" => Code::End,
        "pageup" => Code::PageUp, "pagedown" => Code::PageDown,
        "`" | "backquote" => Code::Backquote,
        "-" | "minus" => Code::Minus, "=" | "equal" => Code::Equal,
        "[" | "bracketleft" => Code::BracketLeft, "]" | "bracketright" => Code::BracketRight,
        "\\" | "backslash" => Code::Backslash,
        ";" | "semicolon" => Code::Semicolon, "'" | "quote" => Code::Quote,
        "," | "comma" => Code::Comma, "." | "period" => Code::Period,
        "/" | "slash" => Code::Slash,
        other => return Err(format!("Unknown key: {other}")),
    };
    let mods_opt = if mods.is_empty() { None } else { Some(mods) };
    Ok(Shortcut::new(mods_opt, code))
}

fn load_shortcut_str(app: &AppHandle) -> String {
    app.store(SETTINGS_STORE)
        .ok()
        .and_then(|store| store.get(SHORTCUT_KEY))
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_else(|| DEFAULT_SHORTCUT.to_string())
}

fn save_shortcut_str(app: &AppHandle, s: &str) {
    if let Ok(store) = app.store(SETTINGS_STORE) {
        store.set(SHORTCUT_KEY, serde_json::json!(s));
        let _ = store.save();
    }
}

/// Unregister the old shortcut, register the new one, update tray tooltip and menu.
fn apply_shortcut(app: &AppHandle, new_str: &str) -> std::result::Result<(), String> {
    let new_sc = parse_shortcut(new_str)?;
    let gs = app.global_shortcut();

    // Unregister old
    let state = app.state::<WindowState>();
    let old_str = state.shortcut_str.lock().unwrap().clone();
    if let Ok(old_sc) = parse_shortcut(&old_str) {
        let _ = gs.unregister(old_sc);
    }

    // Register new
    gs.on_shortcut(new_sc, move |app, _shortcut, event| {
        if event.state() == ShortcutState::Pressed {
            toggle(app);
        }
    }).map_err(|e| format!("Could not register {new_str}: {e}"))?;

    // Update state
    *state.shortcut_str.lock().unwrap() = new_str.to_string();

    // Update tray
    update_tray_shortcut(app, new_str);
    Ok(())
}

fn update_tray_shortcut(app: &AppHandle, shortcut_str: &str) {
    if let Some(tray) = app.tray_by_id(TRAY) {
        let _ = tray.set_tooltip(Some(&format!("VibecodeGit ({shortcut_str})")));
        if let Ok(show_item) = MenuItem::with_id(app, "show", format!("Show  ({shortcut_str})"), true, None::<&str>) {
            if let Ok(reset_item) = MenuItem::with_id(app, "reset", "Reset window position and size", true, None::<&str>) {
                if let Ok(quit_item) = MenuItem::with_id(app, "quit", "Quit VibecodeGit", true, None::<&str>) {
                    if let Ok(menu) = Menu::with_items(app, &[&show_item, &reset_item, &quit_item]) {
                        let _ = tray.set_menu(Some(menu));
                    }
                }
            }
        }
    }
}

/// Returns the current shortcut string for the webview.
#[tauri::command]
fn get_shortcut(state: tauri::State<WindowState>) -> String {
    state.shortcut_str.lock().unwrap().clone()
}

/// Change the global shortcut. Validates, persists, and re-registers it.
#[tauri::command]
fn set_shortcut(app: AppHandle, shortcut: String) -> std::result::Result<(), String> {
    let shortcut = shortcut.trim().to_string();
    if shortcut.is_empty() {
        return Err("Shortcut cannot be empty".into());
    }
    // Validate first
    parse_shortcut(&shortcut)?;
    apply_shortcut(&app, &shortcut)?;
    save_shortcut_str(&app, &shortcut);
    Ok(())
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(MAIN)
}

fn tray_rect(app: &AppHandle) -> Option<Area> {
    app.tray_by_id(TRAY).and_then(|t| t.rect().ok().flatten()).map(|r| {
        let p = r.position.to_physical::<f64>(1.0);
        let s = r.size.to_physical::<f64>(1.0);
        Area { x: p.x as i32, y: p.y as i32, w: s.width as i32, h: s.height as i32 }
    })
}

/// The work area of the monitor under `point` (else the primary one), minus an auto-hide taskbar.
fn work_area_at(app: &AppHandle, point: Option<(i32, i32)>) -> tauri::Result<Option<Area>> {
    let monitor = match point {
        Some((x, y)) => app.monitor_from_point(x as f64, y as f64)?,
        None => None,
    };
    let Some(monitor) = monitor.or(app.primary_monitor()?) else {
        return Ok(None);
    };
    let wa = monitor.work_area();
    let mut work = Area { x: wa.position.x, y: wa.position.y, w: wa.size.width as i32, h: wa.size.height as i32 };
    if let Some(bar) = taskbar::rect() {
        work = exclude_bar(work, bar);
    }
    Ok(Some(work))
}

/// Size and place the window for the current mode: the user's size and spot when they
/// have one, else the default size next to the tray. Always kept on a screen.
fn arrange(app: &AppHandle, window: &WebviewWindow) -> tauri::Result<()> {
    let state = app.state::<WindowState>();
    let l = *state.layout.lock().unwrap();
    let scale = window.scale_factor()?;
    let (default, min, saved) = if l.expanded_now { (EXPANDED, EXPANDED_MIN, l.expanded) } else { (COMPACT, COMPACT_MIN, l.compact) };
    let (lw, lh) = saved.unwrap_or(default);
    window.set_min_size(Some(tauri::LogicalSize::new(min.0, min.1)))?;
    let (w, h) = ((lw * scale).round() as i32, (lh * scale).round() as i32);

    let tray = tray_rect(app);
    let anchor = match (l.pos, tray) {
        (Some((x, y)), _) => Some((x + w / 2, y + h / 2)),
        (None, Some(t)) => Some((t.x + t.w / 2, t.y + t.h / 2)),
        (None, None) => None,
    };
    let Some(work) = work_area_at(app, anchor)? else { return Ok(()) };
    // A size from a bigger screen shrinks to fit this one.
    let w = w.min(work.w - 2 * EDGE_MARGIN);
    let h = h.min(work.h - 2 * EDGE_MARGIN);
    let (x, y) = match l.pos {
        Some((x, y)) => placement::keep_inside(work, x, y, w, h),
        None => place(work, tray, w, h, EDGE_MARGIN),
    };
    window.set_size(tauri::PhysicalSize::new(w as u32, h as u32))?;
    window.set_position(tauri::PhysicalPosition::new(x, y))?;
    state.layout.lock().unwrap().placed = Some(((x, y), (w, h)));
    Ok(())
}

fn show(app: &AppHandle) {
    let Some(window) = main_window(app) else { return };
    // Every show starts compact; the webview closes its detail pane on hide.
    app.state::<WindowState>().layout.lock().unwrap().expanded_now = false;
    if let Err(e) = arrange(app, &window) {
        eprintln!("positioning failed: {e}");
    }
    *app.state::<WindowState>().shown_at.lock().unwrap() = Some(Instant::now());
    let _ = window.show();
    let _ = window.set_focus();
    let _ = app.emit_to(MAIN, "window-shown", ());
}

fn on_blur(app: &AppHandle) {
    let state = app.state::<WindowState>();
    if !state.blur_hide.load(Ordering::Relaxed) {
        return;
    }
    // `take` makes the refocus a one-shot: a second blur inside the grace hides normally.
    let just_shown = state
        .shown_at
        .lock()
        .unwrap()
        .take()
        .is_some_and(|t| t.elapsed() < SHOW_GRACE);
    if just_shown {
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(REFOCUS_DELAY);
            if let Some(window) = main_window(&app) {
                let _ = window.set_focus();
            }
        });
    } else {
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(BLUR_CHECK_DELAY);
            let Some(window) = main_window(&app) else { return };
            let state = app.state::<WindowState>();
            // Still in front (a drag or resize), already hidden, or a dialog opened meanwhile.
            if is_foreground(&window) || !window.is_visible().unwrap_or(false) || !state.blur_hide.load(Ordering::Relaxed) {
                return;
            }
            hide(&app);
            *state.last_blur_hide.lock().unwrap() = Some(Instant::now());
        });
    }
}

/// Our window is the foreground window. It stays so while the user drags or resizes it,
/// even though the webview inside reports losing focus.
#[cfg(windows)]
fn is_foreground(window: &WebviewWindow) -> bool {
    #[link(name = "user32")]
    extern "system" {
        fn GetForegroundWindow() -> *mut std::ffi::c_void;
    }
    let Ok(hwnd) = window.hwnd() else { return false };
    // SAFETY: takes no arguments and only returns a window handle (or null).
    unsafe { GetForegroundWindow() == hwnd.0 }
}

#[cfg(not(windows))]
fn is_foreground(window: &WebviewWindow) -> bool {
    window.is_focused().unwrap_or(false)
}

fn hide(app: &AppHandle) {
    if let Some(window) = main_window(app) {
        if window.is_visible().unwrap_or(false) {
            capture(app, &window);
        }
        let _ = window.hide();
        let _ = app.emit_to(MAIN, "window-hidden", ());
    }
}

/// Esc from the webview. Routed through Rust so every hide path emits `window-hidden`.
#[tauri::command]
fn hide_window(app: AppHandle) {
    hide(&app);
}

fn toggle(app: &AppHandle) {
    match main_window(app).map(|w| w.is_visible().unwrap_or(false)) {
        Some(true) => hide(app),
        Some(false) => show(app),
        None => {}
    }
}

fn on_tray_click(app: &AppHandle) {
    let state = app.state::<WindowState>();
    let just_blurred = state
        .last_blur_hide
        .lock()
        .unwrap()
        .take()
        .is_some_and(|t| t.elapsed() < BLUR_CLICK_GRACE);
    if !just_blurred {
        toggle(app);
    }
}

/// Widens the popup for a detail pane (or shrinks it back), at the size the user last gave
/// that mode, next to the tray or where they dragged it.
#[tauri::command]
fn set_expanded(app: AppHandle, expanded: bool) -> Result<(), String> {
    let window = main_window(&app).ok_or("main window missing")?;
    capture(&app, &window);
    {
        let state = app.state::<WindowState>();
        let mut l = state.layout.lock().unwrap();
        if l.expanded_now == expanded {
            return Ok(());
        }
        l.expanded_now = expanded;
    }
    arrange(&app, &window).map_err(|e| e.to_string())
}

/// Tray menu: forget the dragged position and sizes; back to the default popup by the tray.
fn reset_layout(app: &AppHandle) {
    let state = app.state::<WindowState>();
    let fresh = {
        let mut l = state.layout.lock().unwrap();
        *l = Layout { expanded_now: l.expanded_now, ..Layout::default() };
        *l
    };
    save_layout(app, &fresh);
    if let Some(window) = main_window(app).filter(|w| w.is_visible().unwrap_or(false)) {
        let _ = arrange(app, &window);
    }
}

/// Lets the frontend suspend hide-on-blur while a native dialog is open.
#[tauri::command]
fn set_blur_hide(state: tauri::State<WindowState>, enabled: bool) {
    state.blur_hide.store(enabled, Ordering::Relaxed);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered first: a second launch just surfaces the existing window.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show(app)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(WindowState {
            blur_hide: AtomicBool::new(true),
            shortcut_str: Mutex::new(DEFAULT_SHORTCUT.to_string()),
            ..Default::default()
        })
        .invoke_handler(tauri::generate_handler![
            get_shortcut,
            set_shortcut,
            set_blur_hide,
            set_expanded,
            hide_window,
            commands::resolve_repo,
            commands::agent_repos,
            commands::git_status,
            commands::stage,
            commands::stage_all,
            commands::unstage,
            commands::unstage_all,
            commands::discard,
            commands::file_diff,
            commands::is_head_published,
            commands::commit_push,
            commands::sync,
            commands::list_branches,
            commands::create_branch,
            commands::switch_branch,
            commands::checkout_remote_branch,
            commands::rename_branch,
            commands::delete_branch,
            commands::delete_remote_branch,
            commands::merge_branch,
            commands::rebase_onto,
            commands::abort_operation,
            commands::list_stashes,
            commands::stash_push,
            commands::stash_apply,
            commands::stash_drop,
            commands::stash_clear,
            commands::stash_files,
            commands::stash_file_diff,
            commands::list_tags,
            commands::create_tag,
            commands::delete_tag,
            commands::push_tag,
            commands::delete_remote_tag,
            commands::list_remotes,
            commands::add_remote,
            commands::remove_remote,
            commands::fetch_remote,
            commands::history,
            commands::commit_detail,
            commands::compare_files,
            commands::compare_file_diff,
            commands::revert_commit,
            commands::cherry_pick,
            commands::reset_impact,
            commands::reset_to,
            commands::file_timeline,
            commands::blame_file,
            commands::apply_hunk,
            commands::check_secrets,
            commands::undo_last_commit,
            commands::add_to_gitignore,
            commands::claude_prompts,
            commands::list_worktrees,
            commands::add_worktree,
            commands::remove_worktree,
        ])
        .setup(|app| {
            let layout = load_layout(app.handle());
            *app.state::<WindowState>().layout.lock().unwrap() = layout;

            // Load persisted shortcut (or default)
            let shortcut_str = load_shortcut_str(app.handle());
            *app.state::<WindowState>().shortcut_str.lock().unwrap() = shortcut_str.clone();

            let show_item = MenuItem::with_id(app, "show", format!("Show  ({shortcut_str})"), true, None::<&str>)?;
            let reset_item = MenuItem::with_id(app, "reset", "Reset window position and size", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit VibecodeGit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &reset_item, &quit_item])?;

            let mut tooltip = format!("VibecodeGit ({shortcut_str})");
            let sc = parse_shortcut(&shortcut_str).unwrap_or_else(|_| default_shortcut());
            if let Err(e) = app.global_shortcut().on_shortcut(sc, |app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    toggle(app);
                }
            }) {
                eprintln!("could not register {shortcut_str}: {e}");
                tooltip = format!("VibecodeGit ({shortcut_str} unavailable: in use by another app)");
            }

            TrayIconBuilder::with_id(TRAY)
                .icon(app.default_window_icon().cloned().expect("bundle icon missing"))
                .tooltip(tooltip)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show(app),
                    "reset" => reset_layout(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        on_tray_click(tray.app_handle());
                    }
                })
                .build(app)?;

            let window = app.get_webview_window(MAIN).expect("main window missing");
            let handle = app.handle().clone();
            window.on_window_event(move |event| match event {
                WindowEvent::Focused(false) => on_blur(&handle),
                // Alt+F4 must not destroy the only window of a tray app.
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    hide(&handle);
                }
                _ => {}
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
