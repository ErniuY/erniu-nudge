import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import type { ReminderAction } from '@app/schema';
import OverlayApp from './OverlayApp';
import type { DesktopApi, OverlayPayload } from '../../shared/types';
import './styles.css';

// 悬浮窗口只需要两个能力，不要在这里启动调度引擎
window.api = {
  getOverlayPayload: () => invoke<OverlayPayload | null>('get_overlay_payload'),
  overlayAction: async (id: string, action: ReminderAction, minutes?: number) => {
    await invoke('overlay_action', { id, action, minutes: minutes ?? null });
  },
} as unknown as DesktopApi;

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <OverlayApp />
    </StrictMode>,
  );
}
