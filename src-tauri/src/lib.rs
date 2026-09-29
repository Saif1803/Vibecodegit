mod claude;
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

const MAIN: &str = "main";
const TRAY: &str = "tray";
const EDGE_MARGIN: i32 = 12;
/// Logical sizes: the tray popup, and with a detail pane (diff, commit, graph) open.
const COMPACT: (f64, f64) = (380.0, 500.0);
const EXPANDED: (f64, f64) = (960.0, 640.0);
/// A tray click this soon after a blur-hide is the same click that caused the blur,
/// so it should leave the window hidden rather than re-open it.
const BLUR_CLICK_GRACE: Duration = Duration::from_millis(400);
/// After a tray click, Explorer re-activates the taskbar once it finishes handling the
/// click, stealing focus from the window we just showed. A blur this soon after showing
/// is that steal, so we take focus back instead of hiding.
const SHOW_GRACE: Duration = Duration::from_millis(500);
const REFOCUS_DELAY: Duration = Duration::from_millis(60);

#[derive(Default)]
struct WindowState {
    /// Off while a native dialog (e.g. the folder picker) owns focus.
    blur_hide: AtomicBool,
    last_blur_hide: Mutex<Option<Instant>>,
    shown_at: Mutex<Option<Instant>>,
}

fn toggle_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyG)
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(MAIN)
}

fn position_near_tray(app: &AppHandle, window: &WebviewWindow) -> tauri::Result<()> {
    let tray = app
        .tray_by_id(TRAY)
        .and_then(|t| t.rect().ok().flatten())
        .map(|r| {
            let p = r.position.to_physical::<f64>(1.0);
            let s = r.size.to_physical::<f64>(1.0);
            Area { x: p.x as i32, y: p.y as i32, w: s.width as i32, h: s.height as i32 }
        });

    let monitor = match tray {
        Some(t) => app.monitor_from_point((t.x + t.w / 2) as f64, (t.y + t.h / 2) as f64)?,
        None => None,
    };
    let Some(monitor) = monitor.or(app.primary_monitor()?) else {
        return Ok(());
    };
    let wa = monitor.work_area();
    let mut work = Area {
        x: wa.position.x,
        y: wa.position.y,
        w: wa.size.width as i32,
        h: wa.size.height as i32,
    };
    if let Some(bar) = taskbar::rect() {
        work = exclude_bar(work, bar);
    }

    // The expanded size can exceed a small screen: shrink to fit the work area.
    let size = window.outer_size()?;
    let w = (size.width as i32).min(work.w - 2 * EDGE_MARGIN);
    let h = (size.height as i32).min(work.h - 2 * EDGE_MARGIN);
    if (w, h) != (size.width as i32, size.height as i32) {
        window.set_size(tauri::PhysicalSize::new(w as u32, h as u32))?;
    }
    let (x, y) = place(work, tray, w, h, EDGE_MARGIN);
    window.set_position(tauri::PhysicalPosition::new(x, y))
}

fn show(app: &AppHandle) {
    let Some(window) = main_window(app) else { return };
    // Every show starts compact; the webview closes its detail pane on hide.
    let _ = window.set_size(tauri::LogicalSize::new(COMPACT.0, COMPACT.1));
    if let Err(e) = position_near_tray(app, &window) {
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
        hide(app);
        *state.last_blur_hide.lock().unwrap() = Some(Instant::now());
    }
}

fn hide(app: &AppHandle) {
    if let Some(window) = main_window(app) {
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

/// Widens the popup for a detail pane (or shrinks it back), keeping it next to the tray.
#[tauri::command]
fn set_expanded(app: AppHandle, expanded: bool) -> Result<(), String> {
    let window = main_window(&app).ok_or("main window missing")?;
    let (w, h) = if expanded { EXPANDED } else { COMPACT };
    window.set_size(tauri::LogicalSize::new(w, h)).map_err(|e| e.to_string())?;
    position_near_tray(&app, &window).map_err(|e| e.to_string())
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
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if *shortcut == toggle_shortcut() && event.state() == ShortcutState::Pressed {
                        toggle(app);
                    }
                })
                .build(),
        )
        .manage(WindowState { blur_hide: AtomicBool::new(true), ..Default::default() })
        .invoke_handler(tauri::generate_handler![
            set_blur_hide,
            set_expanded,
            hide_window,
            commands::resolve_repo,
            commands::claude_repos,
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
        ])
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "Show  (Ctrl+Shift+G)", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit ClaudeGit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let mut tooltip = String::from("ClaudeGit (Ctrl+Shift+G)");
            if let Err(e) = app.global_shortcut().register(toggle_shortcut()) {
                eprintln!("could not register Ctrl+Shift+G: {e}");
                tooltip = String::from("ClaudeGit (Ctrl+Shift+G unavailable: in use by another app)");
            }

            TrayIconBuilder::with_id(TRAY)
                .icon(app.default_window_icon().cloned().expect("bundle icon missing"))
                .tooltip(tooltip)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show(app),
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
