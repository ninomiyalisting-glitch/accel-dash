import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, requireAdmin } from '@/lib/supabaseAdmin'
import { getConnection, disconnect, mfConfigured, mfRedirectUri, MF_SCOPES } from '@/lib/mf'

export const dynamic = 'force-dynamic'

/** 接続状態と直近の同期ログ。トークンそのものは返さない */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status })
  try {
    const [c, runs] = await Promise.all([
      getConnection(),
      supabaseAdmin
        .from('mf_sync_runs')
        .select('id,started_at,finished_at,trigger,range_from,range_to,ok,summary,error')
        .order('started_at', { ascending: false })
        .limit(10),
    ])
    if (runs.error) throw new Error(runs.error.message)
    return NextResponse.json({
      configured: mfConfigured(),
      redirectUri: mfRedirectUri(),
      scopes: MF_SCOPES,
      connected: Boolean(c),
      connection: c
        ? { officeName: c.office_name, connectedBy: c.connected_by, scope: c.scope, updatedAt: c.updated_at, expiresAt: c.expires_at }
        : null,
      runs: runs.data ?? [],
      cronConfigured: Boolean(process.env.CRON_SECRET),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const hint = /relation .*mf_/.test(message) ? ' テーブルがまだありません。supabase/mf.sql を実行してください。' : ''
    return NextResponse.json({ error: message + hint }, { status: 500 })
  }
}

/** 接続を解除する（保存したトークンを消す） */
export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status })
  try {
    await disconnect()
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
