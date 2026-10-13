import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 300_000,
  expect: { timeout: 60_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 960, height: 600 },
    launchOptions: {
      // Software WebGL so the test runs on machines without a GPU.
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    command: 'npx vite --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
