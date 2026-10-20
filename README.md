# erniu-nudge

可自定义的 Windows 桌面提醒器。内置一条久坐提醒，任何提醒项都可以自行配置触发器、图标、文案与呈现方式。

## 架构

**Tauri 2 + Rust 外壳 + React 界面**，调度内核是纯 TS。

```
apps/desktop/src/renderer  ──►  packages/core  ──►  packages/schema
       （React + 引擎循环）        （纯计算）          （纯类型 + 校验）
                │
                ▼  invoke / event
apps/desktop/src-tauri（Rust：托盘、悬浮窗、空闲检测、文件、通知）
```

主窗口关闭后只是隐藏到托盘，WebView 仍然存活，引擎的 5 秒 tick 继续运行
（`tauri.conf.json` 里为此设置了 `backgroundThrottling: "disabled"`，否则隐藏后定时器会被节流）。

## 环境要求

| 依赖 | 说明 |
| --- | --- |
| Node.js 20+ | 前端构建 |
| pnpm | 包管理 |
| Rust（rustup，`stable-x86_64-pc-windows-msvc`） | 编译外壳 |
| Visual Studio Build Tools（VCTools + Windows SDK） | 提供 `link.exe` 与 `kernel32.lib` |
| WebView2 Runtime | Win10 1803+ / Win11 自带 |

国内网络下 `static.rust-lang.org` 与 `index.crates.io` 常常连不上，
所以 `apps/desktop/.cargo/config.toml` 里把 crates 源指向了 rsproxy 镜像。

## 命令

```bash
pnpm install
pnpm test                          # 核心包单元测试（25 个）
pnpm typecheck                     # 三个包的 TypeScript 类型检查
pnpm --filter @app/core preview    # 打印未来 24 小时的提醒计划

pnpm icons                         # 生成并同步托盘 / 窗口 / 安装包图标
pnpm dev                           # 启动桌面应用（Tauri dev，前端热重载）
pnpm build:win                     # 生成图标并打包 NSIS 安装包
```

> 手工跑 `cargo build --release` 时**必须带 `--features custom-protocol`**，
> 否则应用会去加载 devUrl（`http://localhost:5173`），打包后就是白屏。
> `pnpm build:win`（即 `tauri build`）会自动加上，无需手动处理。

## 目录

```
packages/schema/          # 提醒项与配置的 Zod schema、内置模板（跨端复用）
  └── src/appDefaults.ts  # ★ 所有默认值
packages/core/            # 调度内核：触发器、状态机、tick()/plan()（跨端复用）
apps/desktop/
├── src/shared/           # 两侧共用的类型（DesktopApi 等）
├── src/renderer/         # React 界面 + Tauri API 适配层 + 引擎循环
└── src-tauri/            # Rust 平台层
    ├── src/main.rs       # 入口：托盘、窗口事件、命令注册
    ├── src/commands.rs   # IPC 命令（bootstrap / 配置 / 事件 / 覆盖层）
    ├── src/config_store.rs # 原子写入、备份回退、图标导入、历史记录
    ├── src/overlay.rs    # 悬浮窗（focusable(false) 不抢焦点）
    └── src/platform.rs   # 空闲检测、全屏探测
```

## 可选依赖

`chinese-days` 用于识别中国法定假日与调休。**没装也不会崩**，选了「中国工作日」的提醒会按周一到周五处理。

```bash
pnpm --filter @app/desktop add chinese-days
```

装完重启 `pnpm dev`，设置页的「节假日数据」一行会显示 `chinese-days（含调休）`；
显示「未加载」就是在按周一到周五处理。

## 已知待改进

- **固定间隔提醒的相位**：`interval` 的基准取应用启动时刻，配合生效时间段会出现「09:36 而不是 09:00」的偏移。理想行为是按当天时间窗口起点重新对齐。
- **升级策略的 UI**：内核与悬浮卡片都支持三级升级（0 / 3 / 8 分钟），但界面只能开关，不能逐级改节奏。
- **CSP**：渲染进程 HTML 还没写 Content-Security-Policy，对外分发前应补上。
- **配置导入导出**：存储层已就绪，界面入口还没做。
- **全屏检测**：目前只看主屏的前台窗口几何，多屏与独占全屏属于已知近似。
- **调试日志**：启动错误与提醒呈现会写到 `%APPDATA%\erniu-nudge\tauri-debug.log`，排查完可删。

## 关键设计

- **久坐 ≠ 定时器**：按「有效连续使用时长」计时，离开、锁屏、休眠会清零。
- **默认值集中在一处**：`packages/schema/src/appDefaults.ts`。schema 的 `.default()`、内置模板、「新建提醒」表单三处共用同一份，改一次全生效。
- **双模式引擎**：`tick()` 供桌面实时判断，`plan()` 供 iOS 预排本地通知（iOS 不允许常驻后台定时）。
- **信号源可插拔**：内核只认 `ActivityProvider` 接口，Windows 用键鼠空闲，iOS 将来换 CoreMotion。
- **日历可插拔**：内核只认 `WorkdayCalendar` 接口，不认识 chinese-days。
- **资源用逻辑 ID**：图标存 `builtin:stand-up` / `asset:xxx`，不存文件路径，否则同步到手机后全部失效。
- **同步字段预留**：`schemaVersion` / `deviceId` / `updatedAt` / `deletedAt` 已就位，将来接后端不用做数据迁移。
- **悬浮窗不抢焦点**：必须同时用 `focused(false)` **和** `focusable(false)`；后者才是 `WS_EX_NOACTIVATE`。
