use serde::Serialize;
use windows::Win32::Foundation::RECT;
use windows::Win32::System::SystemInformation::GetTickCount;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetSystemMetrics, GetWindowRect, SM_CXSCREEN, SM_CYSCREEN,
};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SystemSignals {
    pub at: i64,
    pub user_present: bool,
    pub suspended: bool,
    pub fullscreen: bool,
}

/// 距上一次键鼠输入过了多少秒（对应 Electron 的 getSystemIdleTime）
pub fn idle_seconds() -> u32 {
    let mut info = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    unsafe {
        // 返回值在 windows-rs 不同版本里可能是 BOOL 也可能是 Result
        let _ = GetLastInputInfo(&mut info);
        GetTickCount().wrapping_sub(info.dwTime) / 1000
    }
}

/// 前台窗口是否铺满主屏。
/// 只判断主屏：独占全屏和多屏场景是已知近似，与 Electron 版本的行为一致。
pub fn foreground_fullscreen() -> bool {
    unsafe {
        let foreground = GetForegroundWindow();
        if foreground.0.is_null() {
            return false;
        }
        let mut rect = RECT::default();
        if GetWindowRect(foreground, &mut rect).is_err() {
            return false;
        }
        let screen_width = GetSystemMetrics(SM_CXSCREEN);
        let screen_height = GetSystemMetrics(SM_CYSCREEN);
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;

        rect.left <= 0
            && rect.top <= 0
            && width >= screen_width
            && height >= screen_height
    }
}

pub fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

pub fn sample(idle_threshold_seconds: u32) -> SystemSignals {
    let idle = idle_seconds();
    SystemSignals {
        at: now_millis(),
        user_present: idle < idle_threshold_seconds,
        // 锁屏/休眠的状态由渲染进程结合 Tauri 事件判断；这里只报「是否在场」
        suspended: false,
        fullscreen: foreground_fullscreen(),
    }
}
