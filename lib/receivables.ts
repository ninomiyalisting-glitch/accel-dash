/**
 * 未入金管理（サーバー専用）。MF 同期のあとに動かす。
 *
 *  crm_docs collection "receivables"  … 未入金 1 件 = 1 doc（基幹システムの「未入金管理」が読む）
 *  crm_docs meta/receivables          … 設定（自動登録を始める入金期限・待つ営業日数・チャットワーク）
 *
 *  1) 自動登録：入金期限（設定日以降）から N 営業日たっても MF で入金済みにならない請求書を「未入金」に入れる
 *  2) 自動消込：MF 側で入金済みになったら「入金済み」に移す（画面で「未入金に戻す」にしたものは触らない）
 *  2') 銀行の入金と自動で照合：会計の仕訳（借方＝預金、貸方＝売掛金・売上）から、請求金額（未入金額）と
 *     まったく同じ金額の入金を探し、次のどちらかなら人を待たずに入金済みにする（MF での消込は要らない）
 *       ・名前が合う入金がちょうど 1 件（取引先名、または以前その会社の入金だった振込名義）
 *       ・金額が 1 対 1（その金額の入金がその請求にしか当てはまらず、その請求にも 1 件だけ）
 *     期限内に入金があったものは未入金リストに入れず、入金済みに「期限内」として記録だけ残す
 *     銀行の明細が会計（仕訳）にまだ入っていない日の分は、入金されていても見えないので、入るまで未入金にしない
 *  3) 入金の候補：自動で決めきれないものは、同じ金額の入金を候補として付ける（決めるのは人）
 *  4) チャットワーク：入金されたら知らせる／毎月 N 営業日目に未入金リストを送る（notifyReceivables）
 *
 * 画面で手入力した項目（メモ・入金予定・担当者など）は上書きしない。
 */
import { createHash } from 'crypto'
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
  source: 'mf' | 'manual' | 'deposit'
  /** nobill＝請求書のない入金（銀行に入金があったのに、同じ金額の請求書が見つからない） */
  status: 'open' | 'paid' | 'cancelled' | 'nobill'
  payer?: string
  checked?: boolean
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
  /** 自動照合の根拠：name＝名前（または以前の振込名義）、amount＝金額が 1 対 1 */
  matchedBy?: 'name' | 'amount'
  /** 期限内に入金があり、未入金リストには入れなかったもの */
  onTime?: boolean
  candidates?: Candidate[]
  dismissed?: string[]
  deposit?: Candidate
  /** 分割払いなどの一部入金。未入金額 ＝ amount − payments の合計 */
  payments?: { d: string; amount: number; by?: string; memo?: string; notified?: boolean; auto?: boolean }[]
  /** 消し込みに使った入金（日付|金額|摘要）。候補に出さない */
  deposits?: string[]
  openedAt?: string
  createdAt?: string
  updatedAt?: string
}
interface Settings {
  autoFrom?: string
  graceDays?: number
  /** 銀行の入金と自動で照合する（既定 true） */
  autoMatch?: boolean
  /** 未入金チェックをしない取引先（毎月小切手払いなど）。顧客名か請求書の取引先名で照らし合わせる */
  skipNames?: string[]
  /** 同期が書く：銀行の入金（会計の仕訳）がいつの分まで入っているか／その待ちの件数 */
  bankThrough?: string
  waitingBank?: number
  /** 名前が合わなくても、金額が 1 対 1 なら照合する（既定 true） */
  matchUnique?: boolean
  chatwork?: { enabled?: boolean; roomId?: string; remindDay?: number; lastRemind?: string }
}

const PAID_RE = /入金済|振込済|消込済/
const BANK_RE = /預金|銀行|UFJ|ＵＦＪ|信金|信用金庫|信組|ゆうちょ|郵便|PayPay|ペイペイ|楽天|住信|みずほ|三井住友|りそな|現金|口座|Bank/i
const CHUNK = 200
const CRM_URL = 'https://crm.accel-dash.com/#/receivables'
const paidSum = (r: Recv) => (r.payments ?? []).reduce((t, p) => t + (Number(p.amount) || 0), 0)
/** 未入金額（入金済み・取り下げは 0）。入金が請求より多いとマイナス（過入金） */
export const remaining = (r: Recv) => (r.status !== 'open' ? 0 : Math.round((Number(r.amount) || 0) - paidSum(r)))

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
    // 銀行の振込名義は小さい字を使わない（ｼﾔﾝ）ので、小さい字は大きい字にそろえる
    .replace(/[ァィゥェォッャュョヮ]/g, (c) => 'アイウエオツヤユヨワ'['ァィゥェォッャュョヮ'.indexOf(c)])
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
  /** 銀行の入金と自動で照合して入金済みにしたもの（未入金リストにあったもの） */
  autoPaid: number
  /** 期限内に入金があり、未入金リストに入れずに済んだもの */
  onTime: number
  /** 銀行の入金（会計の仕訳）がいつの分まで入っているか。これより後が期限＋待つ日数の請求は、まだ未入金にしない */
  bankThrough: string
  /** 銀行の仕訳がまだ入っていないので、未入金にするのを待っている請求 */
  waitingBank: number
  /** 請求書のない入金として新しく記録したもの */
  nobill: number
}
type Dep = Candidate & { key: string }
interface Target {
  id: string
  rec?: Recv // 既にある未入金
  make?: () => Recv // まだ無い MF の請求書（照合できなかったら未入金として作る）
  amount: number
  from: string
  due: string
  names: string[]
  aliases: Set<string>
  dismissed: Set<string>
  /** 入金期限＋待つ営業日数（この日を過ぎて、銀行の仕訳もこの日まで入っていたら未入金にする） */
  graceEnd: string
}
const depKey = (d: { d: string; amount: number; memo?: string }) => [d.d, d.amount, d.memo || ''].join('|')
/** 名前が「ほぼ確実」に合っているか（漢字の取引先名どうし、または以前その会社の入金だった振込名義） */
function strongName(t: Target, x: Dep) {
  const memo = kana(x.memo), text = kana(x.memo + x.partner)
  if (memo && t.aliases.has(memo)) return true
  return t.names.some((n) => n.length >= 2 && lcs(n, text) >= Math.min(n.length, 4))
}

export async function syncReceivables(now = new Date()): Promise<RecvSummary> {
  const today = jstToday(now)
  const st = (await loadMeta<Settings>('receivables')) ?? {}
  const autoFrom = normDate(st.autoFrom) || '2026-09-01'
  const grace = Number.isFinite(Number(st.graceDays)) ? Math.max(0, Math.min(30, Number(st.graceDays))) : 3
  const autoMatch = st.autoMatch !== false
  const skip = new Set((st.skipNames ?? []).map((n) => kana(String(n))).filter(Boolean))
  const matchUnique = st.matchUnique !== false

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
  const sum: RecvSummary = { created: 0, paid: 0, updated: 0, withCandidates: 0, autoPaid: 0, onTime: 0, bankThrough: '', waitingBank: 0, nobill: 0 }
  const targets: Target[] = []

  // 以前の入金（照合済み）の振込名義 → 顧客。次からはこの名義なら社名が合わなくても同じ会社とみなす
  const aliasOf = new Map<string, Set<string>>()
  for (const r of recs.values()) {
    const who = r.customerId || r.individualId
    // 金額だけで自動照合したものからは覚えない（間違いが次の月に広がらないように）
    if (!who || r.matchedBy === 'amount') continue
    const memos = [r.deposit?.memo, ...(r.payments ?? []).map((p) => (p.by === 'deposit' ? p.memo : ''))].filter(Boolean) as string[]
    for (const m of memos) {
      const k = kana(m)
      if (k.length < 2) continue
      const s = aliasOf.get(who) ?? new Set<string>()
      s.add(k)
      aliasOf.set(who, s)
    }
  }
  const namesOf = (list: unknown[]) => [...new Set(list.filter(Boolean).map((t) => kana(String(t))).filter((t) => t.length >= 2))]

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
    const billing = normDate(mf.billingDate)
    const prev = recs.get(id)
    if (!prev) {
      if (paid || amount <= 0) continue
      if (skip.size && [name, mf.partner].some((n) => n && skip.has(kana(String(n))))) continue // 小切手払いなど、チェックしない取引先
      const make = (): Recv => ({
        id, source: 'mf', status: 'open', invoiceId: String(mf.id ?? ''), revenueId: row.id,
        customerId: r.customerId || '', individualId: r.individualId || '', name, partner: String(mf.partner ?? ''),
        title: String(mf.title ?? r.note ?? ''), number: String(mf.number ?? ''), kind: '', item: String(mf.title ?? r.note ?? ''),
        amount, ownerName: own, billingDate: billing, dueDate: due, expectedDate: '', memo: '',
        mfPayment: payment, openedAt: today, createdAt: new Date().toISOString(),
      })
      targets.push({
        id, make, amount, due,
        from: billing || isoOf(new Date(dayOf(due).getTime() - 45 * 86400000)),
        names: namesOf([name, mf.partner, c?.kana]),
        aliases: aliasOf.get(r.customerId || r.individualId || '') ?? new Set(),
        dismissed: new Set(),
        graceEnd: addBusinessDays(due, grace),
      })
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

  /* ---- 会計の仕訳から銀行の入金を集める ---- */
  const openRecs = () => [...recs.values()].filter((r) => r.status === 'open' && Number(r.amount) > 0)
  const thisYm = today.slice(0, 7)
  const starts = [autoFrom, ...openRecs().map((r) => r.billingDate || r.dueDate || today)].map((d) => d.slice(0, 7)).sort()
  const fromYm = starts[0] < ymAdd(thisYm, -36) ? ymAdd(thisYm, -36) : ymAdd(starts[0], -1)
  const jdocs = await loadAll('finance_docs', 'journal', { idFrom: fromYm, idTo: thisYm })
  const byAmount = new Map<number, Dep[]>()
  const keyCount = new Map<string, number>() // 同じ日・同じ金額・同じ名義の入金が何口もあるとき（2 口目から #2, #3 を付けて区別する）
  let bankThrough = ''
  for (const doc of jdocs) {
    const rows = ((doc.data as { rows?: Record<string, unknown>[] }).rows ?? [])
    for (const x of rows) {
      const ca = String(x.ca ?? ''), da = String(x.da ?? '')
      if (BANK_RE.test(da) || BANK_RE.test(ca)) {
        const d = normDate(x.d)
        if (d > bankThrough && d <= today) bankThrough = d
      }
      // 入金＝借方が預金・現金で、貸方が売掛金（または売上）。振込手数料など（借方が費用）は入金ではない
      if (!(ca === '売掛金' || /売上/.test(ca)) || !BANK_RE.test(da)) continue
      const amt = Math.round(Number(x.cam) || 0)
      if (amt <= 0) continue
      const dep: Dep = { d: normDate(x.d), amount: amt, memo: String(x.memo ?? '').trim(), partner: [String(x.csub ?? ''), String(x.partner ?? '')].filter(Boolean).join('・'), account: da, score: 0, key: '' }
      const base = depKey(dep), n = (keyCount.get(base) ?? 0) + 1
      keyCount.set(base, n)
      dep.key = n > 1 ? `${base}#${n}` : base
      const list = byAmount.get(amt) ?? []
      list.push(dep)
      byAmount.set(amt, list)
    }
  }
  // すでに別の未入金の消し込みに使った入金は使わない
  const used = new Set<string>()
  // 画面や手作業で記録した入金は、摘要の書き方（「振込1 」の有無など）が仕訳と少し違うことがあるので、日付と金額が同じで名義が含まれていれば同じ入金とみなす
  const usedLoose = new Map<string, string[]>()
  const markLoose = (k: string) => {
    const [d, a, ...m] = k.replace(/#\d+$/, '').split('|')
    const memo = kana(m.join('|'))
    const l = usedLoose.get(`${d}|${a}`) ?? []
    l.push(memo)
    usedLoose.set(`${d}|${a}`, l)
  }
  for (const r of recs.values()) {
    if (r.deposit) { used.add(depKey(r.deposit)); markLoose(depKey(r.deposit)) }
    for (const k of r.deposits ?? []) { used.add(k); markLoose(k) }
  }
  const isUsed = (x: Dep) => {
    if (used.has(x.key)) return true
    const l = usedLoose.get(`${x.d}|${x.amount}`)
    if (!l) return false
    const m = kana(x.memo)
    const i = l.findIndex((u) => u === m || (u.length >= 2 && m.includes(u)) || (m.length >= 2 && u.includes(m)))
    if (i < 0) return false
    l.splice(i, 1) // 同じ名義・同じ金額が何口もあるときは 1 口ずつ
    used.add(x.key)
    return true
  }

  /* ---- 2') 銀行の入金と自動で照合 ---- */
  for (const r of openRecs()) {
    if (r.keepOpen || remaining(r) <= 0) continue
    const c = r.customerId ? custs.get(r.customerId) : undefined
    const base = r.source === 'manual' && r.openedAt
      ? isoOf(new Date(dayOf(r.openedAt).getTime() - 14 * 86400000))
      : r.billingDate || (r.dueDate ? isoOf(new Date(dayOf(r.dueDate).getTime() - 45 * 86400000)) : '')
    targets.push({
      id: r.id, rec: r, amount: remaining(r), due: r.dueDate || r.billingDate || today, from: base,
      names: namesOf([r.name, r.partner, c?.name, c?.kana]),
      aliases: aliasOf.get(r.customerId || r.individualId || '') ?? new Set(),
      dismissed: new Set(r.dismissed ?? []),
      graceEnd: '',
    })
  }
  targets.sort((a, b) => a.due.localeCompare(b.due) || a.id.localeCompare(b.id))
  const candOf = (t: Target) => (byAmount.get(t.amount) ?? []).filter((x) => (!t.from || x.d >= t.from) && x.d <= today && !isUsed(x) && !t.dismissed.has(x.key))
  const hit = new Map<string, { dep: Dep; by: 'name' | 'amount' }>()
  if (autoMatch) {
    // (1) 名前が合うもの：期限の早い請求から、名前が合う入金がちょうど 1 件のときだけ
    for (const t of targets) {
      const strong = candOf(t).filter((x) => strongName(t, x))
      if (strong.length !== 1) continue
      hit.set(t.id, { dep: strong[0], by: 'name' })
      used.add(strong[0].key)
    }
    // (2) 金額が 1 対 1：その金額の入金がその請求にしか当てはまらず、その請求にも入金が 1 件だけ
    if (matchUnique) {
      const rest = targets.filter((t) => !hit.has(t.id))
      for (const t of rest) {
        const cs = candOf(t)
        if (cs.length !== 1) continue
        const dep = cs[0]
        const rivals = rest.filter((u) => u !== t && !hit.has(u.id) && u.amount === t.amount && (!u.from || dep.d >= u.from) && !u.dismissed.has(dep.key))
        if (rivals.length) continue
        hit.set(t.id, { dep, by: 'amount' })
        used.add(dep.key)
      }
    }
  }
  for (const t of targets) {
    const h = hit.get(t.id)
    const { key: _k, ...dep } = h?.dep ?? ({} as Dep)
    if (t.rec) {
      if (!h) continue
      const r = t.rec
      const next: Recv = {
        ...r, status: 'paid', paidAt: dep.d, paidBy: 'auto', matchedBy: h.by, deposit: dep, notifyPaid: true,
        payments: [...(r.payments ?? []), { d: dep.d, amount: dep.amount, by: 'deposit', memo: dep.memo, auto: true, notified: true }],
        deposits: [...(r.deposits ?? []), h.dep.key], candidates: [],
      }
      recs.set(r.id, next)
      changed.set(r.id, next)
      sum.autoPaid++
      continue
    }
    if (h) {
      // 期限内（または待つ日数のうち）に入金があった：未入金リストには出さず、入金済みに記録だけ残す（画面では「期限内」でまとめて隠す）
      const rec: Recv = {
        ...t.make!(), status: 'paid', paidAt: dep.d, paidBy: 'auto', matchedBy: h.by, deposit: dep, onTime: true, notifyPaid: false,
        payments: [{ d: dep.d, amount: dep.amount, by: 'deposit', memo: dep.memo, auto: true, notified: true }], deposits: [h.dep.key],
      }
      recs.set(t.id, rec)
      changed.set(t.id, rec)
      sum.onTime++
    } else if (t.graceEnd && today > t.graceEnd && bankThrough < t.graceEnd) {
      // 期限は過ぎたが、銀行の明細がまだ会計に入っていない（入金されていても見えない）。入るまで未入金にしない
      sum.waitingBank++
    } else if (t.graceEnd && today > t.graceEnd) {
      const rec = t.make!()
      recs.set(t.id, rec)
      changed.set(t.id, rec)
      sum.created++
    }
  }

  /* ---- 3) 入金の候補（自動で決めきれないもの。決めるのは人） ---- */
  const candKeys = new Set<string>()
  for (const r of openRecs()) {
    if (remaining(r) <= 0) continue // 過入金（入金が請求より多い）は候補を出さない
    const amts = [...new Set([Math.round(Number(r.amount)), remaining(r)].filter((x) => x > 0))]
    const base = r.billingDate || (r.dueDate ? isoOf(new Date(dayOf(r.dueDate).getTime() - 60 * 86400000)) : '')
    const from = base ? isoOf(new Date(dayOf(base).getTime() - 7 * 86400000)) : ''
    const dismissed = new Set(r.dismissed ?? [])
    const c = r.customerId ? custs.get(r.customerId) : undefined
    const names = [r.name, r.partner, c?.name, c?.kana].filter(Boolean).map((t) => kana(String(t)))
    const aliases = aliasOf.get(r.customerId || r.individualId || '') ?? new Set<string>()
    const due = r.dueDate || r.billingDate || today
    const list = amts.flatMap((a) => byAmount.get(a) ?? [])
      .filter((x) => (!from || x.d >= from) && !isUsed(x) && !dismissed.has(x.key))
      .map((x) => {
        const t = kana(x.memo + x.partner)
        const score = aliases.has(kana(x.memo)) ? 99 : Math.max(0, ...names.map((n) => lcs(n, t)))
        return { ...x, score }
      })
      .sort((a, b) => b.score - a.score || Math.abs(dayOf(a.d).getTime() - dayOf(due).getTime()) - Math.abs(dayOf(b.d).getTime() - dayOf(due).getTime()))
      .slice(0, 3)
      .map(({ key: _k, ...x }) => x)
    if (list.length) sum.withCandidates++
    for (const x of list) candKeys.add(depKey(x))
    if (JSON.stringify(list) !== JSON.stringify(r.candidates ?? [])) {
      const next = { ...r, candidates: list }
      recs.set(r.id, next)
      changed.set(r.id, next)
    }
  }

  /* ---- 5) 請求書のない入金：同じ金額の請求書（MF・入金状況は問わない）が近い日付に無く、どの未入金にも使っていない入金 ---- */
  const invByAmount = new Map<number, string[]>()
  for (const row of revRows) {
    const mf = ((row.data as { mf?: Record<string, unknown> }).mf ?? {})
    const a = Math.round(Number(mf.total) || 0)
    if (a <= 0) continue
    const l = invByAmount.get(a) ?? []
    l.push(normDate(mf.billingDate) || normDate(mf.dueDate))
    invByAmount.set(a, l)
  }
  for (const list of byAmount.values()) {
    for (const x of list) {
      if (!x.d || x.d < autoFrom || isUsed(x) || candKeys.has(x.key)) continue
      const lo = isoOf(new Date(dayOf(x.d).getTime() - 150 * 86400000)), hi = isoOf(new Date(dayOf(x.d).getTime() + 10 * 86400000))
      if ((invByAmount.get(x.amount) ?? []).some((b) => b && b >= lo && b <= hi)) continue
      const id = `dep-${createHash('sha1').update(x.key).digest('hex').slice(0, 16)}`
      if (recs.has(id)) continue
      const { key: _k, ...dep } = x
      const rec: Recv = {
        id, source: 'deposit', status: 'nobill', amount: x.amount, paidAt: x.d, payer: x.memo, deposit: dep, deposits: [x.key],
        name: '', customerId: '', memo: '', checked: false, openedAt: today, createdAt: new Date().toISOString(),
      }
      recs.set(id, rec)
      changed.set(id, rec)
      used.add(x.key)
      sum.nobill++
    }
  }

  if (changed.size) await saveRecvs([...changed.values()])
  sum.bankThrough = bankThrough
  // 画面に「銀行の入金は ◯/◯ まで確認済み」と出すために残す
  if (st.bankThrough !== bankThrough || (st.waitingBank ?? 0) !== sum.waitingBank) {
    const cur = (await loadMeta<Settings>('receivables')) ?? {}
    await saveSettings({ ...cur, bankThrough, waitingBank: sum.waitingBank })
  }
  return sum
}

/* =========================================================================
   4) チャットワーク
   ========================================================================= */
const yen = (v: number) => `${Math.round(v).toLocaleString('ja-JP')}円`
const md = (iso?: string) => (iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : '—')
const honor = (n?: string) => (n && !/(様|御中|殿|さん|氏)$/.test(n) ? `${n}様` : n || '（名前なし）')

export async function postChatwork(roomId: string, token: string, body: string) {
  const res = await fetch(`https://api.chatwork.com/v2/rooms/${encodeURIComponent(roomId)}/messages`, {
    method: 'POST',
    headers: { 'X-ChatWorkToken': token, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ body }).toString(),
  })
  if (!res.ok) throw new Error(`チャットワークへの送信に失敗しました（${res.status}）：${(await res.text()).slice(0, 200)}`)
}

export function reminderText(list: Recv[], today: string, day: number) {
  const open = list.filter((r) => r.status === 'open').sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')))
  const total = open.reduce((s, r) => s + Math.max(0, remaining(r)), 0)
  const late = open.filter((r) => r.dueDate && r.dueDate < today)
  const lines = open.slice(0, 60).map((r) => {
    const over = r.dueDate && r.dueDate < today ? Math.floor((dayOf(today).getTime() - dayOf(r.dueDate).getTime()) / 86400000) : 0
    const rest = remaining(r), bill = Number(r.amount) || 0
    return `・${honor(r.name)}　${rest < 0 ? `過入金 ${yen(-rest)}` : yen(rest)}${rest !== bill ? `（請求 ${yen(bill)}）` : ''}　期限 ${md(r.dueDate)}${over ? `（${over}日超過）` : ''}${r.ownerName ? `　担当：${r.ownerName}` : ''}${r.kind || r.item ? `　${[r.kind, r.item].filter(Boolean).join('・')}` : ''}`
  })
  const more = open.length > 60 ? `\n…ほか ${open.length - 60} 件` : ''
  return `[info][title]【アクセルダッシュ】未入金のリマインド（${Number(today.slice(5, 7))}月・${day}営業日目）[/title]` +
    `未入金 ${open.length} 件・未入金額の合計 ${yen(total)}（うち入金期限を過ぎたもの ${late.length} 件）\n` +
    `担当の方は状況の確認と、必要ならお客様へのご連絡をお願いします。\n\n${lines.join('\n')}${more}\n\n一覧：${CRM_URL}[/info]`
}
export function paidText(list: Recv[]) {
  const lines = list.map((r) => `・${honor(r.name)}　${yen(Number(r.amount) || 0)}　入金 ${md(r.paidAt)}${r.paidBy === 'auto' ? (r.matchedBy === 'amount' ? '（自動照合・金額のみ。念のため確認を）' : '（自動照合）') : ''}${r.ownerName ? `　担当：${r.ownerName}` : ''}${r.kind || r.item ? `　${[r.kind, r.item].filter(Boolean).join('・')}` : ''}`)
  return `[info][title]【アクセルダッシュ】入金されました（未入金リストから ${list.length} 件）[/title]${lines.join('\n')}\n\n一覧：${CRM_URL}[/info]`
}

export async function notifyReceivables(now = new Date()) {
  const st = (await loadMeta<Settings>('receivables')) ?? {}
  const cw = st.chatwork ?? {}
  const token = process.env.CHATWORK_API_TOKEN || ''
  const roomId = String(cw.roomId || '').replace(/\D/g, '')
  if (!cw.enabled || !roomId || !token) return { skipped: true, reason: !token ? 'CHATWORK_API_TOKEN が未設定' : !roomId ? 'ルームID が未設定' : '通知がオフ' }
  const today = jstToday(now)
  const recs = (await loadAll('crm_docs', 'receivables')).map((r) => ({ ...(r.data as unknown as Recv), id: r.id }))
  const out = { paidSent: 0, partialSent: 0, remind: false }

  // 入金のお知らせ（14日より前に入金済みになったものは知らせずに印だけ消す）
  const pending = recs.filter((r) => r.status === 'paid' && r.notifyPaid)
  if (pending.length) {
    const limit = isoOf(new Date(dayOf(today).getTime() - 14 * 86400000))
    const fresh = pending.filter((r) => (r.paidAt || today) >= limit)
    if (fresh.length) await postChatwork(roomId, token, paidText(fresh))
    out.paidSent = fresh.length
    await saveRecvs(pending.map((r) => ({ ...r, notifyPaid: false, notifiedPaidAt: today })))
  }
  // 一部入金のお知らせ（未入金のまま、新しく記録された入金）
  const limit2 = isoOf(new Date(dayOf(today).getTime() - 14 * 86400000))
  const partial = recs.filter((r) => r.status === 'open' && (r.payments ?? []).some((p) => !p.notified))
  if (partial.length) {
    const lines: string[] = []
    for (const r of partial) {
      for (const p of r.payments ?? []) {
        if (p.notified || p.by === 'adjust' || (p.d && p.d < limit2)) continue
        lines.push(`・${honor(r.name)}　${yen(Number(p.amount) || 0)} 入金（${md(p.d)}）　${remaining(r) < 0 ? `過入金 ${yen(-remaining(r))}` : `残り ${yen(remaining(r))}`}${r.ownerName ? `　担当：${r.ownerName}` : ''}`)
      }
    }
    if (lines.length) await postChatwork(roomId, token, `[info][title]【アクセルダッシュ】一部入金がありました（${lines.length} 件）[/title]${lines.join('\n')}\n\n一覧：${CRM_URL}[/info]`)
    out.partialSent = lines.length
    await saveRecvs(partial.map((r) => ({ ...r, payments: (r.payments ?? []).map((p) => ({ ...p, notified: true })) })))
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
