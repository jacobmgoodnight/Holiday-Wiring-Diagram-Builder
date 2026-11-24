/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// One id per build: the app compares it with version.json to notice that a newer version
// has been published ("A new version is ready · Reload").
const BUILD_ID = (process.env.GITHUB_SHA ?? '').slice(0, 12) || new Date().toISOString();

// Relative base so the build works from any GitHub Pages path.
export default defineConfig({
  base: './',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [
    react(),
    {
      name: 'version-file',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) });
      },
    },
  ],
  build: { chunkSizeWarningLimit: 900 },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
