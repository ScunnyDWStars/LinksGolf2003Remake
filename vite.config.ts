import { defineConfig } from 'vite';

// GITHUB_PAGES_BASE is set by the Pages workflow so assets resolve under /<repo>/.
export default defineConfig({
  base: process.env.GITHUB_PAGES_BASE ?? '/',
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  test: { include: ['tests/**/*.test.ts'] },
});
