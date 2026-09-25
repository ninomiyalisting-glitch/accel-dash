import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { requireAdmin } from '@/lib/supabaseAdmin'
import { buildAuthorizeUrl, mfConfigured, mfRedirectUri } from '@/lib/mf'

export const dynamic = 'force-dynamic'

/**
 * マネーフォワードの認可画面へ進むための URL を返す。
 * 画面側は Authorization ヘッダー付きで呼び、返った url に移動する。
 * state はランダム値を httpOnly Cookie に入れ、コールバックで照合する（CSRF 対策）。
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status })
  if (!mfConfigured()) {
    return NextResponse.json(
      { error: 'MF_CLIENT_ID / MF_CLIENT_SECRET が Vercel の環境変数に入っていません' },
      { status: 500 }
    )
  }
  const state = randomBytes(24).toString('base64url')
  const res = NextResponse.json({ url: buildAuthorizeUrl(state), redirectUri: mfRedirectUri() })
  // 区切りは '|'（メールアドレスに '.' が含まれるため）
  res.cookies.set('mf_oauth_state', `${state}|${encodeURIComponent(auth.user.email)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/mf',
    maxAge: 600,
  })
  return res
}
