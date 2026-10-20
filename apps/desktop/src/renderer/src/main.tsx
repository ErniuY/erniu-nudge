import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initDesktop } from './tauri/api';
import './styles.css';

const container = document.getElementById('root');

// 先把配置、快照、历史读进内存，再渲染界面 ——
// 否则 App 的 useEffect 会在 window.api 就绪前调用 getConfig
async function start(): Promise<void> {
  await initDesktop();
  if (container) {
    createRoot(container).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  }
}

void start().catch((error: unknown) => {
  if (container) {
    container.innerHTML = `<pre style="padding:32px;color:#a52a2a;white-space:pre-wrap">启动失败：${String(error)}</pre>`;
  }
});
