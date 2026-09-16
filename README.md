# erniu-nudge

可自定义的 Windows 桌面提醒器。久坐只是其中一条内置提醒，任何提醒项都可以自行配置触发器、图标、文案与呈现方式。

架构遵循：**内核是跨平台纯 TS，桌面端只是外壳**。后续要做 iOS 端时，直接复用 `packages/core` 与 `packages/schema`，只需新写界面、`ActivityProvider` 与通知排程器。

```
apps/desktop  ──►  packages/core  ──►  packages/schema
                    （纯计算）          （纯类型 + 校验）
```

## 命令

```bash
pnpm install
pnpm test                          # 跑全部单元测试（25 个）
pnpm typecheck                     # 类型检查
pnpm --filter @app/core preview    # 打印未来 24 小时的提醒计划

pnpm icons                         # 生成托盘 / 窗口 / 打包用的图标
pnpm dev                           # 启动桌面应用（开发模式，热重载）
pnpm build:win                     # 打包成 NSIS 安装包 + 免安装版
```

## 目录

```
packages/schema/   # 提醒项与配置的 Zod schema、内置模板（跨端复用）
packages/core/     # 调度内核：触发器、状态机、tick()/plan()（跨端复用）
apps/desktop/      # Electron 外壳：主进程、预加载、React 界面
```

## 桌面端结构

```
apps/desktop/src/
├── shared/           两侧共用的通道名与类型
├── preload/          contextBridge 暴露的受限 API
├── main/
│   ├── index.ts      应用入口：单实例、托盘、窗口、开机自启
│   ├── engineHost.ts 唯一同时知道「内核」和「Electron」的一层
│   ├── configStore.ts 配置原子写入、备份回退、图标导入、历史记录
│   ├── ipc.ts        所有 IPC 处理器（入参一律先过 schema 校验）
│   ├── notify/       悬浮卡片、系统通知
│   ├── system/       WindowsActivityProvider、全屏探测
│   └── util/         页面加载、文案模板渲染
└── renderer/
    ├── index.html    主窗口
    ├── overlay.html  悬浮提醒卡片（独立入口）
    └── src/          React 界面
```

## 已知待改进

- **固定间隔提醒的相位**：`interval` 的基准取应用启动时刻，配合生效时间段会出现「09:36 而不是 09:00」的偏移。理想行为是按当天时间窗口起点重新对齐。
- **节假日**：已支持「中国工作日（含调休）」，但节假日数据是可选的，需要额外安装（见下）；不装则按周一到周五处理。
- **升级策略的 UI**：内核与悬浮卡片都支持三级升级（0 / 3 / 8 分钟），但界面只能开关，不能逐级改节奏。
- **全屏检测是可选依赖**：默认关闭（没装 `active-win` 时自动降级）。想启用执行 `pnpm --filter @app/desktop add -D active-win`，否则「全屏时暂不打扰」不会生效。
- **CSP**：渲染进程 HTML 还没写 Content-Security-Policy，Electron 控制台会有提示。对外分发前应补上。
- **配置导入导出**：存储层已就绪，界面入口还没做。

## 可选依赖

这两个都做成可选，缺了也不会让应用起不来，只是对应功能降级：

| 依赖 | 作用 | 不装会怎样 |
| --- | --- | --- |
| `chinese-days` | 识别中国法定假日与调休 | 选「中国工作日」的提醒按「周一到周五」处理：调休的周六不提醒，放假的周一照常提醒 |
| `active-win` | 读取前台窗口几何信息，判断是否全屏 | 「全屏时暂不打扰」不生效 |

```bash
pnpm --filter @app/desktop add chinese-days active-win
```

装完重启 `pnpm dev`。当前状态可以在设置页的「节假日数据」一行看到：显示 `chinese-days（含调休）` 就是已启用，显示「未加载」就是还在按周一到周五处理。

## 关键设计

- **久坐 ≠ 定时器**：按「有效连续使用时长」计时，离开、锁屏、休眠会清零。
- **双模式引擎**：`tick()` 供桌面实时判断，`plan()` 供 iOS 预排本地通知（iOS 不允许常驻后台定时）。
- **信号源可插拔**：`ActivityProvider` 接口隔离平台差异，Windows 用键鼠空闲，iOS 将来换 CoreMotion。
- **资源用逻辑 ID**：图标存 `builtin:stand-up` / `asset:xxx`，不存文件路径，否则同步到手机后全部失效。
- **同步字段预留**：`schemaVersion` / `deviceId` / `updatedAt` / `deletedAt` 已就位，将来接后端不用做数据迁移。
- **日历可插拔**：内核只认 `WorkdayCalendar` 接口，不认识 chinese-days。节假日这种强地域性的东西放在平台层，将来 iOS 端可以换别的数据源，调度逻辑一行不用改。
