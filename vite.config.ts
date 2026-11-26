import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the same build works at any address
  // (GitHub Pages under /chartdesk/, a local file server, or the desktop app).
  base: './',
  // The desktop app (npm run desktop) opens this address: keep the port fixed, and keep
  // Tauri's own messages on screen.
  clearScreen: false,
  server: { port: 5173, strictPort: true },
});
