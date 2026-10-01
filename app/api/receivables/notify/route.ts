import { NextRequest, NextResponse } from 'next/server'
import { notifyReceivables } from '@/lib/receivables'

export const dynamic = 'force-dynamic'

/**
 * Vercel Cron（毎日 10:00 JST）。未入金管理のチャットワーク通知だけを送る。
 *  - 入金済みになった未入金のお知らせ（画面で「入金済みにする」を押したものも含む）
 *  - 毎月 N 営業日目の未入金リストのリマインド
 * 朝の MF 同期の最後にも同じ処理が動く。
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET || ''
  const header = req.headers.get('Authorization') || ''
  if (!secret || header !== `Bearer ${secret}`) return NextResponse.json({ error: '認証できません' }, { status: 401 })
  try {
    const r = await notifyReceivables()
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
