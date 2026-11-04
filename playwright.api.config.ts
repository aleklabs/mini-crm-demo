import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/api',
  fullyParallel: false,
  workers: 1,
  projects: [{ name: 'api' }],
})
