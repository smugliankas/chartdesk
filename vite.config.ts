import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the same build works at any address
  // (GitHub Pages under /chartdesk/, a local file server, or a desktop app later).
  base: './',
});
