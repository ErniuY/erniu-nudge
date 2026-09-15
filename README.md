# erniu-nudge

可自定义的 Windows 桌面提醒器。久坐只是其中一条内置提醒，任何提醒项都可以自行配置触发器、图标、文案与呈现方式。

架构遵循：**内核是跨平台纯 TS，桌面端只是外壳**。后续要做 iOS 端时，直接复用 `packages/core` 与 `packages/schema`，只需新写界面、`ActivityProvider` 与通知排程器。

```
apps/desktop  ──►  packages/core  ──►  packages/schema
                    （纯计算）          （纯类型 + 校验）
```

## 当前进度

| 阶段   | 内容                                                             | 状态   |
| ------ | ---------------------------------------------------------------- | ------ |
| S1     | `packages/schema`：类型 + Zod 校验 + 内置模板                    | 已完成 |
| S2     | `packages/core` 基础设施：Clock、本地时间、ActivityProvider 抽象 | 已完成 |
| S3     | 触发器策略 + 6 种触发器实现                                      | 已完成 |
| S4     | `engine.tick()` 实时模式                                         | 已完成 |
| S5     | 假时钟测试套件                                                   | 已完成 |
| S6     | `engine.plan()` 计划模式                                         | 已完成 |
| S7–S10 | Electron 外壳、悬浮卡片、配置界面、打包                          | 未开始 |

## 命令

```bash
pnpm install
pnpm test                          # 跑全部单元测试（25 个）
pnpm typecheck                     # 类型检查
pnpm --filter @app/core preview    # 打印未来 24 小时的提醒计划
```

## 目录

```
packages/schema/   # 提醒项与配置的 Zod schema、内置模板（跨端复用）
packages/core/     # 调度内核：触发器、状态机、tick()/plan()（跨端复用）
```

## 已知待改进

- **固定间隔提醒的相位**：`interval` 的基准取应用启动时刻，配合生效时间段会出现「09:36 而不是 09:00」的偏移。理想行为是按当天时间窗口起点重新对齐。
- **节假日**：生效时间段只支持星期，不含法定节假日日历。
- **升级策略的 UI**：内核已支持多级升级，界面尚未提供配置入口（S9）。

## 关键设计

- **久坐 ≠ 定时器**：按「有效连续使用时长」计时，离开、锁屏、休眠会清零。
- **双模式引擎**：`tick()` 供桌面实时判断，`plan()` 供 iOS 预排本地通知（iOS 不允许常驻后台定时）。
- **信号源可插拔**：`ActivityProvider` 接口隔离平台差异，Windows 用键鼠空闲，iOS 将来换 CoreMotion。
- **资源用逻辑 ID**：图标存 `builtin:stand-up` / `asset:xxx`，不存文件路径，否则同步到手机后全部失效。
- **同步字段预留**：`schemaVersion` / `deviceId` / `updatedAt` / `deletedAt` 已就位，将来接后端不用做数据迁移。
