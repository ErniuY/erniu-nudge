use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::config_store::{EngineSnapshot, HistoryCounts, HistoryEntry};
use crate::platform::{self, SystemSignals};
use crate::{config_payload, overlay, AppState, ConfigPayload};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    pub config: Option<Value>,
    pub asset_urls: HashMap<String, String>,
    pub snapshot: EngineSnapshot,
    pub idle_threshold_seconds: u32,
}

#[tauri::command]
pub fn bootstrap(state: State<'_, AppState>) -> Bootstrap {
    debug_log(&state, "bootstrap called");
    Bootstrap {
        config: state.store.get_config(),
        asset_urls: state.store.asset_urls(),
        snapshot: state.store.load_snapshot(),
        idle_threshold_seconds: idle_threshold(&state),
    }
}

/// 前端启动阶段的错误上报（只用于诊断，正常流程不会调用）
#[tauri::command]
pub fn debug_report(state: State<'_, AppState>, message: String) {
    debug_log(&state, &message);
}

/// 用资源管理器打开应用自己的数据目录。
/// 只允许打开应用自己的路径，不接受前端传入任意路径。
#[tauri::command]
pub fn open_data_dir(state: State<'_, AppState>) -> Result<(), String> {
    std::process::Command::new("explorer.exe")
        .arg(state.store.dir())
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("打开数据目录失败：{error}"))
}

#[tauri::command]
pub fn get_config(state: State<'_, AppState>) -> ConfigPayload {
    config_payload(&state.store)
}

#[tauri::command]
pub fn save_config(
    app: AppHandle,
    state: State<'_, AppState>,
    config: Value,
) -> Result<ConfigPayload, String> {
    state.store.set_config(config)?;
    let payload = config_payload(&state.store);
    let _ = app.emit("config-changed", payload.clone());
    Ok(payload)
}

#[tauri::command]
pub fn patch_global(
    app: AppHandle,
    state: State<'_, AppState>,
    key: String,
    value: Value,
) -> Result<ConfigPayload, String> {
    state.store.patch_global(&key, value)?;
    let payload = config_payload(&state.store);
    let _ = app.emit("config-changed", payload.clone());
    Ok(payload)
}

#[tauri::command]
pub fn sample_signals(state: State<'_, AppState>) -> SystemSignals {
    platform::sample(idle_threshold(&state))
}

#[tauri::command]
pub fn append_history(
    state: State<'_, AppState>,
    entry: HistoryEntry,
) -> Result<HistoryCounts, String> {
    state.store.append_history(&entry)?;
    Ok(state.store.history_counts(&entry.day_key))
}

#[tauri::command]
pub fn read_history_counts(state: State<'_, AppState>, day_key: String) -> HistoryCounts {
    state.store.history_counts(&day_key)
}

#[tauri::command]
pub fn save_snapshot(state: State<'_, AppState>, snapshot: EngineSnapshot) -> Result<(), String> {
    state.store.save_snapshot(&snapshot)
}

#[tauri::command]
pub async fn import_asset(app: AppHandle, kind: String) -> Result<Option<Value>, String> {
    use tauri_plugin_dialog::DialogExt;

    let (title, extensions): (&str, Vec<&'static str>) = match kind.as_str() {
        "icon" => (
            "选择提醒图标",
            vec!["png", "jpg", "jpeg", "webp", "gif", "svg"],
        ),
        "background" => (
            "选择背景图片",
            vec!["png", "jpg", "jpeg", "webp"],
        ),
        _ => return Err(format!("未知的资源类型：{kind}")),
    };

    let app_for_dialog = app.clone();
    // blocking_pick_file 会阻塞当前线程，必须丢到 blocking 线程池，不能占用主线程
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app_for_dialog
            .dialog()
            .file()
            .add_filter(title, &extensions)
            .blocking_pick_file()
    })
    .await
    .map_err(|error| error.to_string())?;

    let Some(file_path) = picked else {
        return Ok(None);
    };
    let path = file_path.into_path().map_err(|error| error.to_string())?;

    let state = app.state::<AppState>();
    let reference = state.store.import_asset(&kind, &path)?;
    let payload = config_payload(&state.store);
    let _ = app.emit("config-changed", payload);

    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("asset")
        .to_string();
    Ok(Some(json!({
        "ref": reference,
        "kind": kind,
        "fileName": file_name
    })))
}

const PROJECT_URL: &str = "https://github.com/ErniuY/erniu-nudge";

/// 打开项目主页（固定地址，避免前端打开任意 URL）
#[tauri::command]
pub fn open_project_page() -> Result<(), String> {
    std::process::Command::new("explorer.exe")
        .arg(PROJECT_URL)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("打开项目主页失败：{error}"))
}

#[tauri::command]
pub async fn present_event(
    app: AppHandle,
    state: State<'_, AppState>,
    event: Value,
) -> Result<(), String> {
    debug_log(
        &state,
        &format!(
            "present_event id={}",
            event
                .get("reminderId")
                .and_then(Value::as_str)
                .unwrap_or("?")
        ),
    );
    if is_muted(&state.store) {
        debug_log(&state, "present_event skipped: muted");
        return Ok(());
    }

    let reminder = event
        .get("reminder")
        .cloned()
        .unwrap_or(Value::Null);
    let presentation = reminder
        .get("presentation")
        .and_then(Value::as_str)
        .unwrap_or("both");
    let step_index = event
        .get("escalationStep")
        .and_then(Value::as_u64)
        .unwrap_or(0) as usize;
    let step = reminder
        .get("escalation")
        .and_then(|escalation| escalation.get("steps"))
        .and_then(Value::as_array)
        .and_then(|steps| steps.get(step_index))
        .cloned()
        .unwrap_or(Value::Null);

    if presentation != "toast" {
        let payload = build_overlay_payload(&event, &reminder, &step, &state.store);
        match overlay::show_overlay(&app, payload) {
            Ok(()) => debug_log(&state, "overlay shown"),
            Err(error) => {
                debug_log(&state, &format!("overlay failed: {error}"));
                return Err(error);
            }
        }
    }

    if presentation != "overlay" {
        use tauri_plugin_notification::NotificationExt;
        let title = render_template(
            reminder.get("title").and_then(Value::as_str).unwrap_or("提醒"),
            event.get("variables"),
        );
        let body = render_template(
            reminder
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or(""),
            event.get("variables"),
        );
        match app.notification().builder().title(title).body(body).show() {
            Ok(()) => debug_log(&state, "notification shown"),
            Err(error) => debug_log(&state, &format!("notification failed: {error}")),
        }
    }

    Ok(())
}

#[tauri::command]
pub fn publish_status(
    state: State<'_, AppState>,
    status: Value,
) -> Result<(), String> {
    *state.last_status.lock().unwrap() = Some(status.clone());

    let text = if status.get("paused").and_then(Value::as_bool).unwrap_or(false) {
        "久坐提醒：已暂停".to_string()
    } else if let Some(until) = status.get("mutedUntil").and_then(Value::as_i64) {
        if until > platform::now_millis() {
            "久坐提醒：已静音".to_string()
        } else {
            tooltip_from_status(&status)
        }
    } else {
        tooltip_from_status(&status)
    };

    if let Some(tray) = state.tray.lock().unwrap().as_ref() {
        let _ = tray.set_tooltip(Some(&text));
    }
    Ok(())
}

#[tauri::command]
pub fn get_overlay_payload(
    state: State<'_, AppState>,
    window: tauri::WebviewWindow,
) -> Option<Value> {
    debug_log(&state, &format!("overlay payload requested by {}", window.label()));
    state.overlays.get(window.label())
}

#[tauri::command]
pub async fn overlay_action(
    app: AppHandle,
    window: tauri::WebviewWindow,
    id: String,
    action: String,
    minutes: Option<u32>,
) -> Result<(), String> {
    let _ = app.emit_to(
        "main",
        "overlay-action",
        json!({ "id": id, "action": action, "minutes": minutes }),
    );
    let state = app.state::<AppState>();
    state.overlays.remove(window.label());
    let _ = window.close();
    Ok(())
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    if enabled {
        app.autolaunch().enable().map_err(|e| e.to_string())
    } else {
        app.autolaunch().disable().map_err(|e| e.to_string())
    }
}

fn idle_threshold(state: &State<'_, AppState>) -> u32 {
    state
        .store
        .get_config()
        .and_then(|config| {
            config
                .get("global")
                .and_then(|global| global.get("idleThresholdSeconds"))
                .and_then(Value::as_u64)
        })
        // 与 packages/schema/src/appDefaults.ts 的 global.idleThresholdSeconds 保持一致。
        // 这是配置文件缺失时的兜底值，Rust 无法直接 import TS 常量。
        .unwrap_or(120) as u32
}

pub fn debug_write(state: &AppState, message: &str) {
    use std::io::Write as _;
    let path = state.store.dir().join("tauri-debug.log");
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(file, "[{}] {message}", platform::now_millis());
    }
}

fn debug_log(state: &AppState, message: &str) {
    debug_write(state, message);
}

fn is_muted(store: &crate::config_store::ConfigStore) -> bool {
    store
        .get_config()
        .and_then(|config| {
            config
                .get("global")
                .and_then(|global| global.get("muteUntil"))
                .and_then(Value::as_i64)
        })
        .map(|until| until > platform::now_millis())
        .unwrap_or(false)
}

fn tooltip_from_status(status: &Value) -> String {
    let seconds = status
        .get("activeSeconds")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    if seconds < 60.0 {
        return "久坐提醒：刚开始计时".to_string();
    }
    let minutes = (seconds / 60.0).floor() as i64;
    if minutes >= 60 {
        format!("久坐提醒：已连续坐 {} 小时 {} 分", minutes / 60, minutes % 60)
    } else {
        format!("久坐提醒：已连续坐 {minutes} 分钟")
    }
}

fn build_overlay_payload(
    event: &Value,
    reminder: &Value,
    step: &Value,
    store: &crate::config_store::ConfigStore,
) -> Value {
    let variables = event.get("variables").cloned().unwrap_or(Value::Null);
    let title = render_template(
        reminder.get("title").and_then(Value::as_str).unwrap_or("提醒"),
        Some(&variables),
    );
    let message = render_template(
        reminder.get("message").and_then(Value::as_str).unwrap_or(""),
        Some(&variables),
    );
    let icon = reminder.get("icon").and_then(Value::as_str).unwrap_or("builtin:clock");
    let icon_data_url = if icon.starts_with("asset:") {
        store.asset_urls().get(icon).cloned()
    } else {
        None
    };
    let style = reminder.get("overlayStyle").cloned().unwrap_or(Value::Null);
    let theme = store
        .get_config()
        .and_then(|config| config.get("theme").cloned())
        .unwrap_or(Value::Null);
    let background_data_url = theme
        .get("overlayBackground")
        .and_then(Value::as_str)
        .and_then(|reference| store.asset_urls().get(reference).cloned());

    json!({
        "reminderId": event.get("reminderId").cloned().unwrap_or(Value::Null),
        "title": title,
        "message": message,
        "icon": icon,
        "iconDataUrl": icon_data_url,
        "iconColor": reminder.get("iconColor").and_then(Value::as_str).unwrap_or("#2F80ED"),
        "corner": style.get("corner").and_then(Value::as_str).unwrap_or("bottom-right"),
        "width": style.get("width").and_then(Value::as_u64).unwrap_or(360),
        "opacity": style.get("opacity").and_then(Value::as_f64).unwrap_or(0.96),
        "autoCloseSeconds": step.get("autoCloseSeconds").and_then(Value::as_u64).unwrap_or(30),
        "fullscreenMask": step.get("fullscreenMask").and_then(Value::as_bool).unwrap_or(false),
        "sound": step.get("sound").and_then(Value::as_str).unwrap_or("normal"),
        "escalationStep": event.get("escalationStep").and_then(Value::as_u64).unwrap_or(0),
        "actions": reminder.get("actions").cloned().unwrap_or(json!([])),
        "snoozeMinutes": reminder.get("snoozeMinutes").cloned().unwrap_or(json!([])),
        "variables": variables,
        "backgroundDataUrl": background_data_url,
        "imageMode": theme.get("overlayImageMode").and_then(Value::as_str).unwrap_or("background"),
        "backgroundFit": theme.get("overlayBackgroundFit").and_then(Value::as_str).unwrap_or("center"),
        "backgroundDim": theme.get("overlayDim").and_then(Value::as_f64).unwrap_or(0.45),
        "imagePosition": theme.get("overlayImagePosition").cloned().unwrap_or(json!({ "x": 76, "y": 44 })),
        "imageScale": theme.get("overlayImageScale").and_then(Value::as_f64).unwrap_or(1.0),
        "textPosition": theme.get("overlayTextPosition").cloned().unwrap_or(json!({ "x": 50, "y": 50 })),
        "textAlign": theme.get("overlayTextAlign").and_then(Value::as_str).unwrap_or("left"),
        "actionsPosition": theme.get("overlayActionsPosition").cloned().unwrap_or(json!({ "x": 50, "y": 76 })),
        "actionsDirection": theme.get("overlayActionsDirection").and_then(Value::as_str).unwrap_or("horizontal"),
        "cardTransparent": theme.get("overlayCardTransparent").and_then(Value::as_bool).unwrap_or(false),
    })
}

/// 把 {elapsed} 这类变量替换成实际值；未知变量原样保留
pub fn render_template(template: &str, variables: Option<&Value>) -> String {
    let Some(variables) = variables else {
        return template.to_string();
    };
    let mut out = String::with_capacity(template.len());
    let mut rest = template;

    while let Some(start) = rest.find('{') {
        out.push_str(&rest[..start]);
        let Some(end_offset) = rest[start..].find('}') else {
            out.push_str(&rest[start..]);
            return out;
        };
        let end = start + end_offset;
        let key = &rest[start + 1..end];
        match variables.get(key) {
            Some(value) if value.is_string() || value.is_number() => {
                out.push_str(&value.to_string().trim_matches('"'));
            }
            _ => out.push_str(&rest[start..=end]),
        }
        rest = &rest[end + 1..];
    }
    out.push_str(rest);
    out
}
