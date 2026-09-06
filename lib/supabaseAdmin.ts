import { createClient } from '@supabase/supabase-js'

// サーバー専用。service_role キーを使うので絶対にクライアントへ import しないこと。
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

export const ADMIN_DOMAIN = '@accel-partners.co.jp'

/** Authorization ヘッダーの JWT を検証し、社内ドメインの管理者だけ通す */
export async function requireAdmin(req: Request) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return null

  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data?.user) return null
  if (!data.user.email?.endsWith(ADMIN_DOMAIN)) return null

  return data.user
}

export function appUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || 'https://accel-dash.com'
}
