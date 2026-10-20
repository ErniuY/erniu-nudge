#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod config_store;
mod overlay;
mod platform;

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Emitter, Manager, Wry};

pub struct AppState {
    pub store: config_store::ConfigStore,
    pub overlays: overlay::OverlayRegistry,
    pub tray: Mutex<Option<TrayIcon>>,
    pub last_status: Mutex<Option<Value>>,
    pub paused: AtomicBool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPayload {
    pub config: Value,
    pub asset_urls: HashMap<String, String>,
}

pub fn config_payload(store: &config_store::ConfigStore) -> ConfigPayload {
    ConfigPayload {
        config: store.get_config().unwrap_or(Value::Null),
        asset_urls: store.asset_urls(),
    }
}

fn build_tray_menu(app: &AppHandle, paused: bool) -> tauri::Result<Menu<Wry>> {
    let open = MenuItem::with_id(app, "open", "打开设置…", true, None::<&str>)?;
    let pause = MenuItem::with_id(
        app,
        "pause",
        if paused { "恢复提醒" } else { "暂停提醒" },
        true,
        None::<&str>,
    )?;
    let separator_one = PredefinedMenuItem::separator(app)?;
    let mute30 = MenuItem::with_id(app, "mute30", "静音 30 分钟", true, None::<&str>)?;
    let mute60 = MenuItem::with_id(app, "mute60", "静音 1 小时", true, None::<&str>)?;
    let mute_tomorrow =
        MenuItem::with_id(app, "muteTomorrow", "静音到明天", true, None::<&str>)?;
    let unmute = MenuItem::with_id(app, "unmute", "取消静音", true, None::<&str>)?;
    let separator_two = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

    Menu::with_items(
        app,
        &[
            &open,
            &pause,
            &separator_one,
            &mute30,
            &mute60,
            &mute_tomorrow,
            &unmute,
            &separator_two,
            &quit,
        ],
    )
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_tray_menu(app, false)?;
    let tray = TrayIconBuilder::new()
        .icon(
            app.default_window_icon()
                .expect("缺少默认窗口图标")
                .clone(),
        )
        .tooltip("久坐提醒")
        .menu(&menu)
        .on_menu_event(on_tray_menu)
        .build(app)?;

    let state = app.state::<AppState>();
    *state.tray.lock().unwrap() = Some(tray);
    Ok(())
}

fn on_tray_menu(app: &AppHandle, event: MenuEvent) {
    let state = app.state::<AppState>();
    match event.id.as_ref() {
        "open" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        "pause" => {
            let paused = !state.paused.load(Ordering::Relaxed);
            state.paused.store(paused, Ordering::Relaxed);
            // 暂停逻辑在渲染进程的引擎里，这里只通知它
            let _ = app.emit_to("main", "toggle-pause", paused);
            if let Some(tray) = state.tray.lock().unwrap().as_ref() {
                if let Ok(menu) = build_tray_menu(app, paused) {
                    let _ = tray.set_menu(Some(menu));
                }
            }
        }
        // 与 packages/schema/src/appDefaults.ts 的 mute.shortMinutes / longMinutes 保持一致
        "mute30" => apply_mute(app, Some(platform::now_millis() + 30 * 60_000)),
        "mute60" => apply_mute(app, Some(platform::now_millis() + 60 * 60_000)),
        "muteTomorrow" => apply_mute(app, start_of_tomorrow()),
        "unmute" => apply_mute(app, None),
        "quit" => app.exit(0),
        _ => {}
    }
}

fn apply_mute(app: &AppHandle, until: Option<i64>) {
    let state = app.state::<AppState>();
    if let Err(error) = state.store.patch_global("muteUntil", json!(until)) {
        eprintln!("[tray] 更新静音失败：{error}");
        return;
    }
    // 渲染进程收到 config-changed 后会重建缓存并刷新界面
    let _ = app.emit("config-changed", config_payload(&state.store));
}

fn start_of_tomorrow() -> Option<i64> {
    use windows::Win32::System::SystemInformation::GetLocalTime;

    let local = unsafe { GetLocalTime() };
    let now = platform::now_millis();
    let seconds_today =
        local.wHour as i64 * 3600 + local.wMinute as i64 * 60 + local.wSecond as i64;
    let midnight = now - seconds_today * 1000 - (now % 1000);
    Some(midnight + 86_400_000)
}

fn main() {
    let start_hidden = std::env::args().any(|arg| arg == "--hidden");

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args(["--hidden"])
                .build(),
        )
        .setup(move |app| {
            let store = config_store::ConfigStore::new().map_err(|error| -> Box<dyn std::error::Error> {
                error.into()
            })?;

            app.manage(AppState {
                store,
                overlays: overlay::OverlayRegistry::new(),
                tray: Mutex::new(None),
                last_status: Mutex::new(None),
                paused: AtomicBool::new(false),
            });

            setup_tray(app.handle())?;

            if start_hidden {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }

            Ok(())
        })
        .on_page_load(|webview, payload| {
            use std::io::Write as _;
            let app = webview.app_handle();
            if let Some(state) = app.try_state::<AppState>() {
                let path = state.store.dir().join("tauri-debug.log");
                if let Ok(mut file) = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(path)
                {
                    let _ = writeln!(file, "[page] {:?} {}", payload.event(), payload.url());
                }
            }
        })
        .on_window_event(|window, event| {
            // 主窗口关闭 → 隐藏到托盘，而不是退出；WebView 继续存活，引擎才能继续 tick
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            commands::debug_report,
            commands::get_config,
            commands::save_config,
            commands::patch_global,
            commands::sample_signals,
            commands::append_history,
            commands::read_history_counts,
            commands::save_snapshot,
            commands::import_icon,
            commands::present_event,
            commands::publish_status,
            commands::get_overlay_payload,
            commands::overlay_action,
            commands::set_autostart,
        ])
        .run(tauri::generate_context!())
        .expect("Tauri 启动失败");
}
