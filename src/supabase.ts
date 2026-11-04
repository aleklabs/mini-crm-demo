import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types.ts'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    'VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set',
  )
}

export const supabase = createClient<Database>(
  supabaseUrl,
  supabasePublishableKey,
)
