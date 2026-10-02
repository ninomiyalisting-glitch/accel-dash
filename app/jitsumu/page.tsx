'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { signOut } from '@/lib/auth'
import {
  CHECKS, MINOR_CHECKS, VENUES, GROUPS, POINTS, PASS_YEARS,
  type JSession, type JPerson, type JEntry,
  thisYm, todayIso, ymLabel, sessionTitle, sessionPhase, isActiveEntry, isOnline, normEmail, nameKey, checkShort, fetchAll,
} from '@/lib/jitsumu'
import { LogOut, Plus, Search, X, ArrowLeft, Users, CalendarDays, BarChart3, Pencil, ChevronRight, UserPlus, Undo2 } from 'lucide-react'

/**
 * 実務従事 申込者管理。
 *
 * Excel「実務従事申込者名簿」（月ごとのシート × 会場ごとの表）をアプリにしたもの。
 *  - 開催回：月 × 会場ごとの申込者と、開催前後のチェック（返信〜実績証明書返送）
 *  - 申込者：同じ人の参加歴・合格年度・名刺情報をすぐ引ける
 *  - 集計：年別（リアル／Zoom）・月別・会場別
 * 権限は DB 側（RLS: is_staff）で担当者に限っている。画面のガードは表示用。
 */

const STAFF_DOMAIN = '@accel-partners.co.jp'
type Tab = 'sessions' | 'people' | 'stats'
type Notice = { kind: 'ok' | 'ng'; text: string } | null

const inputCls = 'w-full rounded-lg border-2 border-border-soft bg-surface px-3 py-2.5 text-black outline-none focus:border-accel-primary'
const chip = (on: boolean) =>
  `min-h-0 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${on ? 'bg-accel-primary text-white' : 'bg-surface text-black/70 ring-1 ring-border-soft hover:bg-accel-lightest'}`

export default function JitsumuPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [isStaff, setIsStaff] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  const [sessions, setSessions] = useState<JSession[]>([])
  const [people, setPeople] = useState<JPerson[]>([])
  const [entries, setEntries] = useState<JEntry[]>([])

  const [tab, setTab] = useState<Tab>('sessions')
  const [openSession, setOpenSession] = useState<string | null>(null)
  const [openPerson, setOpenPerson] = useState<string | null>(null)
  const [editEntry, setEditEntry] = useState<JEntry | null>(null)
  const [editSession, setEditSession] = useState<Partial<JSession> | null>(null)
  const [apply, setApply] = useState<{ sessionId: string } | null>(null)

  async function load() {
    try {
      const [s, p, e] = await Promise.all([
        fetchAll<JSession>('jitsumu_sessions', 'ym'),
        fetchAll<JPerson>('jitsumu_people', 'created_at'),
        fetchAll<JEntry>('jitsumu_entries', 'sort'),
      ])
      setSessions(s)
      setPeople(p)
      setEntries(e)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err)
      const hint = /does not exist|schema cache/i.test(msg) ? ' テーブルがまだありません。supabase/jitsumu.sql を実行してください。' : ''
      setNotice({ kind: 'ng', text: `読み込みに失敗しました：${msg}${hint}` })
    }
  }

  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getSession()
      if (!data.session) {
        router.push('/login')
        return
      }
      const mail = data.session.user.email ?? ''
      setEmail(mail)
      const staff = mail.endsWith(STAFF_DOMAIN)
      setIsStaff(staff)
      if (staff) await load()
      setLoading(false)
    }
    void init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sessionById = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions])
  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people])
  const entriesBySession = useMemo(() => {
    const m = new Map<string, JEntry[]>()
    for (const e of entries) {
      const k = e.session_id ?? ''
      const l = m.get(k) ?? []
      l.push(e)
      m.set(k, l)
    }
    for (const l of m.values()) l.sort((a, b) => (isActiveEntry(a) ? 0 : 1) - (isActiveEntry(b) ? 0 : 1) || a.sort - b.sort)
    return m
  }, [entries])
  const entriesByPerson = useMemo(() => {
    const m = new Map<string, JEntry[]>()
    for (const e of entries) {
      const l = m.get(e.person_id) ?? []
      l.push(e)
      m.set(e.person_id, l)
    }
    return m
  }, [entries])

  // ---------- 書き込み
  function fail(what: string, err: { message: string } | null) {
    if (err) setNotice({ kind: 'ng', text: `${what}に失敗しました：${err.message}` })
    return !!err
  }
  async function patchEntry(id: string, patch: Partial<JEntry>) {
    const before = entries
    setEntries((list) => list.map((e) => (e.id === id ? { ...e, ...patch } : e)))
    const { error } = await supabase.from('jitsumu_entries').update(patch).eq('id', id)
    if (fail('保存', error)) setEntries(before)
  }
  async function toggleCheck(e: JEntry, key: string, date?: boolean) {
    const cur = e.checks?.[key] ?? ''
    const checks = { ...(e.checks ?? {}) }
    if (cur) delete checks[key]
    else checks[key] = date ? todayIso() : '済み'
    await patchEntry(e.id, { checks })
  }
  async function savePerson(p: JPerson) {
    const { id, created_at: _c, ...row } = p
    void _c
    const { error } = await supabase.from('jitsumu_people').update(row).eq('id', id)
    if (fail('保存', error)) return false
    setPeople((list) => list.map((x) => (x.id === id ? p : x)))
    setNotice({ kind: 'ok', text: `「${p.name}」さんを更新しました` })
    return true
  }
  async function saveSession(s: Partial<JSession>) {
    const row = {
      ym: s.ym || thisYm(), venue: s.venue || '', label: s.label || '', dates: s.dates || '',
      capacity: s.capacity == null || Number.isNaN(Number(s.capacity)) ? null : Number(s.capacity),
      status: s.status || '', note: s.note || '', sort: s.sort ?? 0,
    }
    if (s.id) {
      const { error } = await supabase.from('jitsumu_sessions').update(row).eq('id', s.id)
      if (fail('保存', error)) return false
      setSessions((list) => list.map((x) => (x.id === s.id ? { ...x, ...row } : x)))
    } else {
      const { data, error } = await supabase.from('jitsumu_sessions').insert(row).select().single()
      if (fail('追加', error)) return false
      setSessions((list) => [...list, data as JSession])
    }
    setNotice({ kind: 'ok', text: s.id ? '開催回を更新しました' : '開催回を追加しました' })
    return true
  }
  async function saveEntry(e: JEntry) {
    const { id, created_at: _c, ...row } = e
    void _c
    const { error } = await supabase.from('jitsumu_entries').update(row).eq('id', id)
    if (fail('保存', error)) return false
    setEntries((list) => list.map((x) => (x.id === id ? e : x)))
    setNotice({ kind: 'ok', text: '申込を更新しました' })
    return true
  }
  async function removeEntry(e: JEntry) {
    const p = personById.get(e.person_id)
    if (!confirm(`「${p?.name ?? ''}」さんのこの申込を削除しますか？（キャンセルなら「キャンセル」にする方がおすすめです。参加歴に残ります）`)) return false
    const { error } = await supabase.from('jitsumu_entries').delete().eq('id', e.id)
    if (fail('削除', error)) return false
    setEntries((list) => list.filter((x) => x.id !== e.id))
    return true
  }
  /** 申込の登録。メールアドレスが同じ人がいれば、その人の申込として追加する */
  async function addApplication(form: ApplyForm) {
    const mail = normEmail(form.email)
    let person = form.personId ? personById.get(form.personId) : mail ? people.find((p) => normEmail(p.email) === mail) : undefined
    if (!person) {
      const row = { name: form.name.trim(), email: mail, phone: form.phone.trim(), region: form.region.trim(), pass_year: form.pass_year, card: form.card.trim(), note: '' }
      const { data, error } = await supabase.from('jitsumu_people').insert(row).select().single()
      if (fail('申込者の登録', error)) return false
      person = data as JPerson
      setPeople((list) => [...list, person as JPerson])
    } else {
      // 新しく分かった連絡先・地域などは上書き（空欄では消さない）
      const upd: Partial<JPerson> = {}
      for (const k of ['phone', 'region', 'pass_year', 'card'] as const) if (form[k].trim() && form[k].trim() !== person[k]) upd[k] = form[k].trim()
      if (mail && !person.email) upd.email = mail
      if (Object.keys(upd).length) {
        const { error } = await supabase.from('jitsumu_people').update(upd).eq('id', person.id)
        if (!fail('申込者の更新', error)) {
          const np = { ...person, ...upd }
          setPeople((list) => list.map((x) => (x.id === np.id ? np : x)))
        }
      }
    }
    const inSession = entriesBySession.get(form.sessionId) ?? []
    const row = {
      person_id: person.id, session_id: form.sessionId || null, status: '申込', points: form.points, grp: '', note: form.note.trim(),
      checks: {}, extra: {}, source: 'manual', sort: inSession.length ? Math.max(...inSession.map((x) => x.sort)) + 1 : 0, applied_at: todayIso(),
    }
    const { data, error } = await supabase.from('jitsumu_entries').insert(row).select().single()
    if (fail('申込の登録', error)) return false
    setEntries((list) => [...list, data as JEntry])
    setNotice({ kind: 'ok', text: `「${person.name}」さんの申込を登録しました` })
    return true
  }

  async function handleLogout() {
    await signOut()
    router.push('/login')
  }

  if (loading) return <div className="flex min-h-screen items-center justify-center text-black">読み込み中…</div>

  const cur = openSession ? sessionById.get(openSession) : undefined

  return (
    <div className="min-h-screen bg-surface-muted">
      <header className="border-b border-border-soft bg-surface">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-1.5 text-sm text-black/60 hover:text-black">
              <ArrowLeft size={16} /> ポータル
            </Link>
            <img src="/logo.png" alt="ACCEL DASH" className="h-9 w-auto" />
            <span className="hidden text-lg font-bold text-black sm:inline">実務従事</span>
          </div>
          <div className="flex items-center gap-4">
            {email && <span className="text-sm text-black/70">{email}</span>}
            <button onClick={handleLogout} className="flex items-center gap-2 rounded-lg border-2 border-border-soft bg-surface px-4 py-2 text-black hover:border-accel-secondary">
              <LogOut size={18} /> ログアウト
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {notice && (
          <div className={notice.kind === 'ok' ? 'mb-6 flex items-start justify-between gap-4 rounded-lg bg-accel-lightest px-5 py-3 text-black' : 'mb-6 flex items-start justify-between gap-4 rounded-lg bg-red-50 px-5 py-3 text-red-800'}>
            <span className="text-sm">{notice.text}</span>
            <button onClick={() => setNotice(null)} aria-label="閉じる" className="min-h-0 shrink-0 p-0"><X size={16} /></button>
          </div>
        )}

        {!isStaff ? (
          <div className="rounded-xl border border-border-soft bg-surface p-10 text-center text-black/70">このページは社内メンバー専用です。</div>
        ) : (
          <>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold text-black">実務従事 申込者管理</h1>
                <p className="mt-1 text-sm text-black/60">開催回ごとの申込者と、返信〜実績証明書返送までのチェック。参加歴と集計もここで。</p>
              </div>
              <button onClick={() => setApply({ sessionId: openSession ?? '' })} className="flex items-center gap-1.5 rounded-lg bg-accel-primary px-4 py-2 text-sm font-bold text-white hover:bg-accel-hover">
                <UserPlus size={16} /> 申込を登録
              </button>
            </div>

            <div className="mb-6 flex flex-wrap gap-2">
              {([['sessions', '開催回', CalendarDays], ['people', '申込者', Users], ['stats', '集計', BarChart3]] as const).map(([k, l, Icon]) => (
                <button key={k} onClick={() => { setTab(k); setOpenSession(null) }} className={`${chip(tab === k)} flex items-center gap-1.5`}>
                  <Icon size={15} /> {l}
                </button>
              ))}
            </div>

            {sessions.length === 0 && <ImportBox onDone={load} onNotice={setNotice} />}
            {tab === 'sessions' && !cur && (
              <SessionList sessions={sessions} entriesBySession={entriesBySession} onOpen={setOpenSession} onNew={() => setEditSession({ ym: thisYm(), venue: '東京', capacity: 25 })} />
            )}
            {tab === 'sessions' && cur && (
              <SessionDetail
                s={cur}
                list={entriesBySession.get(cur.id) ?? []}
                personById={personById}
                entriesByPerson={entriesByPerson}
                onBack={() => setOpenSession(null)}
                onEditSession={() => setEditSession(cur)}
                onToggle={toggleCheck}
                onPatch={patchEntry}
                onEditEntry={setEditEntry}
                onPerson={setOpenPerson}
                onApply={() => setApply({ sessionId: cur.id })}
              />
            )}
            {tab === 'people' && <PeopleView people={people} entriesByPerson={entriesByPerson} sessionById={sessionById} onPerson={setOpenPerson} />}
            {tab === 'stats' && <StatsView sessions={sessions} entries={entries} sessionById={sessionById} />}
          </>
        )}
      </main>

      {editSession && (
        <SessionModal s={editSession} onClose={() => setEditSession(null)} onSave={async (s) => { if (await saveSession(s)) setEditSession(null) }} />
      )}
      {editEntry && (
        <EntryModal
          e={editEntry}
          person={personById.get(editEntry.person_id)}
          sessions={sessions}
          onClose={() => setEditEntry(null)}
          onSave={async (e) => { if (await saveEntry(e)) setEditEntry(null) }}
          onRemove={async (e) => { if (await removeEntry(e)) setEditEntry(null) }}
        />
      )}
      {openPerson && personById.get(openPerson) && (
        <PersonModal
          p={personById.get(openPerson)!}
          list={entriesByPerson.get(openPerson) ?? []}
          sessionById={sessionById}
          onClose={() => setOpenPerson(null)}
          onSave={async (p) => { if (await savePerson(p)) setOpenPerson(null) }}
          onOpenSession={(id) => { setOpenPerson(null); setTab('sessions'); setOpenSession(id) }}
        />
      )}
      {apply && (
        <ApplyModal
          initialSession={apply.sessionId}
          sessions={sessions}
          people={people}
          entriesBySession={entriesBySession}
          entriesByPerson={entriesByPerson}
          onClose={() => setApply(null)}
          onSave={async (f) => { if (await addApplication(f)) setApply(null) }}
        />
      )}
    </div>
  )
}

/* =====================================================================
   初回だけ：Excel から変換したデータ（JSON）の取り込み。開催回が 0 件のときだけ出る
   ===================================================================== */
type ImportData = { sessions: Record<string, unknown>[]; people: Record<string, unknown>[]; entries: Record<string, unknown>[] }
function ImportBox({ onDone, onNotice }: { onDone: () => Promise<void>; onNotice: (n: Notice) => void }) {
  const [data, setData] = useState<ImportData | null>(null)
  const [busy, setBusy] = useState('')
  async function read(file: File) {
    try {
      const j = JSON.parse(await file.text()) as ImportData
      if (!Array.isArray(j.sessions) || !Array.isArray(j.people) || !Array.isArray(j.entries)) throw new Error('形式が違います')
      setData(j)
    } catch (e) {
      onNotice({ kind: 'ng', text: `ファイルを読めませんでした：${e instanceof Error ? e.message : String(e)}` })
    }
  }
  async function run() {
    if (!data) return
    const steps: [string, Record<string, unknown>[]][] = [['jitsumu_sessions', data.sessions], ['jitsumu_people', data.people], ['jitsumu_entries', data.entries]]
    for (const [table, rows] of steps) {
      for (let i = 0; i < rows.length; i += 200) {
        setBusy(`${table}：${Math.min(i + 200, rows.length)} / ${rows.length}`)
        const { error } = await supabase.from(table).upsert(rows.slice(i, i + 200), { onConflict: 'id' })
        if (error) { setBusy(''); onNotice({ kind: 'ng', text: `取り込みに失敗しました（${table}）：${error.message}` }); return }
      }
    }
    setBusy('')
    onNotice({ kind: 'ok', text: `取り込みました：開催回 ${data.sessions.length}・申込者 ${data.people.length}・申込 ${data.entries.length}` })
    await onDone()
  }
  return (
    <div className="mb-6 rounded-xl border-2 border-dashed border-accel-secondary bg-surface p-6">
      <h2 className="text-base font-bold text-black">はじめに：Excel の名簿を取り込む</h2>
      <p className="mt-1 text-sm text-black/70">Excel「実務従事申込者名簿」から変換したファイル（jitsumu_import.json）を選んでください。取り込みは 1 回だけで、2 回目以降は画面から登録します。</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input type="file" accept=".json,application/json" onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} className="max-w-sm" />
        {data && (
          <button onClick={run} disabled={!!busy} className="rounded-lg bg-accel-primary px-5 py-2 font-bold text-white hover:bg-accel-hover disabled:opacity-60">
            {busy ? `取り込み中…（${busy}）` : `開催回 ${data.sessions.length}・申込者 ${data.people.length}・申込 ${data.entries.length} を取り込む`}
          </button>
        )}
      </div>
    </div>
  )
}

/* =====================================================================
   開催回の一覧
   ===================================================================== */
function SessionList({ sessions, entriesBySession, onOpen, onNew }: {
  sessions: JSession[]
  entriesBySession: Map<string, JEntry[]>
  onOpen: (id: string) => void
  onNew: () => void
}) {
  const years = useMemo(() => [...new Set(sessions.map((s) => s.ym.slice(0, 4)).filter(Boolean))].sort().reverse(), [sessions])
  // 「最近とこれからの回」＝ 2か月前の回から先（開催後のチェック中の回も入れる）
  const since = (() => { const [y, m] = thisYm().split('-').map(Number); const d = new Date(Date.UTC(y, m - 3, 1)); return d.toISOString().slice(0, 7) })()
  const [year, setYear] = useState<string>('upcoming')
  const shown = sessions
    .filter((s) => (year === 'upcoming' ? s.ym >= since && s.status !== '中止' && s.status !== '検討中' : s.ym.startsWith(year)))
    .sort((a, b) => (year === 'upcoming' ? a.ym.localeCompare(b.ym) : b.ym.localeCompare(a.ym)) || venueOrder(a) - venueOrder(b) || a.sort - b.sort)
  const byYm = new Map<string, JSession[]>()
  for (const s of shown) byYm.set(s.ym, [...(byYm.get(s.ym) ?? []), s])

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <button onClick={() => setYear('upcoming')} className={chip(year === 'upcoming')}>最近とこれからの回</button>
        {years.map((y) => <button key={y} onClick={() => setYear(y)} className={chip(year === y)}>{y}年</button>)}
        <span className="flex-1" />
        <button onClick={onNew} className="flex min-h-0 items-center gap-1.5 rounded-lg border-2 border-border-soft bg-surface px-3.5 py-2 text-sm font-semibold text-black hover:border-accel-secondary">
          <Plus size={16} /> 開催回を追加
        </button>
      </div>
      {!shown.length ? (
        <div className="rounded-xl border border-border-soft bg-surface p-10 text-center text-black/60">この条件の開催回はありません。</div>
      ) : (
        [...byYm.entries()].map(([ym, list]) => (
          <section key={ym} className="mb-7">
            <h2 className="mb-3 text-base font-bold text-black">{ymLabel(ym)}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((s) => {
                const es = (entriesBySession.get(s.id) ?? []).filter(isActiveEntry)
                const done = (k: string) => es.filter((e) => e.checks?.[k]).length
                const phase = sessionPhase(s)
                const full = s.capacity ? es.length >= s.capacity : false
                return (
                  <button key={s.id} onClick={() => onOpen(s.id)} className="min-h-0 rounded-xl border border-border-soft bg-surface p-4 text-left hover:border-accel-secondary hover:shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-lg font-bold text-black">{s.venue && s.venue !== '未設定' ? s.venue : s.label || '会場未設定'}</span>
                      <PhasePill phase={phase} />
                    </div>
                    {s.dates && <p className="text-xs text-black/60">{s.dates}</p>}
                    <div className="mt-2 flex items-baseline gap-1">
                      <span className={`text-2xl font-bold ${full ? 'text-rose-600' : 'text-accel-text'}`}>{es.length}</span>
                      <span className="text-sm text-black/60">{s.capacity ? `／ 定員 ${s.capacity} 名` : '名'}</span>
                    </div>
                    {s.capacity ? (
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-accel-lightest">
                        <div className={`h-full ${full ? 'bg-rose-500' : 'bg-accel-primary'}`} style={{ width: `${Math.min(100, (es.length / s.capacity) * 100)}%` }} />
                      </div>
                    ) : null}
                    {es.length > 0 && (
                      <p className="mt-2 text-xs text-black/60">
                        {phase === '開催済み'
                          ? `課題 ${done('task')}/${es.length}・証明書返送 ${done('cert_return')}/${es.length}`
                          : `返信 ${done('reply')}/${es.length}・案内 ${done('guide')}/${es.length}・入金 ${done('paid')}/${es.length}`}
                      </p>
                    )}
                  </button>
                )
              })}
            </div>
          </section>
        ))
      )}
    </>
  )
}
const venueOrder = (s: JSession) => {
  const i = VENUES.indexOf(s.venue)
  return i < 0 ? 99 : i
}
function PhasePill({ phase }: { phase: string }) {
  const tone = phase === '募集中' ? 'bg-accel-lightest text-accel-text' : phase === '中止' ? 'bg-rose-50 text-rose-700' : phase === '締切' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600'
  return <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${tone}`}>{phase}</span>
}

/* =====================================================================
   開催回の詳細（Excel の 1 つの表にあたる）
   ===================================================================== */
function SessionDetail({ s, list, personById, entriesByPerson, onBack, onEditSession, onToggle, onPatch, onEditEntry, onPerson, onApply }: {
  s: JSession
  list: JEntry[]
  personById: Map<string, JPerson>
  entriesByPerson: Map<string, JEntry[]>
  onBack: () => void
  onEditSession: () => void
  onToggle: (e: JEntry, key: string, date?: boolean) => void
  onPatch: (id: string, patch: Partial<JEntry>) => void
  onEditEntry: (e: JEntry) => void
  onPerson: (id: string) => void
  onApply: () => void
}) {
  const [phase, setPhase] = useState<'前' | '後' | 'all'>(sessionPhase(s) === '開催済み' ? '後' : '前')
  const active = list.filter(isActiveEntry)
  const cols = CHECKS.filter((c) => phase === 'all' || c.phase === phase)
  const hasExtra = list.some((e) => e.extra && Object.keys(e.extra).length)
  return (
    <div>
      <button onClick={onBack} className="mb-4 flex min-h-0 items-center gap-1 text-sm text-black/60 hover:text-black">
        <ArrowLeft size={15} /> 開催回の一覧へ
      </button>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border-soft bg-surface p-5">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-black">{sessionTitle(s)}</h2>
            <PhasePill phase={sessionPhase(s)} />
          </div>
          <p className="mt-1 text-sm text-black/70">
            申込 <b className="text-black">{active.length}</b> 名{s.capacity ? `／定員 ${s.capacity} 名（残り ${Math.max(0, s.capacity - active.length)}）` : ''}
            {list.length > active.length ? `・キャンセル ${list.length - active.length} 名` : ''}
            {s.dates ? `・日程 ${s.dates}` : ''}
          </p>
          {s.note && <p className="mt-2 whitespace-pre-wrap text-xs text-black/60">{s.note}</p>}
        </div>
        <div className="flex gap-2">
          <button onClick={onEditSession} className="flex min-h-0 items-center gap-1.5 rounded-lg border-2 border-border-soft bg-surface px-3 py-2 text-sm font-semibold text-black hover:border-accel-secondary">
            <Pencil size={15} /> 回の設定
          </button>
          <button onClick={onApply} className="flex min-h-0 items-center gap-1.5 rounded-lg bg-accel-primary px-3.5 py-2 text-sm font-bold text-white hover:bg-accel-hover">
            <UserPlus size={15} /> この回に申込を追加
          </button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button onClick={() => setPhase('前')} className={chip(phase === '前')}>開催前のチェック</button>
        <button onClick={() => setPhase('後')} className={chip(phase === '後')}>開催後のチェック</button>
        <button onClick={() => setPhase('all')} className={chip(phase === 'all')}>すべて</button>
        <span className="text-xs text-black/50">マスを押すと「済」になります（入金確認は今日の日付）。もう一度押すと外れます。</span>
      </div>

      {!list.length ? (
        <div className="rounded-xl border-2 border-dashed border-border-soft bg-surface p-10 text-center text-black/60">まだ申込はありません。</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border-soft bg-surface">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border-soft bg-surface-muted text-left text-xs text-black/60">
                <th className="px-3 py-2 w-10">No</th>
                <th className="px-3 py-2">名前</th>
                <th className="px-3 py-2">地域</th>
                <th className="px-3 py-2">合格年度</th>
                <th className="px-3 py-2">ポイント</th>
                <th className="px-3 py-2">G</th>
                {cols.map((c) => (
                  <th key={c.key} className="px-1 py-2 text-center whitespace-nowrap">
                    {c.short}
                    <div className="font-normal text-[11px] text-black/40">{active.filter((e) => e.checks?.[c.key]).length}/{active.length}</div>
                  </th>
                ))}
                <th className="px-3 py-2">メモ</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {list.map((e, i) => {
                const p = personById.get(e.person_id)
                const cancelled = !isActiveEntry(e)
                const times = (entriesByPerson.get(e.person_id) ?? []).filter(isActiveEntry).length
                return (
                  <tr key={e.id} className={`border-b border-border-soft/60 ${cancelled ? 'bg-gray-50 text-black/40' : 'hover:bg-accel-lightest/40'}`}>
                    <td className="px-3 py-2 text-xs text-black/50">{cancelled ? '—' : i + 1}</td>
                    <td className="px-3 py-2">
                      <button onClick={() => onPerson(e.person_id)} className="min-h-0 text-left font-semibold text-black hover:text-accel-hover">
                        {p?.name ?? '（不明）'}
                      </button>
                      <div className="flex flex-wrap gap-1">
                        {cancelled && <span className="rounded bg-gray-200 px-1.5 text-[11px] text-gray-600">キャンセル</span>}
                        {times > 1 && <span className="rounded bg-accel-lightest px-1.5 text-[11px] text-accel-text">{times}回目</span>}
                        {e.tag && <span className="rounded bg-amber-50 px-1.5 text-[11px] text-amber-700">{e.tag}</span>}
                        {isOnline(undefined, e) && <span className="rounded bg-violet-50 px-1.5 text-[11px] text-violet-700">Zoom</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{p?.region}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs">{p?.pass_year}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs">{e.points.replace('ポイント', 'pt')}</td>
                    <td className="px-2 py-1">
                      <select
                        value={e.grp}
                        onChange={(ev) => onPatch(e.id, { grp: ev.target.value })}
                        disabled={cancelled}
                        className="min-h-0 w-14 rounded border border-border-soft bg-surface px-1 py-1 text-sm"
                      >
                        <option value="">—</option>
                        {[...new Set([...GROUPS, e.grp].filter(Boolean))].map((g) => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </td>
                    {cols.map((c) => {
                      const v = e.checks?.[c.key] ?? ''
                      return (
                        <td key={c.key} className="px-1 py-1 text-center">
                          <button
                            onClick={() => onToggle(e, c.key, c.date)}
                            disabled={cancelled}
                            title={v ? `${c.label}：${v}（押すと外れます）` : `${c.label}を済みにする`}
                            className={`min-h-0 h-8 w-14 rounded-md text-xs font-semibold ${v ? 'bg-accel-primary text-white hover:bg-accel-hover' : 'border border-dashed border-border-soft text-black/30 hover:border-accel-secondary hover:text-black/60'}`}
                          >
                            {v ? checkShort(v) : '—'}
                          </button>
                        </td>
                      )
                    })}
                    <td className="max-w-[220px] px-3 py-2 text-xs text-black/60">
                      <span className="line-clamp-2" title={e.note}>{e.note}</span>
                    </td>
                    <td className="px-2 py-1">
                      <button onClick={() => onEditEntry(e)} aria-label="編集" className="min-h-0 rounded p-1.5 text-black/50 hover:bg-surface-muted hover:text-black">
                        <Pencil size={15} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {hasExtra && <p className="mt-2 text-xs text-black/50">古い Excel にあった列（出欠・チーム分け・請求書送付 など）は、各申込の編集画面に残してあります。</p>}
    </div>
  )
}

/* =====================================================================
   申込者
   ===================================================================== */
function PeopleView({ people, entriesByPerson, sessionById, onPerson }: {
  people: JPerson[]
  entriesByPerson: Map<string, JEntry[]>
  sessionById: Map<string, JSession>
  onPerson: (id: string) => void
}) {
  const [q, setQ] = useState('')
  const [onlyRepeat, setOnlyRepeat] = useState(false)
  const [limit, setLimit] = useState(100)
  const rows = useMemo(() => {
    const k = nameKey(q).toLowerCase()
    return people
      .map((p) => {
        const es = (entriesByPerson.get(p.id) ?? []).filter(isActiveEntry)
        const last = es.map((e) => sessionById.get(e.session_id ?? '')).filter(Boolean).sort((a, b) => (b!.ym).localeCompare(a!.ym))[0]
        return { p, n: es.length, last }
      })
      .filter(({ p, n }) => {
        if (onlyRepeat && n < 2) return false
        if (!k) return true
        return nameKey([p.name, p.email, p.phone, p.region, p.pass_year, p.card, p.note].join(' ')).toLowerCase().includes(k)
      })
      .sort((a, b) => (b.last?.ym ?? '').localeCompare(a.last?.ym ?? '') || a.p.name.localeCompare(b.p.name, 'ja'))
  }, [people, entriesByPerson, sessionById, q, onlyRepeat])
  return (
    <>
      <div className="relative mb-3">
        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-black/40" />
        <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setLimit(100) }} placeholder="名前・メール・電話・会社名（名刺情報）・地域で検索" className="w-full rounded-xl border-2 border-border-soft bg-surface py-3 pl-12 pr-4 text-black outline-none focus:border-accel-primary" />
      </div>
      <div className="mb-4 flex items-center gap-4 text-sm text-black/70">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={onlyRepeat} onChange={(e) => setOnlyRepeat(e.target.checked)} className="h-4 w-4 min-h-0" style={{ width: 16 }} />
          2回以上参加している人だけ
        </label>
        <span>{rows.length} 人</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border-soft bg-surface">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border-soft bg-surface-muted text-left text-xs text-black/60">
              <th className="px-3 py-2">名前</th><th className="px-3 py-2">メール</th><th className="px-3 py-2">地域</th><th className="px-3 py-2">合格年度</th><th className="px-3 py-2">名刺情報</th><th className="px-3 py-2 text-right">参加</th><th className="px-3 py-2">直近の回</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map(({ p, n, last }) => (
              <tr key={p.id} onClick={() => onPerson(p.id)} className="cursor-pointer border-b border-border-soft/60 hover:bg-accel-lightest/40">
                <td className="px-3 py-2 font-semibold text-black">{p.name}</td>
                <td className="px-3 py-2 text-xs">{p.email}</td>
                <td className="px-3 py-2 whitespace-nowrap">{p.region}</td>
                <td className="px-3 py-2 whitespace-nowrap text-xs">{p.pass_year}</td>
                <td className="max-w-[260px] px-3 py-2 text-xs text-black/60"><span className="line-clamp-1">{p.card}</span></td>
                <td className="px-3 py-2 text-right">{n}</td>
                <td className="px-3 py-2 whitespace-nowrap text-xs">{last ? sessionTitle(last) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <button onClick={() => setLimit(limit + 200)} className="mt-3 flex min-h-0 items-center gap-1 rounded-lg border-2 border-border-soft bg-surface px-4 py-2 text-sm font-semibold text-black hover:border-accel-secondary">
          さらに表示（残り {rows.length - limit} 人）<ChevronRight size={15} />
        </button>
      )}
    </>
  )
}

/* =====================================================================
   集計
   ===================================================================== */
function StatsView({ sessions, entries, sessionById }: { sessions: JSession[]; entries: JEntry[]; sessionById: Map<string, JSession> }) {
  const act = entries.filter((e) => isActiveEntry(e) && e.session_id && sessionById.get(e.session_id)?.status !== '検討中' && sessionById.get(e.session_id)?.status !== '中止')
  const years = [...new Set(act.map((e) => sessionById.get(e.session_id!)!.ym.slice(0, 4)))].filter(Boolean).sort()
  const byYear = years.map((y) => {
    const es = act.filter((e) => sessionById.get(e.session_id!)!.ym.startsWith(y))
    const zoom = es.filter((e) => isOnline(sessionById.get(e.session_id!), e)).length
    return { y, total: es.length, real: es.length - zoom, zoom, people: new Set(es.map((e) => e.person_id)).size }
  })
  const recent = years.slice(-3)
  const monthly = (y: string) => Array.from({ length: 12 }, (_, i) => act.filter((e) => sessionById.get(e.session_id!)!.ym === `${y}-${String(i + 1).padStart(2, '0')}`).length)
  const venues = [...new Set(sessions.map((s) => s.venue || '未設定'))].sort((a, b) => (VENUES.indexOf(a) < 0 ? 99 : VENUES.indexOf(a)) - (VENUES.indexOf(b) < 0 ? 99 : VENUES.indexOf(b)))
  const repeat = (() => {
    const m = new Map<string, number>()
    for (const e of act) m.set(e.person_id, (m.get(e.person_id) ?? 0) + 1)
    const all = m.size, rep = [...m.values()].filter((n) => n > 1).length
    return { all, rep }
  })()
  const th = 'px-3 py-2 text-right whitespace-nowrap'
  return (
    <div className="space-y-6">
      <p className="text-xs text-black/50">開催月ごとの申込数（キャンセル・中止・検討中の回は除く）。Excel の「シート17」は申込を受けた月で数えていたので、少しずれます。</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label={`${thisYm().slice(0, 4)}年の申込`} value={byYear.find((r) => r.y === thisYm().slice(0, 4))?.total ?? 0} foot={(() => {
          const c = byYear.find((r) => r.y === thisYm().slice(0, 4)), p = byYear.find((r) => r.y === String(Number(thisYm().slice(0, 4)) - 1))
          return c && p && p.total ? `前年 ${p.total}・前年比 ${Math.round((c.total / p.total) * 100)}%` : ''
        })()} />
        <Kpi label="のべ申込（全期間）" value={act.length} foot={`申込者 ${repeat.all} 人`} />
        <Kpi label="2回以上参加した人" value={repeat.rep} foot={repeat.all ? `${Math.round((repeat.rep / repeat.all) * 100)}%` : ''} />
      </div>

      <Card title="年別（リアル／Zoom）">
        <table className="w-full border-collapse text-sm">
          <thead><tr className="border-b border-border-soft text-xs text-black/60"><th className="px-3 py-2 text-left">年</th><th className={th}>リアル</th><th className={th}>Zoom</th><th className={th}>合計</th><th className={th}>前年比</th><th className={th}>人数（重複なし）</th></tr></thead>
          <tbody>
            {byYear.map((r, i) => (
              <tr key={r.y} className="border-b border-border-soft/60">
                <td className="px-3 py-2 font-semibold">{r.y}年</td><td className={th}>{r.real}</td><td className={th}>{r.zoom}</td><td className={`${th} font-bold`}>{r.total}</td>
                <td className={th}>{i > 0 && byYear[i - 1].total ? `${Math.round((r.total / byYear[i - 1].total) * 100)}%` : '—'}</td><td className={th}>{r.people}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="月別（開催月）と累計">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead><tr className="border-b border-border-soft text-xs text-black/60"><th className="px-3 py-2 text-left">月</th>{recent.map((y) => <th key={y} className={th} colSpan={2}>{y}年（累計）</th>)}</tr></thead>
            <tbody>
              {Array.from({ length: 12 }, (_, i) => (
                <tr key={i} className="border-b border-border-soft/60">
                  <td className="px-3 py-1.5">{i + 1}月</td>
                  {recent.map((y) => {
                    const m = monthly(y)
                    const cum = m.slice(0, i + 1).reduce((a, b) => a + b, 0)
                    return [<td key={y + 'm'} className={th}>{m[i] || ''}</td>, <td key={y + 'c'} className={`${th} text-black/50`}>{cum}</td>]
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="会場別">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] border-collapse text-sm">
            <thead><tr className="border-b border-border-soft text-xs text-black/60"><th className="px-3 py-2 text-left">会場</th>{recent.map((y) => <th key={y} className={th}>{y}年</th>)}</tr></thead>
            <tbody>
              {venues.map((v) => (
                <tr key={v} className="border-b border-border-soft/60">
                  <td className="px-3 py-2">{v}</td>
                  {recent.map((y) => <td key={y} className={th}>{act.filter((e) => { const s = sessionById.get(e.session_id!)!; return s.ym.startsWith(y) && (s.venue || '未設定') === v }).length || ''}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
function Kpi({ label, value, foot }: { label: string; value: number; foot?: string }) {
  return (
    <div className="rounded-xl border border-border-soft bg-surface p-4">
      <p className="text-xs font-semibold text-black/60">{label}</p>
      <p className="text-2xl font-bold text-accel-text">{value.toLocaleString()}</p>
      {foot && <p className="text-xs text-black/50">{foot}</p>}
    </div>
  )
}
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border-soft bg-surface p-5">
      <h3 className="mb-3 text-base font-bold text-black">{title}</h3>
      {children}
    </section>
  )
}

/* =====================================================================
   モーダル
   ===================================================================== */
function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className={`max-h-[92vh] w-full ${wide ? 'max-w-3xl' : 'max-w-xl'} overflow-y-auto rounded-2xl bg-surface p-6 shadow-xl`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold text-black">{title}</h2>
          <button onClick={onClose} aria-label="閉じる" className="min-h-0 text-black/50 hover:text-black"><X size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold text-black/60">{label}</label>
      {children}
    </div>
  )
}
function SaveBar({ onSave, onClose, saving, label = '保存する', extra }: { onSave: () => void; onClose: () => void; saving?: boolean; label?: string; extra?: React.ReactNode }) {
  return (
    <div className="mt-6 flex flex-wrap gap-3">
      <button onClick={onSave} disabled={saving} className="flex-1 rounded-lg bg-accel-primary px-4 py-3 font-bold text-white hover:bg-accel-hover disabled:opacity-60">{saving ? '保存中…' : label}</button>
      <button onClick={onClose} className="rounded-lg border-2 border-border-soft px-5 py-3 text-black hover:bg-surface-muted">キャンセル</button>
      {extra}
    </div>
  )
}
function SessionOptions({ sessions }: { sessions: JSession[] }) {
  const sorted = [...sessions].sort((a, b) => b.ym.localeCompare(a.ym) || venueOrder(a) - venueOrder(b))
  return (
    <>
      {sorted.map((s) => <option key={s.id} value={s.id}>{sessionTitle(s)}{s.status ? `（${s.status}）` : ''}</option>)}
    </>
  )
}

function SessionModal({ s, onClose, onSave }: { s: Partial<JSession>; onClose: () => void; onSave: (s: Partial<JSession>) => Promise<void> }) {
  const [d, setD] = useState<Partial<JSession>>(s)
  const [saving, setSaving] = useState(false)
  return (
    <Modal title={s.id ? '開催回の設定' : '開催回を追加'} onClose={onClose}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="開催月"><input type="month" value={d.ym ?? ''} onChange={(e) => setD({ ...d, ym: e.target.value })} className={inputCls} /></Field>
        <Field label="会場">
          <input list="jitsumu-venues" value={d.venue ?? ''} onChange={(e) => setD({ ...d, venue: e.target.value })} className={inputCls} placeholder="東京" />
          <datalist id="jitsumu-venues">{VENUES.map((v) => <option key={v} value={v} />)}</datalist>
        </Field>
        <Field label="定員（名）"><input type="number" value={d.capacity ?? ''} onChange={(e) => setD({ ...d, capacity: e.target.value === '' ? null : Number(e.target.value) })} className={inputCls} /></Field>
        <Field label="状態">
          <select value={d.status ?? ''} onChange={(e) => setD({ ...d, status: e.target.value })} className={inputCls}>
            <option value="">自動（開催月で 募集中／開催済み）</option>
            <option value="締切">締切</option>
            <option value="中止">中止</option>
            <option value="検討中">検討中・お問合せ</option>
          </select>
        </Field>
        <div className="sm:col-span-2"><Field label="日程（任意）"><input value={d.dates ?? ''} onChange={(e) => setD({ ...d, dates: e.target.value })} placeholder="例：11/15（土）・16（日）・29（土）・30（日）" className={inputCls} /></Field></div>
        <div className="sm:col-span-2"><Field label="呼び名（任意。会場名と別に付けたいとき）"><input value={d.label ?? ''} onChange={(e) => setD({ ...d, label: e.target.value })} className={inputCls} /></Field></div>
        <div className="sm:col-span-2"><Field label="メモ（案内送信予定・やること など）"><textarea value={d.note ?? ''} onChange={(e) => setD({ ...d, note: e.target.value })} className={inputCls} rows={3} /></Field></div>
      </div>
      <SaveBar saving={saving} onClose={onClose} onSave={async () => { setSaving(true); await onSave(d); setSaving(false) }} />
    </Modal>
  )
}

function EntryModal({ e, person, sessions, onClose, onSave, onRemove }: {
  e: JEntry
  person?: JPerson
  sessions: JSession[]
  onClose: () => void
  onSave: (e: JEntry) => Promise<void>
  onRemove: (e: JEntry) => Promise<void>
}) {
  const [d, setD] = useState<JEntry>({ ...e, checks: { ...(e.checks ?? {}) } })
  const [saving, setSaving] = useState(false)
  const setCheck = (k: string, v: string) => {
    const checks = { ...d.checks }
    if (v.trim()) checks[k] = v
    else delete checks[k]
    setD({ ...d, checks })
  }
  const extra = Object.entries(e.extra ?? {})
  return (
    <Modal title={`${person?.name ?? ''} さんの申込`} onClose={onClose} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="開催回（振替のときはここを変える）">
          <select value={d.session_id ?? ''} onChange={(ev) => setD({ ...d, session_id: ev.target.value || null })} className={inputCls}>
            <option value="">（未定）</option>
            <SessionOptions sessions={sessions} />
          </select>
        </Field>
        <Field label="状態">
          <select value={d.status} onChange={(ev) => setD({ ...d, status: ev.target.value })} className={inputCls}>
            <option value="申込">申込</option>
            <option value="キャンセル">キャンセル</option>
            <option value="検討中">検討中・お問合せ</option>
          </select>
        </Field>
        <Field label="希望ポイント">
          <input list="jitsumu-points" value={d.points} onChange={(ev) => setD({ ...d, points: ev.target.value })} className={inputCls} />
          <datalist id="jitsumu-points">{POINTS.map((v) => <option key={v} value={v} />)}</datalist>
        </Field>
        <Field label="グループ">
          <input list="jitsumu-groups" value={d.grp} onChange={(ev) => setD({ ...d, grp: ev.target.value })} className={inputCls} />
          <datalist id="jitsumu-groups">{GROUPS.map((v) => <option key={v} value={v} />)}</datalist>
        </Field>
        <Field label="メモ札（飲み会・会場変更 など。一覧で名前の下に出ます）"><input value={d.tag} onChange={(ev) => setD({ ...d, tag: ev.target.value })} className={inputCls} /></Field>
        <Field label="懇親会"><input value={d.party} onChange={(ev) => setD({ ...d, party: ev.target.value })} className={inputCls} /></Field>
        <div className="sm:col-span-2"><Field label="備考（申込時のコメントなど）"><textarea value={d.note} onChange={(ev) => setD({ ...d, note: ev.target.value })} className={inputCls} rows={3} /></Field></div>
      </div>
      <h3 className="mb-2 mt-6 text-sm font-bold text-black">チェック（空欄＝未。日付や「◯8pt」などそのまま書けます）</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        {[...CHECKS, ...MINOR_CHECKS].map((c) => (
          <Field key={c.key} label={c.label}>
            <input value={d.checks[c.key] ?? ''} onChange={(ev) => setCheck(c.key, ev.target.value)} className={inputCls} placeholder="—" />
          </Field>
        ))}
      </div>
      {extra.length > 0 && (
        <details className="mt-5 rounded-lg bg-surface-muted p-3 text-sm">
          <summary className="cursor-pointer font-semibold text-black/70">Excel にあったその他の列（{extra.length}）</summary>
          <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {extra.map(([k, v]) => (<div key={k} className="flex gap-2"><dt className="shrink-0 text-black/50">{k}</dt><dd className="text-black">{v}</dd></div>))}
          </dl>
        </details>
      )}
      <SaveBar
        saving={saving}
        onClose={onClose}
        onSave={async () => { setSaving(true); await onSave(d); setSaving(false) }}
        extra={
          <>
            {d.status !== 'キャンセル' && (
              <button onClick={async () => { setSaving(true); await onSave({ ...d, status: 'キャンセル' }); setSaving(false) }} className="flex items-center gap-1.5 rounded-lg border-2 border-border-soft px-4 py-3 text-black hover:bg-surface-muted"><Undo2 size={16} /> キャンセルにする</button>
            )}
            <button onClick={() => onRemove(e)} className="rounded-lg px-4 py-3 text-sm text-red-700 hover:bg-red-50">削除</button>
          </>
        }
      />
    </Modal>
  )
}

function PersonModal({ p, list, sessionById, onClose, onSave, onOpenSession }: {
  p: JPerson
  list: JEntry[]
  sessionById: Map<string, JSession>
  onClose: () => void
  onSave: (p: JPerson) => Promise<void>
  onOpenSession: (id: string) => void
}) {
  const [d, setD] = useState<JPerson>({ ...p })
  const [saving, setSaving] = useState(false)
  const hist = [...list].sort((a, b) => (sessionById.get(b.session_id ?? '')?.ym ?? '').localeCompare(sessionById.get(a.session_id ?? '')?.ym ?? ''))
  const f = (k: keyof JPerson, label: string, wide?: boolean, area?: boolean) => (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <Field label={label}>
        {area
          ? <textarea value={String(d[k] ?? '')} onChange={(e) => setD({ ...d, [k]: e.target.value })} className={inputCls} rows={2} />
          : <input value={String(d[k] ?? '')} onChange={(e) => setD({ ...d, [k]: e.target.value })} className={inputCls} />}
      </Field>
    </div>
  )
  return (
    <Modal title={`${p.name} さん`} onClose={onClose} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        {f('name', '名前')}{f('email', 'メールアドレス')}{f('phone', '電話番号')}{f('region', '地域')}
        <div>
          <Field label="合格年度">
            <input list="jitsumu-pass" value={d.pass_year} onChange={(e) => setD({ ...d, pass_year: e.target.value })} className={inputCls} />
            <datalist id="jitsumu-pass">{PASS_YEARS.map((v) => <option key={v} value={v} />)}</datalist>
          </Field>
        </div>
        <div />
        {f('card', '名刺情報（会社・部署・役職）', true, true)}
        {f('note', 'メモ', true, true)}
      </div>
      <h3 className="mb-2 mt-6 text-sm font-bold text-black">参加歴（{list.filter(isActiveEntry).length} 回）</h3>
      <div className="space-y-2">
        {hist.map((e) => {
          const s = sessionById.get(e.session_id ?? '')
          const done = CHECKS.filter((c) => e.checks?.[c.key]).length
          return (
            <button key={e.id} onClick={() => s && onOpenSession(s.id)} className="flex min-h-0 w-full items-center justify-between gap-3 rounded-lg border border-border-soft px-3 py-2 text-left hover:border-accel-secondary">
              <span className="text-sm font-semibold text-black">{s ? sessionTitle(s) : '（開催回未定）'}</span>
              <span className="flex items-center gap-2 text-xs text-black/60">
                {!isActiveEntry(e) && <span className="rounded bg-gray-200 px-1.5 text-gray-600">キャンセル</span>}
                {e.points && <span>{e.points}</span>}
                {e.grp && <span>G{e.grp}</span>}
                <span>チェック {done}/{CHECKS.length}</span>
                <ChevronRight size={14} />
              </span>
            </button>
          )
        })}
      </div>
      <SaveBar saving={saving} onClose={onClose} onSave={async () => { setSaving(true); await onSave(d); setSaving(false) }} />
    </Modal>
  )
}

export interface ApplyForm {
  personId: string
  sessionId: string
  name: string
  email: string
  phone: string
  region: string
  pass_year: string
  points: string
  card: string
  note: string
}
function ApplyModal({ initialSession, sessions, people, entriesBySession, entriesByPerson, onClose, onSave }: {
  initialSession: string
  sessions: JSession[]
  people: JPerson[]
  entriesBySession: Map<string, JEntry[]>
  entriesByPerson: Map<string, JEntry[]>
  onClose: () => void
  onSave: (f: ApplyForm) => Promise<void>
}) {
  const [f, setF] = useState<ApplyForm>({ personId: '', sessionId: initialSession, name: '', email: '', phone: '', region: '', pass_year: '', points: '15ポイント', card: '', note: '' })
  const [saving, setSaving] = useState(false)
  const open = sessions.filter((s) => sessionPhase(s) === '募集中' || s.id === initialSession)
  // 同じ人がいないか（メールが同じ、または名前が同じ）
  const match = useMemo(() => {
    if (f.personId) return people.find((p) => p.id === f.personId)
    const m = normEmail(f.email)
    if (m) { const p = people.find((x) => normEmail(x.email) === m); if (p) return p }
    return undefined
  }, [f.personId, f.email, people])
  const sameName = useMemo(() => {
    const k = nameKey(f.name)
    return k.length >= 2 && !match ? people.filter((p) => nameKey(p.name) === k).slice(0, 3) : []
  }, [f.name, match, people])
  const sel = sessions.find((s) => s.id === f.sessionId)
  const filled = sel ? (entriesBySession.get(sel.id) ?? []).filter(isActiveEntry).length : 0
  const pick = (p: JPerson) => setF({ ...f, personId: p.id, name: p.name, email: p.email, phone: p.phone, region: p.region, pass_year: p.pass_year, card: p.card })
  const save = async () => {
    if (!f.name.trim() && !match) return alert('名前を入れてください')
    if (!f.sessionId) return alert('開催回を選んでください')
    setSaving(true)
    await onSave({ ...f, personId: match?.id ?? f.personId, name: f.name || match?.name || '' })
    setSaving(false)
  }
  return (
    <Modal title="申込を登録" onClose={onClose} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="開催回">
            <select value={f.sessionId} onChange={(e) => setF({ ...f, sessionId: e.target.value })} className={inputCls}>
              <option value="">（選んでください）</option>
              <SessionOptions sessions={open} />
            </select>
          </Field>
          {sel && <p className={`mt-1 text-xs ${sel.capacity && filled >= sel.capacity ? 'text-rose-600' : 'text-black/60'}`}>いま {filled} 名{sel.capacity ? `／定員 ${sel.capacity} 名${filled >= sel.capacity ? '（満席です）' : ''}` : ''}</p>}
        </div>
        <Field label="名前"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, personId: '' })} className={inputCls} placeholder="山田　太郎" autoFocus /></Field>
        <Field label="メールアドレス"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value, personId: '' })} className={inputCls} /></Field>
        {(match || sameName.length > 0) && (
          <div className="rounded-lg bg-accel-lightest px-4 py-3 text-sm text-black sm:col-span-2">
            {match ? (
              <>過去に申込のある <b>{match.name}</b> さんです（参加 {(entriesByPerson.get(match.id) ?? []).filter(isActiveEntry).length} 回）。この人の申込として追加します。</>
            ) : (
              <>
                同じ名前の人がいます：
                {sameName.map((p) => (
                  <button key={p.id} onClick={() => pick(p)} className="ml-2 min-h-0 rounded-full bg-surface px-3 py-0.5 text-sm font-semibold text-accel-text ring-1 ring-border-soft hover:bg-accel-light/40">
                    {p.name}（{p.email || 'メールなし'}）
                  </button>
                ))}
                <span className="ml-2 text-xs text-black/60">同じ人なら押してください</span>
              </>
            )}
          </div>
        )}
        <Field label="電話番号"><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} className={inputCls} /></Field>
        <Field label="地域"><input value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })} className={inputCls} placeholder="東京都" /></Field>
        <Field label="合格年度">
          <select value={f.pass_year} onChange={(e) => setF({ ...f, pass_year: e.target.value })} className={inputCls}>
            <option value="">—</option>
            {PASS_YEARS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </Field>
        <Field label="希望ポイント">
          <select value={f.points} onChange={(e) => setF({ ...f, points: e.target.value })} className={inputCls}>
            {POINTS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </Field>
        <div className="sm:col-span-2"><Field label="名刺情報（会社・部署・役職）"><input value={f.card} onChange={(e) => setF({ ...f, card: e.target.value })} className={inputCls} /></Field></div>
        <div className="sm:col-span-2"><Field label="備考（申込フォームのコメントなど）"><textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} className={inputCls} rows={3} /></Field></div>
      </div>
      <SaveBar saving={saving} onClose={onClose} onSave={save} label="登録する" />
    </Modal>
  )
}
