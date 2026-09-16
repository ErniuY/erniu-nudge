import { Notification, type BrowserWindow } from 'electron';
import type { TriggerEvent } from '@app/core';
import { createOverlayWindow } from './overlay';
import { renderTemplate } from '../util/render';

export interface Notifier {
  present(event: TriggerEvent): Promise<void>;
  closeFor(reminderId: string): void;
  closeAll(): void;
}

export function createNotifier(deps: {
  isMuted: () => boolean;
  resolveAssetUrl: (ref: string) => string | null;
}): Notifier {
  const live = new Map<string, BrowserWindow>();

  return {
    async present(event) {
      if (deps.isMuted()) return;

      const { reminder } = event;
      const step = reminder.escalation.steps[event.escalationStep];
      const title = renderTemplate(reminder.title, event.variables);
      const message = renderTemplate(reminder.message, event.variables);

      if (reminder.presentation !== 'toast') {
        // 同一条提醒只保留一张卡片，升级重弹时先关掉旧的
        live.get(reminder.id)?.close();

        const win = createOverlayWindow({
          reminderId: reminder.id,
          title,
          message,
          icon: reminder.icon,
          iconDataUrl: reminder.icon.startsWith('asset:')
            ? deps.resolveAssetUrl(reminder.icon)
            : null,
          iconColor: reminder.iconColor,
          corner: reminder.overlayStyle.corner,
          width: reminder.overlayStyle.width,
          opacity: reminder.overlayStyle.opacity,
          fullscreenMask: step?.fullscreenMask ?? false,
          autoCloseSeconds: step?.autoCloseSeconds ?? 30,
          sound: step?.sound ?? 'normal',
          escalationStep: event.escalationStep,
          actions: reminder.actions,
          snoozeMinutes: reminder.snoozeMinutes,
          variables: event.variables,
        });

        live.set(reminder.id, win);
        win.on('closed', () => {
          if (live.get(reminder.id) === win) live.delete(reminder.id);
        });
      }

      if (reminder.presentation !== 'overlay') {
        // silent 交给系统：卡片场景由渲染进程合成音效，Toast 场景用系统提示音
        new Notification({ title, body: message, silent: false }).show();
      }
    },

    closeFor(reminderId) {
      live.get(reminderId)?.close();
      live.delete(reminderId);
    },

    closeAll() {
      for (const win of live.values()) win.close();
      live.clear();
    },
  };
}
