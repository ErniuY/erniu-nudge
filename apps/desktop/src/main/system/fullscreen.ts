import { screen } from 'electron';

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function covers(windowBounds: Bounds, displayBounds: Bounds, tolerance = 4): boolean {
  return (
    Math.abs(windowBounds.x - displayBounds.x) <= tolerance &&
    Math.abs(windowBounds.y - displayBounds.y) <= tolerance &&
    windowBounds.width >= displayBounds.width - tolerance * 4 &&
    windowBounds.height >= displayBounds.height - tolerance * 4
  );
}

/**
 * 全屏应用探测。
 *
 * Electron 自身无法查询「别的应用」的窗口是否全屏，需要 active-win 这类
 * 能读取前台窗口几何信息的包。这里做成可选依赖：
 *
 * - 没装 active-win 时自动降级（始终返回 false），应用照常运行；
 * - 想启用就 `pnpm --filter @app/desktop add -D active-win`。
 *
 * 另外，独占全屏（DirectX）游戏靠窗口几何判断并不可靠，
 * 所以界面文案写「检测到全屏应用时暂不打扰」，不要承诺 100% 准确。
 */
export class FullscreenDetector {
  private timer: NodeJS.Timeout | null = null;
  private last: boolean | null = null;
  private unavailable = false;

  constructor(
    private readonly onChange: (value: boolean) => void,
    private readonly intervalMs = 2000,
  ) {}

  start(): void {
    if (this.timer || this.unavailable) return;
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.stop();
  }

  private async poll(): Promise<void> {
    try {
      // 用变量承载模块名，避免打包器在编译期解析这个可选依赖
      const moduleName = 'active-win';
      const activeWindow = (await import(/* @vite-ignore */ moduleName)) as {
        default: () => Promise<{ bounds: Bounds } | undefined>;
      };
      const current = await activeWindow.default();
      const fullscreen = current
        ? screen.getAllDisplays().some((display) => covers(current.bounds, display.bounds))
        : false;

      if (fullscreen !== this.last) {
        this.last = fullscreen;
        this.onChange(fullscreen);
      }
    } catch {
      // 没装 active-win（或查询失败）：降级为「不检测全屏」，别再每 2 秒重试
      this.unavailable = true;
      this.stop();
      console.info('[fullscreen] 未启用全屏检测。如需启用：pnpm --filter @app/desktop add -D active-win');
    }
  }
}
