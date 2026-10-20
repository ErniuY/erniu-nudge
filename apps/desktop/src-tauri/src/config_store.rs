use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

/// 配置存储。
///
/// 刻意不在 Rust 里复刻 zod schema：配置的结构定义只有 TS 一份，
/// Rust 只把它当成 JSON 透明存取。否则两边的字段迟早会漂移。
pub struct ConfigStore {
    dir: PathBuf,
    config: RwLock<Option<Value>>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EngineSnapshot {
    pub active_seconds: f64,
    pub last_tick_at: Option<i64>,
}

impl Default for EngineSnapshot {
    fn default() -> Self {
        Self {
            active_seconds: 0.0,
            last_tick_at: None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub at: i64,
    /// 本地日期 'YYYY-MM-DD'，由 TS 侧算好传进来，避免 Rust 再引一套时区逻辑
    pub day_key: String,
    pub reminder_id: String,
    pub name: String,
    /// "fire" | "ack"
    pub kind: String,
    pub action: Option<String>,
    pub step: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct HistoryCounts {
    pub ack: i64,
    pub fire: i64,
}

impl ConfigStore {
    pub fn new() -> Result<Self, String> {
        // 用户明确要求数据目录用 ASCII：%APPDATA%\erniu-nudge
        let base = std::env::var("APPDATA").map_err(|_| "找不到 APPDATA 环境变量".to_string())?;
        let dir = PathBuf::from(base).join("erniu-nudge");
        fs::create_dir_all(&dir).map_err(|e| format!("创建数据目录失败：{e}"))?;

        let store = Self {
            dir,
            config: RwLock::new(None),
        };
        let loaded = store.read_config_with_fallback();
        *store.config.write().unwrap() = loaded;
        Ok(store)
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn get_config(&self) -> Option<Value> {
        self.config.read().unwrap().clone()
    }

    pub fn set_config(&self, value: Value) -> Result<Value, String> {
        let text = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
        atomic_write(&self.dir.join("config.json"), &text)?;
        atomic_write(&self.dir.join("config.backup.json"), &text)?;
        *self.config.write().unwrap() = Some(value.clone());
        Ok(value)
    }

    /// 静音这一类「外壳直接改」的字段，走一个轻量的局部更新
    pub fn patch_global(&self, key: &str, value: Value) -> Result<Value, String> {
        let mut current = self
            .get_config()
            .ok_or_else(|| "配置尚未初始化".to_string())?;
        if let Some(global) = current.get_mut("global").and_then(|g| g.as_object_mut()) {
            global.insert(key.to_string(), value);
        }
        self.set_config(current)
    }

    pub fn asset_urls(&self) -> HashMap<String, String> {
        let mut out = HashMap::new();
        let guard = self.config.read().unwrap();
        let Some(assets) = guard
            .as_ref()
            .and_then(|config| config.get("assets"))
            .and_then(|assets| assets.as_object())
        else {
            return out;
        };

        for (reference, entry) in assets {
            let Some(relative) = entry
                .get("files")
                .and_then(|files| files.get("win"))
                .and_then(|path| path.as_str())
            else {
                continue;
            };
            let path = self.dir.join(relative);
            let Ok(bytes) = fs::read(&path) else {
                continue;
            };
            let mime = match path
                .extension()
                .and_then(|ext| ext.to_str())
                .unwrap_or("")
                .to_lowercase()
                .as_str()
            {
                "png" => "image/png",
                "jpg" | "jpeg" => "image/jpeg",
                "webp" => "image/webp",
                "gif" => "image/gif",
                "svg" => "image/svg+xml",
                _ => "application/octet-stream",
            };
            out.insert(
                reference.clone(),
                format!("data:{mime};base64,{}", STANDARD.encode(bytes)),
            );
        }
        out
    }

    /// 导入图标：复制进数据目录，返回逻辑 ID。提醒项里只存 asset:<id>，不存路径。
    pub fn import_icon(&self, source: &Path) -> Result<String, String> {
        let extension = source
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("")
            .to_lowercase();
        if !["png", "jpg", "jpeg", "webp", "gif", "svg"].contains(&extension.as_str()) {
            return Err(format!("不支持的图片格式：{extension}"));
        }
        let size = fs::metadata(source)
            .map_err(|e| format!("读取图片失败：{e}"))?
            .len();
        if size > 1024 * 1024 {
            return Err(format!("图片过大（{} KB），请控制在 1 MB 以内", size / 1024));
        }

        let icons_dir = self.dir.join("assets").join("icons");
        fs::create_dir_all(&icons_dir).map_err(|e| e.to_string())?;

        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos();
        let id = format!("{nanos:x}");
        let id = &id[id.len().saturating_sub(12)..];
        let file_name = format!("{id}.{extension}");
        fs::copy(source, icons_dir.join(&file_name)).map_err(|e| format!("复制图片失败：{e}"))?;

        let reference = format!("asset:{id}");
        let mut current = self
            .get_config()
            .ok_or_else(|| "配置尚未初始化".to_string())?;
        if current.get("assets").is_none() {
            current["assets"] = json!({});
        }
        current["assets"][&reference] = json!({
            "kind": "icon",
            "files": { "win": format!("assets/icons/{file_name}") }
        });
        self.set_config(current)?;
        Ok(reference)
    }

    pub fn load_snapshot(&self) -> EngineSnapshot {
        fs::read_to_string(self.dir.join("state.json"))
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    pub fn save_snapshot(&self, snapshot: &EngineSnapshot) -> Result<(), String> {
        let text = serde_json::to_string(snapshot).map_err(|e| e.to_string())?;
        atomic_write(&self.dir.join("state.json"), &text)
    }

    pub fn append_history(&self, entry: &HistoryEntry) -> Result<(), String> {
        let month = entry.day_key.get(0..7).unwrap_or("0000-00");
        let dir = self.dir.join("history");
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let path = dir.join(format!("{month}.ndjson"));
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .map_err(|e| e.to_string())?;
        let line = serde_json::to_string(entry).map_err(|e| e.to_string())?;
        writeln!(file, "{line}").map_err(|e| e.to_string())
    }

    pub fn history_counts(&self, day_key: &str) -> HistoryCounts {
        let month = day_key.get(0..7).unwrap_or("0000-00");
        let path = self.dir.join("history").join(format!("{month}.ndjson"));
        let Ok(text) = fs::read_to_string(path) else {
            return HistoryCounts::default();
        };
        let mut counts = HistoryCounts::default();
        for line in text.lines() {
            let Ok(entry) = serde_json::from_str::<HistoryEntry>(line) else {
                continue;
            };
            if entry.day_key != day_key {
                continue;
            }
            if entry.kind == "fire" {
                counts.fire += 1;
            }
            if entry.kind == "ack" && entry.action.as_deref() == Some("done") {
                counts.ack += 1;
            }
        }
        counts
    }

    fn read_config_with_fallback(&self) -> Option<Value> {
        for name in ["config.json", "config.backup.json"] {
            if let Ok(raw) = fs::read_to_string(self.dir.join(name)) {
                // 用户用记事本等工具手改配置时可能留下 UTF-8 BOM，serde_json 会直接报错。
                // 这里先剥掉，避免「配置明明看着没问题却回退到备份」的诡异现象。
                let text = raw.strip_prefix('\u{feff}').unwrap_or(&raw);
                if let Ok(value) = serde_json::from_str::<Value>(text) {
                    return Some(value);
                }
                eprintln!("[config] {name} 解析失败，尝试下一个候选");
            }
        }
        None
    }
}

/// 先写临时文件并 fsync，再原子重命名，避免断电/崩溃产生半截 JSON
fn atomic_write(path: &Path, data: &str) -> Result<(), String> {
    let tmp = path.with_extension(format!("{}.tmp", std::process::id()));
    {
        let mut file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        file.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}
