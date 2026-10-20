use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// 每张卡片的内容按窗口 label 暂存，渲染进程挂载后主动来取，
/// 避免「主进程推得太早、React 还没挂载」的竞态。
pub struct OverlayRegistry {
    payloads: Mutex<HashMap<String, Value>>,
}

impl OverlayRegistry {
    pub fn new() -> Self {
        Self {
            payloads: Mutex::new(HashMap::new()),
        }
    }

    pub fn store(&self, label: &str, payload: Value) {
        self.payloads
            .lock()
            .unwrap()
            .insert(label.to_string(), payload);
    }

    pub fn get(&self, label: &str) -> Option<Value> {
        self.payloads.lock().unwrap().get(label).cloned()
    }

    pub fn remove(&self, label: &str) {
        self.payloads.lock().unwrap().remove(label);
    }
}

/// 弹一张悬浮卡片。
///
/// 关键点（P0 已实测）：
/// - `focusable(false)` 才是 WS_EX_NOACTIVATE，`focused(false)` 只是"创建时不聚焦"，仍会抢焦点；
/// - 直接 `visible(true)` 创建，不调用 `show()`，否则 ShowWindow 会激活窗口；
/// - 先算好位置再创建，避免先出现在左上角再跳过去。
pub fn show_overlay(app: &AppHandle, payload: Value) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("overlay") {
        let _ = existing.close();
    }

    let fullscreen_mask = payload
        .get("fullscreenMask")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let has_actions = payload
        .get("actions")
        .and_then(Value::as_array)
        .map(|actions| !actions.is_empty())
        .unwrap_or(true);
    let card_width = payload
        .get("width")
        .and_then(Value::as_f64)
        .unwrap_or(360.0);
    let card_height = if has_actions { 216.0 } else { 160.0 };

    let (width, height, x, y) = match app.primary_monitor().map_err(|e| e.to_string())? {
        Some(monitor) => {
            let size = monitor.size();
            let origin = monitor.position();
            let scale = monitor.scale_factor();
            let logical_width = size.width as f64 / scale;
            let logical_height = size.height as f64 / scale;
            let origin_x = origin.x as f64 / scale;
            let origin_y = origin.y as f64 / scale;

            if fullscreen_mask {
                (logical_width, logical_height, origin_x, origin_y)
            } else {
                (
                    card_width,
                    card_height,
                    origin_x + logical_width - card_width - 24.0,
                    // 24 是任务栏之上的留白
                    origin_y + logical_height - card_height - 72.0,
                )
            }
        }
        None => (card_width, card_height, 0.0, 0.0),
    };

    let registry = &app.state::<crate::AppState>().overlays;
    registry.store("overlay", payload);

    let window = WebviewWindowBuilder::new(app, "overlay", WebviewUrl::App("overlay.html".into()))
        .title("nudge-overlay")
        .inner_size(width, height)
        .position(x, y)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .focusable(false)
        .resizable(false)
        .shadow(false)
        .visible(true)
        .build()
        .map_err(|error| error.to_string())?;

    if let Some(state) = app.try_state::<crate::AppState>() {
        crate::commands::debug_write(
            &state,
            &format!("overlay window url={:?}", window.url()),
        );
    }

    Ok(())
}
