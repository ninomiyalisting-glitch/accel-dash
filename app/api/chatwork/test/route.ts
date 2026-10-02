import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, supabaseAdmin } from '@/lib/supabaseAdmin'
import { postChatwork } from '@/lib/receivables'

export const dynamic = 'force-dynamic'

/**
 * チャットワークのテスト送信。基幹システムの「未入金管理 → 設定」のボタンから呼ぶ。
 * 送り先は設定に保存されたルームIDだけ（任意のルームには送らせない）。社内ドメインの人だけ。
 */
const ORIGINS = ['https://crm.accel-dash.com', 'https://accel-dash.com']
function cors(req: NextRequest) {
  const o = req.headers.get('origin') || ''
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    Vary: 'Origin',
  }
}
export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cors(req) })
}
export async function POST(req: NextRequest) {
  const h = cors(req)
  const auth = await requireAdmin(req)
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status, headers: h })
  if (!process.env.CHATWORK_API_TOKEN) return NextResponse.json({ error: 'Vercel に CHATWORK_API_TOKEN が登録されていないか、登録後に再デプロイされていません' }, { status: 400, headers: h })
  const { data } = await supabaseAdmin.from('crm_docs').select('data').eq('collection', 'meta').eq('id', 'receivables').maybeSingle()
  const roomId = String((data?.data as { chatwork?: { roomId?: string } } | undefined)?.chatwork?.roomId || '').replace(/\D/g, '')
  if (!roomId) return NextResponse.json({ error: '未入金管理の設定にルームIDが入っていません' }, { status: 400, headers: h })
  try {
    const now = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ')
    await postChatwork(roomId, process.env.CHATWORK_API_TOKEN, `[info][title]【アクセルダッシュ】テスト送信[/title]アクセルダッシュからの通知のテストです（${now}・${auth.user.email}）。\nこのチャットに、入金のお知らせと毎月の未入金リマインドが届きます。[/info]`)
    return NextResponse.json({ ok: true, roomId }, { headers: h })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502, headers: h })
  }
}
