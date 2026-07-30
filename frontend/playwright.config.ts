import { defineConfig } from '@playwright/test';
import path from 'path';

export default defineConfig({
  testDir: path.resolve(__dirname, 'ui-testing'),
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:3000',
    viewport: { width: 1280, height: 900 },
  },
  reporter: [['list']],
});
