/**
 * マネーフォワードから CRM と財務管理へ実績を流す同期処理（サーバー専用）
 *
 *  クラウド請求書の請求書 → crm_docs   collection "revenues"（id: mf-inv-<請求書ID>）
 *  クラウド会計の仕訳     → finance_docs collection "journal" （id: YYYY-MM、月ごと 1 件）
 *
 * 方針
 * - 期間ごとの「上書き」。MF 側で修正・削除された分も追従する
 *   （請求書は請求日が期間内の mf-inv-* 行を、仕訳は対象月の doc を丸ごと置き換える）
 * - CRM で手入力した売上（id が mf-inv- で始まらない行）には触らない
 * - 請求書の取引先名 → CRM 顧客 の対応は crm_docs meta/mfmap に持つ。CRM の画面で決める
 * - 対応が無い取引先の請求書は customerId 空のまま入れ、CRM 側で「未紐付け」として見せる
 */
import { supabaseAdmin } from './supabaseAdmin'
import { mfGet, sleep, MF_INVOICE_BASE, MF_ACCOUNTING_BASE } from './mf'

/* ---------- MF 側の型（使う項目だけ） ---------- */
interface Billing {
  id: string
  partner_id: string | null
  partner_name: string | null
  title: string | null
  billing_date: string | null
  due_date: string | null
  sales_date: string | null
  billing_number: string | null
  payment_status: string | null
  email_status: string | null
  is_locked?: boolean
  subtotal_price: string | null
  excise_price: string | null
  total_price: string | null
  tag_names?: string[]
  items?: { name?: string; price?: string; quantity?: string; detail?: string }[]
  updated_at?: string
}
interface BillingsResponse {
  data: Billing[]
  pagination: { total_count: number; total_pages: number; per_page: number; current_page: number }
}
interface JournalLineDetails {
  value?: number
  tax_value?: number
  account_name?: string
  sub_account_name?: string
  department_name?: string
  tax_name?: string
  trade_partner_name?: string
}
interface JournalItem {
  id: string
  number: number
  transaction_date: string
  entered_by: string
  is_realized: boolean
  journal_type: string
  memo?: string | null
  branches: { remark?: string | null; debitor?: JournalLineDetails; creditor?: JournalLineDetails }[]
}
interface JournalsResponse {
  journals: JournalItem[]
  metadata: { total_count: number; total_pages: number }
}

/* ---------- CRM 側の型（使う項目だけ） ---------- */
interface CrmCustomer {
  id: string
  name?: string
  majorId?: string
  minorId?: string
  ownerId?: string
  owners?: { ownerId: string }[]
  active?: boolean
}
interface CrmRevenue {
  id: string
  source?: string
  customerId: string
  dealId?: string
  month: string
  date: string
  amount: number
  grossProfit: number | null
  majorId: string
  minorId: string
  ownerId: string
  note?: string
  createdAt?: string
  updatedAt?: string
  mf?: Record<string, unknown>
}
interface DocRow {
  collection: string
  id: string
  data: Record<string, unknown>
}

export interface SyncSummary {
  range: { from: string; to: string }
  invoices: {
    fetched: number
    upserted: number
    deleted: number
    unmatched: number
    unmatchedPartners: string[]
  }
  journals: {
    months: Record<string, number>
    journalsTotal: number
  }
  warnings: string[]
}

const CHUNK = 200

/** 「株式会社」「（株）」や空白の違いを吸収して名前を比べるためのキー */
export function nameKey(s: string) {
  return String(s || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/株式会社|有限会社|合同会社|一般社団法人|\(株\)|（株）|\(有\)|（有）|\(同\)|（同）/g, '')
    .replace(/[・･.、,]/g, '')
    .toLowerCase()
}

function ymOf(d: string | null | undefined) {
  return d ? String(d).slice(0, 7) : ''
}
function num(v: unknown) {
  const n = Number(String(v ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}
function monthsBetween(from: string, to: string) {
  const out: string[] = []
  let [y, m] = from.slice(0, 7).split('-').map(Number)
  const [ty, tm] = to.slice(0, 7).split('-').map(Number)
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return out
}
function lastDay(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

async function loadCollection(table: 'crm_docs' | 'finance_docs', collection: string, idPrefix?: string) {
  const out: DocRow[] = []
  let from = 0
  for (;;) {
    let q = supabaseAdmin.from(table).select('collection,id,data').eq('collection', collection).range(from, from + 999)
    if (idPrefix) q = q.like('id', `${idPrefix}%`)
    const { data, error } = await q
    if (error) throw new Error(`${table}/${collection} の読み込みに失敗：${error.message}`)
    out.push(...((data ?? []) as DocRow[]))
    if (!data || data.length < 1000) break
    from += 1000
  }
  return out
}

async function upsertDocs(table: 'crm_docs' | 'finance_docs', rows: DocRow[]) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((r) => ({ ...r, updated_at: new Date().toISOString() }))
    const { error } = await supabaseAdmin.from(table).upsert(chunk, { onConflict: 'collection,id' })
    if (error) throw new Error(`${table} への書き込みに失敗：${error.message}`)
  }
}

async function deleteDocs(table: 'crm_docs' | 'finance_docs', collection: string, ids: string[]) {
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { error } = await supabaseAdmin
      .from(table)
      .delete()
      .eq('collection', collection)
      .in('id', ids.slice(i, i + CHUNK))
    if (error) throw new Error(`${table} の削除に失敗：${error.message}`)
  }
}

/* =========================================================================
   請求書 → CRM 売上
   ========================================================================= */
async function fetchBillings(from: string, to: string) {
  const all: Billing[] = []
  for (let page = 1; page <= 200; page++) {
    const p = new URLSearchParams({ range_key: 'billing_date', from, to, per_page: '100', page: String(page) })
    const res = await mfGet<BillingsResponse>(`${MF_INVOICE_BASE}/billings?${p.toString()}`)
    all.push(...(res.data ?? []))
    if (!res.pagination || page >= res.pagination.total_pages) break
    await sleep(400) // 3 req/s の制限に余裕を持たせる
  }
  return all
}

function primaryOwnerId(c: CrmCustomer | undefined) {
  if (!c) return ''
  if (Array.isArray(c.owners) && c.owners.length && c.owners[0].ownerId) return c.owners[0].ownerId
  return c.ownerId || ''
}

async function syncInvoices(from: string, to: string, summary: SyncSummary) {
  const billings = await fetchBillings(from, to)
  summary.invoices.fetched = billings.length

  const [customersRows, existingRows, mapRow] = await Promise.all([
    loadCollection('crm_docs', 'customers'),
    loadCollection('crm_docs', 'revenues', 'mf-inv-'),
    supabaseAdmin.from('crm_docs').select('data').eq('collection', 'meta').eq('id', 'mfmap').maybeSingle(),
  ])
  if (mapRow.error) throw new Error(`名寄せ表の読み込みに失敗：${mapRow.error.message}`)

  const customers = new Map<string, CrmCustomer>()
  const byNameKey = new Map<string, CrmCustomer[]>()
  for (const r of customersRows) {
    const c = r.data as unknown as CrmCustomer
    customers.set(r.id, c)
    const k = nameKey(c.name || '')
    if (k) byNameKey.set(k, [...(byNameKey.get(k) ?? []), c])
  }
  const existing = new Map<string, CrmRevenue>()
  for (const r of existingRows) existing.set(r.id, r.data as unknown as CrmRevenue)

  const mapData = (mapRow.data?.data ?? {}) as { map?: Record<string, string> }
  const partnerMap: Record<string, string> = mapData.map ?? {}

  const now = new Date().toISOString()
  const rows: DocRow[] = []
  const seen = new Set<string>()
  const unmatched = new Set<string>()

  for (const b of billings) {
    const id = `mf-inv-${b.id}`
    seen.add(id)
    const prev = existing.get(id)
    const partner = (b.partner_name || '').trim()

    // 顧客の決め方：名寄せ表 → 以前の行で既に付いていた顧客 → 名前が一意に一致する顧客
    let customerId = partnerMap[partner] || ''
    if (!customerId && prev?.customerId && customers.has(prev.customerId)) customerId = prev.customerId
    if (!customerId && partner) {
      const cands = byNameKey.get(nameKey(partner)) ?? []
      if (cands.length === 1) customerId = cands[0].id
    }
    if (!customerId) unmatched.add(partner || '（取引先なし）')
    const cust = customerId ? customers.get(customerId) : undefined

    // 事業・サービス・担当者：顧客が変わっていなければ CRM で直した値を残す
    const keepFields = prev && prev.customerId === customerId
    const majorId = keepFields ? prev.majorId || cust?.majorId || '' : cust?.majorId || ''
    const minorId = keepFields ? prev.minorId || cust?.minorId || '' : cust?.minorId || ''
    const ownerId = keepFields ? prev.ownerId || primaryOwnerId(cust) : primaryOwnerId(cust)

    const month = ymOf(b.sales_date) || ymOf(b.billing_date)
    const data: CrmRevenue = {
      id,
      source: 'mf',
      customerId,
      dealId: prev?.dealId || '',
      month,
      date: b.billing_date || `${month}-01`,
      amount: Math.round(num(b.subtotal_price)),
      grossProfit: prev?.grossProfit ?? null,
      majorId,
      minorId,
      ownerId,
      note: b.title || '',
      createdAt: prev?.createdAt || now,
      updatedAt: now,
      mf: {
        id: b.id,
        number: b.billing_number || '',
        partner,
        partnerId: b.partner_id || '',
        title: b.title || '',
        billingDate: b.billing_date || '',
        salesDate: b.sales_date || '',
        dueDate: b.due_date || '',
        payment: b.payment_status || '',
        email: b.email_status || '',
        locked: Boolean(b.is_locked),
        subtotal: Math.round(num(b.subtotal_price)),
        tax: Math.round(num(b.excise_price)),
        total: Math.round(num(b.total_price)),
        tags: (b.tag_names ?? []).slice(0, 5),
        // 品目は CRM で使わないので件数だけ持つ。1 万行近くを毎回読み込むので、行を軽く保つ
        itemCount: (b.items ?? []).length,
        updatedAt: b.updated_at || '',
      },
    }
    rows.push({ collection: 'revenues', id, data: data as unknown as Record<string, unknown> })
  }

  // 期間内の請求日を持つのに今回返ってこなかった行 = MF 側で削除された請求書
  const stale: string[] = []
  for (const [id, r] of existing) {
    const bd = String((r.mf as { billingDate?: string } | undefined)?.billingDate || r.date || '')
    if (bd >= from && bd <= to && !seen.has(id)) stale.push(id)
  }

  await upsertDocs('crm_docs', rows)
  if (stale.length) await deleteDocs('crm_docs', 'revenues', stale)

  summary.invoices.upserted = rows.length
  summary.invoices.deleted = stale.length
  summary.invoices.unmatched = unmatched.size
  summary.invoices.unmatchedPartners = [...unmatched].sort().slice(0, 50)
}

/* =========================================================================
   会計の仕訳 → 財務管理の journal（月ごと）
   ========================================================================= */
async function fetchJournalsOfMonth(ym: string) {
  const all: JournalItem[] = []
  for (let page = 1; page <= 50; page++) {
    const p = new URLSearchParams({ start_date: `${ym}-01`, end_date: lastDay(ym), per_page: '5000', page: String(page) })
    const res = await mfGet<JournalsResponse>(`${MF_ACCOUNTING_BASE}/journals?${p.toString()}`)
    all.push(...(res.journals ?? []))
    if (!res.metadata || page >= res.metadata.total_pages) break
    await sleep(300)
  }
  return all
}

/** 財務管理アプリの仕訳 1 行（弥生の仕訳日記帳と同じ「1 行に借方と貸方」の形） */
function toFinanceRows(journals: JournalItem[]) {
  const rows: Record<string, unknown>[] = []
  let no = 0
  for (const j of journals) {
    for (const br of j.branches ?? []) {
      const d = br.debitor,
        c = br.creditor
      if (!d?.account_name && !c?.account_name) continue
      no++
      rows.push({
        d: j.transaction_date,
        no,
        da: d?.account_name || '',
        dsub: d?.sub_account_name || '',
        // MF API の value は税抜、tax_value は消費税。財務アプリ（弥生の仕訳日記帳と同じ形）は
        // 金額＝税込・消費税＝内数 なので足して入れる。これで借方合計＝貸方合計になる
        dam: num(d?.value) + num(d?.tax_value),
        dtax: num(d?.tax_value),
        ca: c?.account_name || '',
        csub: c?.sub_account_name || '',
        cam: num(c?.value) + num(c?.tax_value),
        ctax: num(c?.tax_value),
        memo: br.remark || j.memo || '',
        jno: String(j.number ?? ''),
        // 以下は MF 由来の追加情報。財務アプリは無視しても動く
        dept: d?.department_name || c?.department_name || '',
        partner: d?.trade_partner_name || c?.trade_partner_name || '',
        src: j.entered_by || '',
        mfId: j.id,
      })
    }
  }
  return rows
}

async function syncJournals(from: string, to: string, summary: SyncSummary) {
  const months = monthsBetween(from, to)
  for (const ym of months) {
    const journals = await fetchJournalsOfMonth(ym)
    const rows = toFinanceRows(journals)
    summary.journals.months[ym] = rows.length
    summary.journals.journalsTotal += journals.length
    const dTot = rows.reduce((t, r) => t + (r.dam as number), 0)
    const cTot = rows.reduce((t, r) => t + (r.cam as number), 0)
    if (dTot !== cTot) summary.warnings.push(`${ym}: 借方合計と貸方合計が一致しません（差 ${Math.abs(dTot - cTot).toLocaleString('ja-JP')} 円）`)
    if (rows.length === 0) {
      // 仕訳が無い月は doc を消しておく（以前に入っていた分も MF に無いなら消す）
      await deleteDocs('finance_docs', 'journal', [ym])
      continue
    }
    await upsertDocs('finance_docs', [
      {
        collection: 'journal',
        id: ym,
        data: { month: ym, rows, updatedAt: new Date().toISOString(), source: 'mf', count: rows.length },
      },
    ])
  }
}

/* =========================================================================
   入口
   ========================================================================= */
export async function runSync(opts: { from: string; to: string; trigger: 'manual' | 'cron'; invoices?: boolean; journals?: boolean }) {
  const from = opts.from.slice(0, 10)
  const to = opts.to.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    throw new Error('期間の指定が正しくありません（YYYY-MM-DD、開始 ≦ 終了）')
  }
  const summary: SyncSummary = {
    range: { from, to },
    invoices: { fetched: 0, upserted: 0, deleted: 0, unmatched: 0, unmatchedPartners: [] },
    journals: { months: {}, journalsTotal: 0 },
    warnings: [],
  }
  const { data: run } = await supabaseAdmin
    .from('mf_sync_runs')
    .insert({ trigger: opts.trigger, range_from: from, range_to: to })
    .select('id')
    .single()
  try {
    if (opts.invoices !== false) await syncInvoices(from, to, summary)
    if (opts.journals !== false) await syncJournals(from, to, summary)
    if (run?.id) {
      await supabaseAdmin
        .from('mf_sync_runs')
        .update({ finished_at: new Date().toISOString(), ok: true, summary })
        .eq('id', run.id)
    }
    return summary
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (run?.id) {
      await supabaseAdmin
        .from('mf_sync_runs')
        .update({ finished_at: new Date().toISOString(), ok: false, summary, error: message })
        .eq('id', run.id)
    }
    throw e
  }
}

/** 既定の同期範囲：3 か月前の月初 〜 今日（MF 側の修正・入金状況の変化を拾う） */
export function defaultRange() {
  const today = new Date()
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 3, 1))
  return { from: start.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) }
}
