import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../src/database.types.ts'

export interface LocalSupabaseConfig {
  apiUrl: string
  publishableKey: string
  secretKey: string
}

export type TestSupabaseClient = SupabaseClient<Database>

export function loadLocalSupabaseConfig(): LocalSupabaseConfig {
  const cliEntry = resolve('node_modules/supabase/dist/supabase.js')
  let output: string

  try {
    output = execFileSync(
      process.execPath,
      [cliEntry, 'status', '--output', 'json'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    )
  } catch {
    throw new Error('Unable to read the local Supabase status')
  }

  const status = JSON.parse(output) as Record<string, unknown>
  const apiUrl = status.API_URL
  const dbUrl = status.DB_URL
  const publishableKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY
  const secretKey = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY

  if (
    apiUrl !== 'http://127.0.0.1:54321' ||
    typeof dbUrl !== 'string' ||
    !dbUrl.includes('@127.0.0.1:54322/')
  ) {
    throw new Error('Tests are restricted to the local Supabase project')
  }

  if (typeof publishableKey !== 'string' || typeof secretKey !== 'string') {
    throw new Error('Local Supabase keys are unavailable')
  }

  return { apiUrl, publishableKey, secretKey }
}

export function createTestClient(
  url: string,
  key: string,
): TestSupabaseClient {
  return createClient<Database>(url, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })
}
