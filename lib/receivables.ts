/**
 * 未入金管理（サーバー専用）。MF 同期のあとに動かす。
 *
 *  crm_docs collection "receivables"  … 未入金 1 件 = 1 doc（基幹システムの「未入金管理」が読む）
 *  crm_docs meta/receivables          … 設定（自動登録を始める入金期限・待つ営業日数・チャットワーク）
 *
 *  1) 自動登録：入金期限（設定日以降）から N 営業日たっても MF で入金済みにならない請求書を「未入金」に入れる
 *  2) 自動消込：MF 側で入金済みになったら「入金済み」に移す（画面で「未入金に戻す」にしたものは触らない）
 *  3) 入金の候補：会計の仕訳から、請求金額（税込）とまったく同じ金額の入金を探して候補として付ける
 *     （社名の表記ゆれや個人名での振込があるので、決めるのは人。画面で「この入金で消し込む」を押す）
 *  4) チャットワーク：入金されたら知らせる／毎月 N 営業日目に未入金リストを送る（notifyReceivables）
 *
 * 画面で手入力した項目（メモ・入金予定・担当者など）は上書きしない。
 */
import { supabaseAdmin } from './supabaseAdmin'

interface DocRow {
  collection: string
  id: string
  data: Record<string, unknown>
}
interface Candidate {
  d: string
  amount: number
  memo: string
  partner: string
  account: string
  score: number
}
interface Recv {
  id: string
  source: 'mf' | 'manual'
  status: 'open' | 'paid' | 'cancelled'
  invoiceId?: string
  revenueId?: string
  customerId?: string
  individualId?: string
  name?: string
  partner?: string
  title?: string
  number?: string
  kind?: string
  item?: string
  amount: number
  ownerName?: string
  billingDate?: string
  dueDate?: string
  expectedDate?: string
  memo?: string
  mfPayment?: string
  paidAt?: string
  paidBy?: string
  notifyPaid?: boolean
  notifiedPaidAt?: string
  keepOpen?: boolean
  candidates?: Candidate[]
  dismissed?: string[]
  deposit?: Candidate
  openedAt?: string
  createdAt?: string
  updatedAt?: string
}
interface Settings {
  autoFrom?: string
  graceDays?: number
  chatwork?: { enabled?: boolean; roomId?: string; remindDay?: number; lastRemind?: string }
}

const PAID_RE = /入金済|振込済|消込済/
const BANK_RE = /預金|銀行|UFJ|ＵＦＪ|信金|信用金庫|信組|ゆうちょ|郵便|PayPay|ペイペイ|楽天|住信|みずほ|三井住友|りそな|現金|口座|Bank/i
const CHUNK = 200
const CRM_URL = 'https://crm.accel-dash.com/#/receivables'

/* ---------- 日付（日本時間） ---------- */
export function jstToday(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10)
}
function normDate(v: unknown) {
  const m = String(v ?? '').trim().match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/)
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : ''
}
function dayOf(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}
function isoOf(d: Date) {
  return d.toISOString().slice(0, 10)
}
/** 土日を除いて n 営業日後（祝日は数える） */
export function addBusinessDays(iso: string, n: number) {
  const d = dayOf(iso)
  let left = n
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1)
    const w = d.getUTCDay()
    if (w !== 0 && w !== 6) left--
  }
  return isoOf(d)
}
/** その月の n 営業日目（土日を除く） */
export function nthBusinessDay(ym: string, n: number) {
  const [y, m] = ym.split('-').map(Number)
  let c = 0
  for (let day = 1; day <= 31; day++) {
    const d = new Date(Date.UTC(y, m - 1, day))
    if (d.getUTCMonth() !== m - 1) break
    const w = d.getUTCDay()
    if (w !== 0 && w !== 6 && ++c === n) return isoOf(d)
  }
  return ''
}
function ymAdd(ym: string, k: number) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + k, 1))
  return d.toISOString().slice(0, 7)
}

/* ---------- 名前の照合（候補の並べ替え用） ---------- */
function kana(s: string) {
  // ひらがな → カタカナ、全角半角をそろえる、記号と法人格を外す
  return String(s || '')
    .normalize('NFKC')
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/株式会社|有限会社|合同会社|一般社団法人|\(株\)|\(有\)|（株）|（有）|カ\)|\(カ|ユ\)|\(ユ|ド\)|\(ド|様|御中/g, '')
    .replace(/振込|フリコミ|[\s　\-ー・.,()（）]/g, '')
    .toUpperCase()
}
function lcs(a: string, b: string) {
  if (!a || !b) return 0
  let best = 0
  let prev = new Array(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1).fill(0)
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1
        if (cur[j] > best) best = cur[j]
      }
    }
    prev = cur
  }
  return best
}

/* ---------- DB ---------- */
async function loadAll(table: 'crm_docs' | 'finance_docs', collection: string, opt: { idPrefix?: string; idFrom?: string; idTo?: string } = {}) {
  const out: DocRow[] = []
  let from = 0
  for (;;) {
    let q = supabaseAdmin.from(table).select('collection,id,data').eq('collection', collection).range(from, from + 999)
    if (opt.idPrefix) q = q.like('id', `${opt.idPrefix}%`)
    if (opt.idFrom) q = q.gte('id', opt.idFrom)
    if (opt.idTo) q = q.lte('id', opt.idTo)
    const { data, error } = await q
    if (error) throw new Error(`${table}/${collection} の読み込みに失敗：${error.message}`)
    out.push(...((data ?? []) as DocRow[]))
    if (!data || data.length < 1000) break
    from += 1000
  }
  return out
}
async function loadMeta<T>(id: string): Promise<T | null> {
  const { data, error } = await supabaseAdmin.from('crm_docs').select('data').eq('collection', 'meta').eq('id', id).maybeSingle()
  if (error) throw new Error(`meta/${id} の読み込みに失敗：${error.message}`)
  return (data?.data as T | undefined) ?? null
}
async function saveRecvs(list: Recv[]) {
  const now = new Date().toISOString()
  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = list.slice(i, i + CHUNK).map((r) => ({ collection: 'receivables', id: r.id, data: { ...r, updatedAt: now }, updated_at: now }))
    const { error } = await supabaseAdmin.from('crm_docs').upsert(chunk, { onConflict: 'collection,id' })
    if (error) throw new Error(`未入金の書き込みに失敗：${error.message}`)
  }
}
async function saveSettings(st: Settings) {
  const { error } = await supabaseAdmin
    .from('crm_docs')
    .upsert({ collection: 'meta', id: 'receivables', data: st, updated_at: new Date().toISOString() }, { onConflict: 'collection,id' })
  if (error) throw new Error(`未入金の設定の書き込みに失敗：${error.message}`)
}

/* =========================================================================
   1)〜3) 同期
   ========================================================================= */
export interface RecvSummary {
  created: number
  paid: number
  updated: number
  withCandidates: number
}
export async function syncReceivables(now = new Date()): Promise<RecvSummary> {
  const today = jstToday(now)
  const st = (await loadMeta<Settings>('receivables')) ?? {}
  const autoFrom = normDate(st.autoFrom) || '2026-09-01'
  const grace = Number.isFinite(Number(st.graceDays)) ? Math.max(0, Math.min(30, Number(st.graceDays))) : 3

  const [revRows, recRows, custRows, indRows, master] = await Promise.all([
    loadAll('crm_docs', 'revenues', { idPrefix: 'mf-inv-' }),
    loadAll('crm_docs', 'receivables'),
    loadAll('crm_docs', 'customers'),
    loadAll('crm_docs', 'individuals'),
    loadMeta<{ owners?: { id: string; name: string }[]; externals?: { id: string; name: string }[] }>('master'),
  ])
  const custs = new Map(custRows.map((r) => [r.id, r.data as { name?: string; kana?: string }]))
  const inds = new Map(indRows.map((r) => [r.id, r.data as { name?: string }]))
  const ownerName = new Map((master?.owners ?? []).map((o) => [o.id, o.name]))
  const recs = new Map(recRows.map((r) => [r.id, { ...(r.data as unknown as Recv), id: r.id }]))
  const changed = new Map<string, Recv>()
  const sum: RecvSummary = { created: 0, paid: 0, updated: 0, withCandidates: 0 }

  for (const row of revRows) {
    const r = row.data as { customerId?: string; individualId?: string; ownerId?: string; note?: string; mf?: Record<string, unknown> }
    const mf = r.mf ?? {}
    const due = normDate(mf.dueDate)
    if (!due || due < autoFrom) continue
    const payment = String(mf.payment ?? '')
    const paid = PAID_RE.test(payment)
    const id = `mf-${String(mf.id ?? row.id.replace(/^mf-inv-/, ''))}`
    const c = r.customerId ? custs.get(r.customerId) : undefined
    const ind = r.individualId ? inds.get(r.individualId) : undefined
    const name = c?.name || (ind?.name ? `${ind.name}` : '') || String(mf.partner ?? '') || '（取引先なし）'
    const amount = Math.round(Number(mf.total) || 0)
    const own = (r.ownerId && r.ownerId !== 'o-ext' && ownerName.get(r.ownerId)) || String(mf.member ?? '')
    const prev = recs.get(id)
    if (!prev) {
      if (paid) continue
      if (today <= addBusinessDays(due, grace)) continue // まだ待つ
      const rec: Recv = {
        id, source: 'mf', status: 'open', invoiceId: String(mf.id ?? ''), revenueId: row.id,
        customerId: r.customerId || '', individualId: r.individualId || '', name, partner: String(mf.partner ?? ''),
        title: String(mf.title ?? r.note ?? ''), number: String(mf.number ?? ''), kind: '', item: String(mf.title ?? r.note ?? ''),
        amount, ownerName: own, billingDate: normDate(mf.billingDate), dueDate: due, expectedDate: '', memo: '',
        mfPayment: payment, openedAt: today, createdAt: new Date().toISOString(),
      }
      recs.set(id, rec)
      changed.set(id, rec)
      sum.created++
      continue
    }
    if (prev.source !== 'mf') continue
    const next: Recv = { ...prev, amount, customerId: r.customerId || prev.customerId || '', individualId: r.individualId || prev.individualId || '',
      partner: String(mf.partner ?? ''), title: String(mf.title ?? r.note ?? ''), number: String(mf.number ?? ''), mfPayment: payment, dueDate: due }
    if (!prev.name) next.name = name
    if (prev.status === 'open' && paid && !prev.keepOpen) {
      Object.assign(next, { status: 'paid', paidAt: today, paidBy: 'mf', notifyPaid: true })
      sum.paid++
    }
    const keys: (keyof Recv)[] = ['amount', 'customerId', 'individualId', 'partner', 'title', 'number', 'mfPayment', 'dueDate', 'status', 'name']
    if (keys.some((k) => next[k] !== prev[k])) {
      recs.set(id, next)
      changed.set(id, next)
      if (next.status === prev.status) sum.updated++
    }
  }

  /* ---- 3) 入金の候補 ---- */
  const open = [...recs.values()].filter((r) => r.status === 'open' && Number(r.amount) > 0)
  if (open.length) {
    const thisYm = today.slice(0, 7)
    const oldest = open.map((r) => (r.billingDate || r.dueDate || today).slice(0, 7)).sort()[0]
    const fromYm = oldest < ymAdd(thisYm, -36) ? ymAdd(thisYm, -36) : ymAdd(oldest, -1)
    const jdocs = await loadAll('finance_docs', 'journal', { idFrom: fromYm, idTo: thisYm })
    type Dep = Candidate & { key: string }
    const byAmount = new Map<number, Dep[]>()
    for (const doc of jdocs) {
      const rows = ((doc.data as { rows?: Record<string, unknown>[] }).rows ?? [])
      for (const x of rows) {
        const ca = String(x.ca ?? ''), da = String(x.da ?? '')
        // 入金＝借方が預金・現金で、貸方が売掛金（または売上）。振込手数料など（借方が費用）は入金ではない
        if (!(ca === '売掛金' || /売上/.test(ca)) || !BANK_RE.test(da)) continue
        const amt = Math.round(Number(x.cam) || 0)
        if (amt <= 0) continue
        const d = normDate(x.d)
        const dep: Dep = { d, amount: amt, memo: String(x.memo ?? '').trim(), partner: [String(x.csub ?? ''), String(x.partner ?? '')].filter(Boolean).join('・'), account: da, score: 0, key: '' }
        dep.key = [dep.d, dep.amount, dep.memo].join('|')
        const list = byAmount.get(amt) ?? []
        list.push(dep)
        byAmount.set(amt, list)
      }
    }
    // すでに別の未入金の消し込みに使った入金は候補にしない
    const used = new Set([...recs.values()].filter((r) => r.deposit).map((r) => [r.deposit!.d, r.deposit!.amount, r.deposit!.memo || ''].join('|')))
    for (const r of open) {
      const amt = Math.round(Number(r.amount))
      const base = r.billingDate || (r.dueDate ? isoOf(new Date(dayOf(r.dueDate).getTime() - 60 * 86400000)) : '')
      const from = base ? isoOf(new Date(dayOf(base).getTime() - 7 * 86400000)) : ''
      const dismissed = new Set(r.dismissed ?? [])
      const c = r.customerId ? custs.get(r.customerId) : undefined
      const names = [r.name, r.partner, c?.name, c?.kana].filter(Boolean).map((t) => kana(String(t)))
      const due = r.dueDate || r.billingDate || today
      const list = (byAmount.get(amt) ?? [])
        .filter((x) => (!from || x.d >= from) && !used.has(x.key) && !dismissed.has(x.key))
        .map((x) => {
          const t = kana(x.memo + x.partner)
          const score = Math.max(0, ...names.map((n) => lcs(n, t)))
          return { ...x, score }
        })
        .sort((a, b) => b.score - a.score || Math.abs(dayOf(a.d).getTime() - dayOf(due).getTime()) - Math.abs(dayOf(b.d).getTime() - dayOf(due).getTime()))
        .slice(0, 3)
        .map(({ key: _k, ...x }) => x)
      if (list.length) sum.withCandidates++
      if (JSON.stringify(list) !== JSON.stringify(r.candidates ?? [])) {
        const next = { ...r, candidates: list }
        recs.set(r.id, next)
        changed.set(r.id, next)
      }
    }
  }

  if (changed.size) await saveRecvs([...changed.values()])
  return sum
}

/* =========================================================================
   4) チャットワーク
   ========================================================================= */
const yen = (v: number) => `${Math.round(v).toLocaleString('ja-JP')}円`
const md = (iso?: string) => (iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : '—')
const honor = (n?: string) => (n && !/(様|御中|殿|さん|氏)$/.test(n) ? `${n}様` : n || '（名前なし）')

async function postChatwork(roomId: string, token: string, body: string) {
  const res = await fetch(`https://api.chatwork.com/v2/rooms/${encodeURIComponent(roomId)}/messages`, {
    method: 'POST',
    headers: { 'X-ChatWorkToken': token, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ body }).toString(),
  })
  if (!res.ok) throw new Error(`チャットワークへの送信に失敗しました（${res.status}）：${(await res.text()).slice(0, 200)}`)
}

export function reminderText(list: Recv[], today: string, day: number) {
  const open = list.filter((r) => r.status === 'open').sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')))
  const total = open.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const late = open.filter((r) => r.dueDate && r.dueDate < today)
  const lines = open.slice(0, 60).map((r) => {
    const over = r.dueDate && r.dueDate < today ? Math.floor((dayOf(today).getTime() - dayOf(r.dueDate).getTime()) / 86400000) : 0
    return `・${honor(r.name)}　${yen(Number(r.amount) || 0)}　期限 ${md(r.dueDate)}${over ? `（${over}日超過）` : ''}${r.ownerName ? `　担当：${r.ownerName}` : ''}${r.kind || r.item ? `　${[r.kind, r.item].filter(Boolean).join('・')}` : ''}`
  })
  const more = open.length > 60 ? `\n…ほか ${open.length - 60} 件` : ''
  return `[info][title]未入金のリマインド（${Number(today.slice(5, 7))}月・${day}営業日目）[/title]` +
    `未入金 ${open.length} 件・合計 ${yen(total)}（うち入金期限を過ぎたもの ${late.length} 件）\n` +
    `担当の方は状況の確認と、必要ならお客様へのご連絡をお願いします。\n\n${lines.join('\n')}${more}\n\n一覧：${CRM_URL}[/info]`
}
export function paidText(list: Recv[]) {
  const lines = list.map((r) => `・${honor(r.name)}　${yen(Number(r.amount) || 0)}　入金 ${md(r.paidAt)}${r.ownerName ? `　担当：${r.ownerName}` : ''}${r.kind || r.item ? `　${[r.kind, r.item].filter(Boolean).join('・')}` : ''}`)
  return `[info][title]入金されました（未入金リストから ${list.length} 件）[/title]${lines.join('\n')}\n\n一覧：${CRM_URL}[/info]`
}

export async function notifyReceivables(now = new Date()) {
  const st = (await loadMeta<Settings>('receivables')) ?? {}
  const cw = st.chatwork ?? {}
  const token = process.env.CHATWORK_API_TOKEN || ''
  const roomId = String(cw.roomId || '').replace(/\D/g, '')
  if (!cw.enabled || !roomId || !token) return { skipped: true, reason: !token ? 'CHATWORK_API_TOKEN が未設定' : !roomId ? 'ルームID が未設定' : '通知がオフ' }
  const today = jstToday(now)
  const recs = (await loadAll('crm_docs', 'receivables')).map((r) => ({ ...(r.data as unknown as Recv), id: r.id }))
  const out = { paidSent: 0, remind: false }

  // 入金のお知らせ（14日より前に入金済みになったものは知らせずに印だけ消す）
  const pending = recs.filter((r) => r.status === 'paid' && r.notifyPaid)
  if (pending.length) {
    const limit = isoOf(new Date(dayOf(today).getTime() - 14 * 86400000))
    const fresh = pending.filter((r) => (r.paidAt || today) >= limit)
    if (fresh.length) await postChatwork(roomId, token, paidText(fresh))
    out.paidSent = fresh.length
    await saveRecvs(pending.map((r) => ({ ...r, notifyPaid: false, notifiedPaidAt: today })))
  }
  // 毎月 N 営業日目のリマインド
  const ym = today.slice(0, 7)
  const day = Math.max(1, Math.min(15, Number(cw.remindDay) || 5))
  if (nthBusinessDay(ym, day) === today && cw.lastRemind !== ym) {
    await postChatwork(roomId, token, reminderText(recs, today, day))
    await saveSettings({ ...st, chatwork: { ...cw, lastRemind: ym } })
    out.remind = true
  }
  return out
}
