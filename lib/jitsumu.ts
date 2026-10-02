/**
 * 実務従事 申込者管理の型と小さな道具。
 * 画面は app/jitsumu/page.tsx。テーブルは supabase/jitsumu.sql。
 */
import { supabase } from './supabase'

export interface JSession {
  id: string
  ym: string
  venue: string
  label: string
  dates: string
  capacity: number | null
  status: string
  note: string
  sort: number
}
export interface JPerson {
  id: string
  name: string
  email: string
  phone: string
  region: string
  pass_year: string
  card: string
  note: string
  individual_id: string
  created_at?: string
}
export interface JEntry {
  id: string
  person_id: string
  session_id: string | null
  status: string
  points: string
  grp: string
  format: string
  party: string
  tag: string
  note: string
  raw_status: string
  checks: Record<string, string>
  extra: Record<string, string>
  source: string
  sort: number
  applied_at: string | null
  created_at?: string
}

/** 開催前後のチェック（Excel の列と同じ並び）。date: 入れると今日の日付が入る */
export const CHECKS: { key: string; label: string; short: string; date?: boolean; phase: '前' | '後' }[] = [
  { key: 'reply', label: '返信', short: '返信', phase: '前' },
  { key: 'guide', label: '案内送信', short: '案内', phase: '前' },
  { key: 'group_add', label: 'グループ追加', short: 'G追加', phase: '前' },
  { key: 'paid', label: '入金確認', short: '入金', date: true, phase: '前' },
  { key: 'ppt', label: 'パワポ提出', short: 'パワポ', phase: '後' },
  { key: 'task', label: '課題提出', short: '課題', phase: '後' },
  { key: 'task_return', label: '課題返送', short: '課題返送', phase: '後' },
  { key: 'cert', label: '実績証明書提出', short: '証明書', phase: '後' },
  { key: 'cert_return', label: '実績証明書返送', short: '証明返送', phase: '後' },
]
/** 一覧には出さず、編集画面だけで扱うチェック（古い回で使っていたもの） */
export const MINOR_CHECKS = [
  { key: 'member', label: '会員' },
  { key: 'mail', label: '郵送' },
]

export const VENUES = ['東京', '大阪', '名古屋', '福岡', 'Zoom']
export const GROUPS = ['A', 'B', 'C', 'D']
export const POINTS = ['5ポイント', '7ポイント', '8ポイント', '10ポイント', '15ポイント']
export const PASS_YEARS = ['令和7年度', '令和6年度', '令和5年度', '令和4年度', '令和3年度', '更新ポイント希望', 'その他']

export const thisYm = () => {
  const d = new Date(Date.now() + 9 * 3600 * 1000)
  return d.toISOString().slice(0, 7)
}
export const todayIso = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
export const ymLabel = (ym: string) => {
  const m = /^(\d{4})-(\d{2})$/.exec(ym || '')
  return m ? `${m[1]}年${Number(m[2])}月` : ym || '（月未設定）'
}
export const sessionTitle = (s: JSession) => `${ymLabel(s.ym)}　${s.venue && s.venue !== '未設定' ? s.venue : s.label || '会場未設定'}`
export const isOnline = (s: JSession | undefined, e?: JEntry) => /zoom/i.test(s?.venue || '') || /zoom/i.test(e?.format || '')
/** 状態：中止・検討中はそのまま。それ以外は開催月で 募集中／開催済み */
export function sessionPhase(s: JSession): '募集中' | '開催済み' | '中止' | '検討中' | '締切' {
  if (s.status === '中止' || s.status === '検討中' || s.status === '締切') return s.status
  return s.ym && s.ym < thisYm() ? '開催済み' : '募集中'
}
export const isActiveEntry = (e: JEntry) => e.status !== 'キャンセル'
export const normEmail = (s: string) => (s || '').trim().toLowerCase()
export const nameKey = (s: string) => (s || '').normalize('NFKC').replace(/[\s　]+/g, '').replace(/さん$/, '')
/** チェックの値を短く見せる（日付は 9/28 に） */
export function checkShort(v: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || '')
  if (m) return `${Number(m[2])}/${Number(m[3])}`
  if (!v) return ''
  if (/^(済み?|◯|〇|○|済|done|✓|TRUE)$/i.test(v)) return '済'
  return v.length > 5 ? v.slice(0, 5) + '…' : v
}

/** Supabase は 1 回 1000 行までなので、ページを分けて全部読む */
export async function fetchAll<T>(table: string, order = 'created_at'): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select('*').order(order).order('id').range(from, from + 999)
    if (error) throw error
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < 1000) break
  }
  return out
}
