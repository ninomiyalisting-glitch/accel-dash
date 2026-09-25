'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { ArrowLeft, Link2, RefreshCw, Unplug, CheckCircle2, AlertTriangle, Clock } from 'lucide-react'

/**
 * マネーフォワード クラウド連携の管理画面。
 *
 *  - 接続：MF の認可画面へ飛び、戻ってきたらトークンをサーバー側に保存する
 *  - 同期：クラウド請求書 → CRM の売上、クラウド会計 → 財務管理の仕訳
 *  - 日次の自動同期は Vercel Cron（vercel.json）。ここでは手動で範囲を指定して流せる
 *
 * トークンや Secret はこの画面に一切出さない。表示するのは接続の有無と同期の記録だけ。
 */

const STAFF_DOMAIN = '@accel-partners.co.jp'

interface Status {
  configured: boolean
  redirectUri: string
  scopes: string[]
  connected: boolean
  connection: { officeName: string; connectedBy: string; scope: string; updatedAt: string; expiresAt: string } | null
  runs: Run[]
  cronConfigured: boolean
}
interface Run {
  id: number
  started_at: string
  finished_at: string | null
  trigger: string
  range_from: string | null
  range_to: string | null
  ok: boolean | null
  summary: Summary | null
  error: string | null
}
interface Summary {
  range?: { from: string; to: string }
  invoices?: { fetched: number; upserted: number; deleted: number; unmatched: number; unmatchedPartners: string[] }
  journals?: { months: Record<string, number>; journalsTotal: number }
  warnings?: string[]
}

function ym(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function fmtDt(s: string | null) {
  if (!s) return ''
  const d = new Date(s)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function MfPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [isStaff, setIsStaff] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'ng'; text: string } | null>(null)
  const [busy, setBusy] = useState<'' | 'connect' | 'sync' | 'disconnect'>('')
  const [result, setResult] = useState<Summary | null>(null)

  const today = new Date()
  const [fromM, setFromM] = useState(ym(new Date(today.getFullYear(), today.getMonth() - 3, 1)))
  const [toM, setToM] = useState(ym(today))
  const [doInvoices, setDoInvoices] = useState(true)
  const [doJournals, setDoJournals] = useState(true)

  async function authHeaders(): Promise<Record<string, string>> {
    const { data } = await supabase.auth.getSession()
    return { Authorization: `Bearer ${data.session?.access_token ?? ''}`, 'Content-Type': 'application/json' }
  }

  async function loadStatus() {
    const res = await fetch('/api/mf/status', { headers: await authHeaders(), cache: 'no-store' })
    const j = await res.json()
    if (!res.ok) {
      setNotice({ kind: 'ng', text: j.error || '状態を取得できませんでした' })
      return
    }
    setStatus(j as Status)
  }

  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getSession()
      if (!data.session) {
        router.push('/login?next=' + encodeURIComponent(`${window.location.origin}/mf`))
        return
      }
      const mail = data.session.user.email ?? ''
      setEmail(mail)
      const staff = mail.endsWith(STAFF_DOMAIN)
      setIsStaff(staff)
      if (staff) await loadStatus()
      setLoading(false)
      // コールバックからの戻り（?connected=1 / ?error=...）。useSearchParams は Suspense が要るので直接読む
      const params = new URLSearchParams(window.location.search)
      if (params.get('connected')) setNotice({ kind: 'ok', text: 'マネーフォワードと接続しました。下の「今すぐ同期」で取り込みを始められます。' })
      const err = params.get('error')
      if (err) setNotice({ kind: 'ng', text: err })
      if (params.toString()) window.history.replaceState(null, '', '/mf')
    }
    void init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function connect() {
    setBusy('connect')
    try {
      const res = await fetch('/api/mf/connect', { headers: await authHeaders() })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || '接続を開始できませんでした')
      window.location.href = j.url
    } catch (e) {
      setNotice({ kind: 'ng', text: e instanceof Error ? e.message : String(e) })
      setBusy('')
    }
  }

  async function disconnect() {
    if (!window.confirm('マネーフォワードとの接続を解除します。自動同期は止まります。取り込み済みのデータはそのまま残ります。よろしいですか？')) return
    setBusy('disconnect')
    try {
      const res = await fetch('/api/mf/status', { method: 'DELETE', headers: await authHeaders() })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error)
      setNotice({ kind: 'ok', text: '接続を解除しました' })
      await loadStatus()
    } catch (e) {
      setNotice({ kind: 'ng', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy('')
    }
  }

  async function sync() {
    setBusy('sync')
    setResult(null)
    setNotice(null)
    try {
      const from = `${fromM}-01`
      const [y, m] = toM.split('-').map(Number)
      const to = new Date(y, m, 0)
      const toS = `${toM}-${String(to.getDate()).padStart(2, '0')}`
      const res = await fetch('/api/mf/sync', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ from, to: toS, invoices: doInvoices, journals: doJournals }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || '同期に失敗しました')
      setResult(j.summary as Summary)
      setNotice({ kind: 'ok', text: '同期が終わりました' })
      await loadStatus()
    } catch (e) {
      setNotice({ kind: 'ng', text: e instanceof Error ? e.message : String(e) })
      await loadStatus()
    } finally {
      setBusy('')
    }
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-black/50">読み込み中…</div>
  }

  const c = status?.connection

  return (
    <div className="min-h-screen bg-surface-muted">
      <header className="border-b border-border-soft bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-1.5 text-sm text-black/60 hover:text-black">
              <ArrowLeft size={16} /> ポータル
            </Link>
            <img src="/logo.png" alt="ACCEL DASH" className="h-9 w-auto" />
            <span className="hidden text-lg font-bold text-black sm:inline">マネーフォワード連携</span>
          </div>
          {email && <span className="text-sm text-black/70">{email}</span>}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {notice && (
          <div
            className={
              notice.kind === 'ok'
                ? 'mb-6 rounded-lg bg-accel-lightest px-5 py-3 text-sm text-black'
                : 'mb-6 rounded-lg bg-red-50 px-5 py-3 text-sm text-red-800'
            }
          >
            {notice.text}
          </div>
        )}

        {!isStaff ? (
          <div className="rounded-xl border border-border-soft bg-surface p-10 text-center text-black/70">このページは社内メンバー専用です。</div>
        ) : !status ? null : (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold text-black">マネーフォワード クラウド連携</h1>
              <p className="mt-1 text-sm text-black/60">
                クラウド請求書の請求書を CRM の売上に、クラウド会計の仕訳を財務管理に取り込みます。毎日自動で直近 3 か月分を更新し、ここから手動で任意の期間を流し直せます。
              </p>
            </div>

            {/* 接続 */}
            <section className="rounded-xl border border-border-soft bg-surface p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="flex items-center gap-2 text-lg font-bold text-black">
                    <Link2 size={18} /> 接続
                  </h2>
                  {!status.configured ? (
                    <p className="mt-2 text-sm text-red-700">
                      Vercel の環境変数 <code>MF_CLIENT_ID</code> と <code>MF_CLIENT_SECRET</code> が未設定です。設定して再デプロイしてください。
                    </p>
                  ) : status.connected && c ? (
                    <div className="mt-2 text-sm text-black/80">
                      <p className="flex items-center gap-1.5 font-semibold text-emerald-700">
                        <CheckCircle2 size={16} /> 接続中{c.officeName ? `：${c.officeName}` : ''}
                      </p>
                      <p className="mt-1 text-black/60">
                        {c.connectedBy && <>認可した人：{c.connectedBy}　</>}最終更新：{fmtDt(c.updatedAt)}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-black/70">
                      まだ接続していません。「接続する」を押すとマネーフォワードの認可画面が開きます。アプリ連携の権限を持つアカウントでログインして「許可」してください。
                    </p>
                  )}
                  <p className="mt-2 text-xs text-black/50">
                    権限：{status.scopes.join(' / ')}（すべて読み取りのみ）　リダイレクト先：{status.redirectUri}
                  </p>
                </div>
                <div className="flex gap-2">
                  {status.connected && (
                    <button
                      onClick={disconnect}
                      disabled={busy !== ''}
                      className="flex items-center gap-1.5 rounded-lg border-2 border-border-soft bg-surface px-3.5 py-2 text-sm font-semibold text-black hover:border-red-300 disabled:opacity-60"
                    >
                      <Unplug size={16} /> 解除
                    </button>
                  )}
                  <button
                    onClick={connect}
                    disabled={busy !== '' || !status.configured}
                    className="flex items-center gap-1.5 rounded-lg bg-accel-primary px-4 py-2 text-sm font-bold text-white hover:bg-accel-hover disabled:opacity-60"
                  >
                    <Link2 size={16} /> {status.connected ? '再接続する' : '接続する'}
                  </button>
                </div>
              </div>
            </section>

            {/* 同期 */}
            <section className="rounded-xl border border-border-soft bg-surface p-6">
              <h2 className="flex items-center gap-2 text-lg font-bold text-black">
                <RefreshCw size={18} /> 同期
              </h2>
              <p className="mt-1 text-sm text-black/60">
                対象期間の内容をマネーフォワードの現在の状態で置き換えます。CRM で手入力した売上と、財務管理で確定した勘定科目の区分はそのまま残ります。
              </p>
              <div className="mt-4 flex flex-wrap items-end gap-4">
                <label className="text-sm">
                  <span className="block text-xs text-black/60">開始月</span>
                  <input type="month" value={fromM} onChange={(e) => setFromM(e.target.value)} className="mt-1 rounded-lg border-2 border-border-soft px-3 py-2" />
                </label>
                <label className="text-sm">
                  <span className="block text-xs text-black/60">終了月</span>
                  <input type="month" value={toM} onChange={(e) => setToM(e.target.value)} className="mt-1 rounded-lg border-2 border-border-soft px-3 py-2" />
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={doInvoices} onChange={(e) => setDoInvoices(e.target.checked)} /> 請求書 → CRM 売上
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={doJournals} onChange={(e) => setDoJournals(e.target.checked)} /> 会計の仕訳 → 財務管理
                </label>
                <button
                  onClick={sync}
                  disabled={busy !== '' || !status.connected || (!doInvoices && !doJournals)}
                  className="flex items-center gap-1.5 rounded-lg bg-accel-primary px-4 py-2 text-sm font-bold text-white hover:bg-accel-hover disabled:opacity-60"
                >
                  <RefreshCw size={16} className={busy === 'sync' ? 'animate-spin' : ''} /> {busy === 'sync' ? '同期中…（数分かかることがあります）' : '今すぐ同期'}
                </button>
              </div>
              <p className="mt-3 text-xs text-black/50">
                自動同期：{status.cronConfigured ? '毎日 6:00 頃に直近 3 か月分を更新' : 'CRON_SECRET が未設定のため止まっています'}
              </p>

              {result && <ResultView s={result} />}
            </section>

            {/* 履歴 */}
            <section className="rounded-xl border border-border-soft bg-surface p-6">
              <h2 className="flex items-center gap-2 text-lg font-bold text-black">
                <Clock size={18} /> 同期の記録
              </h2>
              {status.runs.length === 0 ? (
                <p className="mt-2 text-sm text-black/50">まだ同期していません。</p>
              ) : (
                <table className="mt-3 w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-black/50">
                      <th className="py-1 pr-3">開始</th>
                      <th className="py-1 pr-3">種類</th>
                      <th className="py-1 pr-3">期間</th>
                      <th className="py-1 pr-3">結果</th>
                      <th className="py-1">内容</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.runs.map((r) => (
                      <tr key={r.id} className="border-t border-border-soft align-top">
                        <td className="py-2 pr-3 whitespace-nowrap">{fmtDt(r.started_at)}</td>
                        <td className="py-2 pr-3">{r.trigger === 'cron' ? '自動' : '手動'}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {r.range_from} 〜 {r.range_to}
                        </td>
                        <td className="py-2 pr-3">
                          {r.ok === true ? (
                            <span className="text-emerald-700">成功</span>
                          ) : r.ok === false ? (
                            <span className="text-red-700">失敗</span>
                          ) : (
                            <span className="text-black/50">実行中</span>
                          )}
                        </td>
                        <td className="py-2 text-black/70">
                          {r.error ? (
                            <span className="text-red-700">{r.error}</span>
                          ) : r.summary?.invoices || r.summary?.journals ? (
                            <>
                              {r.summary.invoices && <>請求書 {r.summary.invoices.fetched} 件（未紐付け {r.summary.invoices.unmatched} 社）　</>}
                              {r.summary.journals && <>仕訳 {r.summary.journals.journalsTotal} 件 / {Object.keys(r.summary.journals.months).length} か月</>}
                            </>
                          ) : (
                            ''
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="rounded-xl border border-border-soft bg-surface p-6 text-sm text-black/70">
              <h2 className="text-base font-bold text-black">取り込んだあとにやること</h2>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>
                  CRM の「売上管理 → 明細・内訳」で、請求書の取引先と CRM の顧客を紐づける（一度紐づければ次回から自動）
                </li>
                <li>財務管理の「勘定科目」で、新しく現れた科目の区分（売上／原価／販管費…）と事業名を確認する</li>
                <li>給与は、クラウド給与で月を確定 → クラウド会計の「給与から入力」で登録 → ここで同期、の順で財務管理に載る</li>
              </ol>
            </section>
          </div>
        )}
      </main>
    </div>
  )
}

function ResultView({ s }: { s: Summary }) {
  const inv = s.invoices
  const jn = s.journals
  return (
    <div className="mt-4 rounded-lg bg-surface-muted p-4 text-sm">
      {inv && (
        <p>
          請求書：{inv.fetched} 件を取得、{inv.upserted} 件を CRM に反映、{inv.deleted} 件を削除。
          {inv.unmatched > 0 ? (
            <>
              　<span className="font-semibold text-amber-700">未紐付けの取引先 {inv.unmatched} 社</span>
              {inv.unmatchedPartners.length > 0 && <span className="text-black/60">（{inv.unmatchedPartners.slice(0, 8).join('、')}{inv.unmatchedPartners.length > 8 ? ' …' : ''}）</span>}
            </>
          ) : (
            '　取引先はすべて顧客に紐づいています。'
          )}
        </p>
      )}
      {jn && (
        <p className="mt-1">
          仕訳：{jn.journalsTotal} 件。月別の行数 —{' '}
          {Object.entries(jn.months)
            .map(([m, n]) => `${m}: ${n}`)
            .join('、')}
        </p>
      )}
      {s.warnings && s.warnings.length > 0 && (
        <ul className="mt-2 space-y-1 text-amber-800">
          {s.warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
