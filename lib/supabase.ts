import { createClient } from '@supabase/supabase-js'
import { cookieStorage } from './cookieStorage'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    // .accel-dash.com の Cookie に保存し、サブドメイン間でログインを共有する
    storage: cookieStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
})
