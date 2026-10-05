import { createClient } from '@supabase/supabase-js'

// サーバー専用。service_role キーを使うので絶対にクライアントへ import しないこと。
// 貼り付けで紛れ込んだ空白・改行は取り除く（キーの途中に空白があるとヘッダーに載せられず、全 API が失敗する）
const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim()
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').replace(/\s+/g, '')

export const supabaseAdmin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
})

export const ADMIN_DOMAIN = '@accel-partners.co.jp'

export type AuthResult =
  | { ok: true; user: { id: string; email: string } }
  | { ok: false; message: string; status: number }

/** Authorization ヘッダーの JWT を検証し、社内ドメインの管理者だけ通す */
export async function requireAdmin(req: Request): Promise<AuthResult> {
  if (!url || !serviceKey) {
    return {
      ok: false,
      status: 500,
      message: 'サーバー設定エラー：SUPABASE_SERVICE_ROLE_KEY が読み込めていません'
    }
  }

  const raw = req.headers.get('Authorization') || ''
  const token = raw.replace(/^Bearer\s+/i, '').trim()

  if (!token) {
    return { ok: false, status: 401, message: '認証トークンが送られていません（再ログインしてください）' }
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token)

  if (error) {
    // エラー文にキーの値が入ることがあるので、画面には出さない（サーバーのログにも値は残さない）
    const detail = (error.message || '').replace(/sb_secret_\S+|eyJ[\w.-]+/g, '［キー］')
    console.error('[auth] getUser failed:', detail)
    const status = (error as { status?: number }).status
    return status && status < 500
      ? { ok: false, status: 401, message: 'ログインの確認に失敗しました。再ログインしてください' }
      : { ok: false, status: 500, message: 'サーバー設定エラー：Supabase のキーを確認してください（Vercel の環境変数）' }
  }
  if (!data?.user?.email) {
    return { ok: false, status: 401, message: 'ユーザー情報を取得できませんでした' }
  }
  if (!data.user.email.endsWith(ADMIN_DOMAIN)) {
    return {
      ok: false,
      status: 403,
      message: `${data.user.email} は管理者ドメイン（${ADMIN_DOMAIN}）ではありません`
    }
  }

  return { ok: true, user: { id: data.user.id, email: data.user.email } }
}

export function appUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || 'https://accel-dash.com'
}
