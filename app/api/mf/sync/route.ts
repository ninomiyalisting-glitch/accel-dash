import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/supabaseAdmin'
import { runSync, defaultRange } from '@/lib/mfSync'

export const dynamic = 'force-dynamic'
// 請求書 1,900 件＋仕訳を月ごとに取るので、初回の全期間同期は数分かかる
export const maxDuration = 300

function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

/**
 * Vercel Cron からの日次実行。
 * Cron は Authorization: Bearer <CRON_SECRET> を付けて GET してくる。
 * 既定の範囲（3 か月前の月初〜今日）を同期する。
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET || ''
  const header = req.headers.get('Authorization') || ''
  if (!secret || header !== `Bearer ${secret}`) return fail('認証できません', 401)
  try {
    const r = defaultRange()
    const summary = await runSync({ ...r, trigger: 'cron' })
    return NextResponse.json({ ok: true, summary })
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 500)
  }
}

/** 画面からの手動実行。{ from, to, invoices?, journals? } */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return fail(auth.message, auth.status)
  const body = (await req.json().catch(() => ({}))) as { from?: string; to?: string; invoices?: boolean; journals?: boolean }
  const r = defaultRange()
  try {
    const summary = await runSync({
      from: body.from || r.from,
      to: body.to || r.to,
      invoices: body.invoices,
      journals: body.journals,
      trigger: 'manual',
    })
    return NextResponse.json({ ok: true, summary })
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 500)
  }
}
