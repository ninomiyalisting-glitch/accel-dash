import { NextRequest, NextResponse } from 'next/server'
import { exchangeCode } from '@/lib/mf'
import { appUrl } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

/**
 * マネーフォワードの認可画面から戻ってくる先。
 * state を Cookie と照合し、認可コードをトークンに交換して保存したら /mf に戻す。
 * 結果はクエリ（?connected=1 または ?error=...）で画面に伝える。
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code') || ''
  const state = url.searchParams.get('state') || ''
  const mfError = url.searchParams.get('error') || ''
  const base = process.env.NODE_ENV === 'production' ? appUrl() : url.origin

  const back = (q: Record<string, string>) => {
    const res = NextResponse.redirect(`${base}/mf?${new URLSearchParams(q).toString()}`)
    res.cookies.set('mf_oauth_state', '', { path: '/api/mf', maxAge: 0 })
    return res
  }

  if (mfError) return back({ error: `マネーフォワード側で認可が完了しませんでした：${mfError}` })

  const cookie = req.cookies.get('mf_oauth_state')?.value || ''
  const [savedState, savedEmail] = cookie.split('|')
  if (!code || !state || !savedState || savedState !== state) {
    return back({ error: '認可の状態を確認できませんでした。もう一度「接続する」からやり直してください' })
  }

  try {
    await exchangeCode(code, decodeURIComponent(savedEmail || ''))
    return back({ connected: '1' })
  } catch (e) {
    return back({ error: e instanceof Error ? e.message : String(e) })
  }
}
