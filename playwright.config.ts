import { defineConfig, devices } from '@playwright/test'
import { loadLocalSupabaseConfig } from './tests/helpers/localSupabase.ts'

const localSupabase = loadLocalSupabaseConfig()

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5173 --strictPort',
    env: {
      VITE_SUPABASE_PUBLISHABLE_KEY: localSupabase.publishableKey,
      VITE_SUPABASE_URL: localSupabase.apiUrl,
    },
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
