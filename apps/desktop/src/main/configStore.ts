import { promises as fs } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import {
  defaultConfig,
  newId,
  parseConfig,
  zAppConfig,
  type AppConfig,
  type Reminder,
} from '@app/schema';
import { zonedParts, type EngineSnapshot } from '@app/core';

export interface HistoryEntry {
  at: number;
  reminderId: string;
  name: string;
  kind: 'fire' | 'ack';
  action?: string;
  step?: number;
}

interface HistoryCounts {
  dayKey: string;
  ack: number;
  fire: number;
}

const ICON_MAX_BYTES = 1024 * 1024;
const ICON_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

export class ConfigStore {
  private cache: AppConfig;
  private counts: HistoryCounts;

  private constructor(
    readonly dir: string,
    initial: AppConfig,
    counts: HistoryCounts,
  ) {
    this.cache = initial;
    this.counts = counts;
  }

  static async load(now = Date.now()): Promise<ConfigStore> {
    const dir = app.getPath('userData');
    await fs.mkdir(dir, { recursive: true });
    const config = await readConfigWithFallback(dir);
    const loaded = new ConfigStore(dir, config, emptyCounts(now));
    await loaded.recountHistory(now);
    return loaded;
  }

  // ---------------------------------------------------------------- 配置读写

  get(): AppConfig {
    return this.cache;
  }

  async update(mutator: (draft: AppConfig) => void): Promise<AppConfig> {
    const draft = structuredClone(this.cache);
    mutator(draft);
    draft.updatedAt = new Date().toISOString();

    // 先校验再落盘：任何非法状态都不会写进文件
    const next = zAppConfig.parse(draft);
    this.cache = next;
    await atomicWrite(this.configPath, JSON.stringify(next, null, 2));
    await atomicWrite(this.backupPath, JSON.stringify(next, null, 2));
    return next;
  }

  async upsertReminder(reminder: Reminder): Promise<AppConfig> {
    return this.update((draft) => {
      const index = draft.reminders.findIndex((item) => item.id === reminder.id);
      const stamped = { ...reminder, updatedAt: new Date().toISOString() };
      if (index >= 0) draft.reminders[index] = stamped;
      else draft.reminders.push(stamped);
    });
  }

  /** 软删除：留墓碑，将来同步到手机端时删除才能正确传播 */
  async removeReminder(id: string): Promise<AppConfig> {
    return this.update((draft) => {
      const target = draft.reminders.find((item) => item.id === id);
      if (target) target.deletedAt = new Date().toISOString();
    });
  }

  // ---------------------------------------------------------------- 图标资源

  get iconsDir(): string {
    return path.join(this.dir, 'assets', 'icons');
  }

  /**
   * 导入用户图标：复制到应用数据目录，返回逻辑 ID。
   * 提醒项里只存 asset:<id>，绝不存文件路径——否则同步到 iOS 端引用会全部失效。
   */
  async importIcon(sourcePath: string): Promise<{ ref: string; fileName: string }> {
    const ext = path.extname(sourcePath).toLowerCase();
    if (!ICON_EXTENSIONS.has(ext)) {
      throw new Error(`不支持的图片格式：${ext || '(无扩展名)'}`);
    }
    const stat = await fs.stat(sourcePath);
    if (stat.size > ICON_MAX_BYTES) {
      throw new Error(`图片过大（${Math.round(stat.size / 1024)} KB），请控制在 1 MB 以内`);
    }

    await fs.mkdir(this.iconsDir, { recursive: true });
    const id = newId().replace(/-/g, '').slice(0, 12);
    const fileName = `${id}${ext}`;
    await fs.copyFile(sourcePath, path.join(this.iconsDir, fileName));

    const ref = `asset:${id}`;
    await this.update((draft) => {
      draft.assets[ref] = { kind: 'icon', files: { win: `assets/icons/${fileName}` } };
    });
    return { ref, fileName };
  }

  /** 解析所有 asset 为 data URL，供渲染进程 <img> 直接使用 */
  async resolveAssetUrls(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const [ref, entry] of Object.entries(this.cache.assets)) {
      const relative = entry.files.win;
      if (!relative) continue;
      try {
        const buffer = await fs.readFile(path.join(this.dir, relative));
        const mime = MIME_BY_EXT[path.extname(relative).toLowerCase()] ?? 'application/octet-stream';
        out[ref] = `data:${mime};base64,${buffer.toString('base64')}`;
      } catch {
        // 文件被删或损坏：跳过，界面回退到内置图标
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- 运行期状态

  async loadSnapshot(): Promise<EngineSnapshot> {
    try {
      const raw = JSON.parse(await fs.readFile(this.runtimePath, 'utf8')) as EngineSnapshot;
      if (typeof raw.activeSeconds === 'number') return raw;
    } catch {
      // 首次启动或文件损坏，按全新会话处理
    }
    return { activeSeconds: 0, lastTickAt: null };
  }

  async saveSnapshot(snapshot: EngineSnapshot): Promise<void> {
    await atomicWrite(this.runtimePath, JSON.stringify(snapshot));
  }

  // ---------------------------------------------------------------- 历史记录

  async appendHistory(entry: HistoryEntry, timeZone: string): Promise<void> {
    const dayKey = zonedParts(entry.at, timeZone).dayKey;
    await fs.mkdir(this.historyDir, { recursive: true });
    await fs.appendFile(this.historyFile(entry.at, timeZone), `${JSON.stringify(entry)}\n`, 'utf8');

    if (this.counts.dayKey !== dayKey) this.counts = { dayKey, ack: 0, fire: 0 };
    if (entry.kind === 'fire') this.counts.fire += 1;
    if (entry.kind === 'ack' && entry.action === 'done') this.counts.ack += 1;
  }

  historyCounts(now: number, timeZone: string): { ack: number; fire: number } {
    const dayKey = zonedParts(now, timeZone).dayKey;
    if (this.counts.dayKey !== dayKey) return { ack: 0, fire: 0 };
    return { ack: this.counts.ack, fire: this.counts.fire };
  }

  private async recountHistory(now: number): Promise<void> {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const dayKey = zonedParts(now, timeZone).dayKey;
    this.counts = { dayKey, ack: 0, fire: 0 };

    try {
      const text = await fs.readFile(this.historyFile(now, timeZone), 'utf8');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as HistoryEntry;
          if (zonedParts(entry.at, timeZone).dayKey !== dayKey) continue;
          if (entry.kind === 'fire') this.counts.fire += 1;
          if (entry.kind === 'ack' && entry.action === 'done') this.counts.ack += 1;
        } catch {
          // 单行损坏不影响其余统计
        }
      }
    } catch {
      // 本月还没有历史文件
    }
  }

  private historyFile(epochMs: number, timeZone: string): string {
    const parts = zonedParts(epochMs, timeZone);
    return path.join(this.historyDir, `${parts.year}-${String(parts.month).padStart(2, '0')}.ndjson`);
  }

  private get historyDir(): string {
    return path.join(this.dir, 'history');
  }

  private get configPath(): string {
    return path.join(this.dir, 'config.json');
  }

  private get backupPath(): string {
    return path.join(this.dir, 'config.backup.json');
  }

  private get runtimePath(): string {
    return path.join(this.dir, 'state.json');
  }
}

function emptyCounts(now: number): HistoryCounts {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return { dayKey: zonedParts(now, timeZone).dayKey, ack: 0, fire: 0 };
}

async function readConfigWithFallback(dir: string): Promise<AppConfig> {
  for (const file of ['config.json', 'config.backup.json']) {
    try {
      const parsed = parseConfig(JSON.parse(await fs.readFile(path.join(dir, file), 'utf8')));
      if (parsed.ok) return parsed.config;
      console.warn(`[config] ${file} 校验失败，尝试下一个候选：`, parsed.errors.slice(0, 3));
    } catch {
      // 文件不存在或不是合法 JSON
    }
  }
  console.warn('[config] 未找到可用配置，使用默认配置');
  return defaultConfig(newId());
}

/** 先写临时文件并 fsync，再原子重命名，避免断电/崩溃产生半截 JSON */
async function atomicWrite(file: string, data: string): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  const handle = await fs.open(tmp, 'w');
  try {
    await handle.writeFile(data, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, file);
}
