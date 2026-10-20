import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  server: {
    port: 5173,
    // Tauri 的 devUrl 固定指向 5173，端口被占用时直接失败而不是悄悄换端口
    strictPort: true,
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'src/renderer/index.html'),
        overlay: resolve(__dirname, 'src/renderer/overlay.html'),
      },
    },
  },
});
