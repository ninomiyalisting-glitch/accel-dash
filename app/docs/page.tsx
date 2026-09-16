'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { signOut } from '@/lib/auth'
import { DOC_KIND_LABEL, detectKind, normalizeUrl, type DocKind } from '@/lib/docKinds'
import {
  LogOut,
  Plus,
  Search,
  Pin,
  PinOff,
  Pencil,
  Trash2,
  X,
  ExternalLink,
  Table2,
  FileText,
  Presentation,
  ClipboardList,
  Folder,
  File,
  Link2,
  Settings2,
  ChevronUp,
  ChevronDown,
  ArrowLeft,
} from 'lucide-react'

/**
 * 資料置き場。
 *
 * Google ドライブに散らばっている重要資料・マニュアル・共有シートのリンクを
 * 「事業部 × 用途」で並べ、検索ですぐ辿れるようにする。ファイル本体は持たない。
 *
 * 権限は DB 側（RLS: is_staff）で担当者に限っている。画面のガードは表示用。
 */

interface Division { id: string; name: string; sort_order: number }
interface Purpose { id: string; name: string; sort_order: number }
interface DocLink {
  id: string
  title: string
  description: string | null
  url: string
  kind: DocKind
  division_id: string | null
  purpose_id: string | null
  pinned: boolean
  updated_at: string
}

type Draft = {
  id?: string
  title: string
  description: string
  url: string
  division_id: string
  purpose_id: string
  pinned: boolean
}
const EMPTY_DRAFT: Draft = { title: '', description: '', url: '', division_id: '', purpose_id: '', pinned: false }

const STAFF_DOMAIN = '@accel-partners.co.jp'

/** 種類ごとのアイコンと色。Google 各サービスの色味に寄せて見分けやすくする */
const KIND_STYLE: Record<DocKind, { icon: React.ReactNode; tone: string }> = {
  sheet: { icon: <Table2 size={20} />, tone: 'bg-emerald-50 text-emerald-700' },
  doc: { icon: <FileText size={20} />, tone: 'bg-sky-50 text-sky-700' },
  slide: { icon: <Presentation size={20} />, tone: 'bg-amber-50 text-amber-700' },
  form: { icon: <ClipboardList size={20} />, tone: 'bg-violet-50 text-violet-700' },
  folder: { icon: <Folder size={20} />, tone: 'bg-accel-lightest text-accel-text' },
  pdf: { icon: <File size={20} />, tone: 'bg-rose-50 text-rose-700' },
  file: { icon: <File size={20} />, tone: 'bg-gray-100 text-gray-700' },
  link: { icon: <Link2 size={20} />, tone: 'bg-gray-100 text-gray-700' },
}

function byOrder<T extends { sort_order: number; name: string }>(a: T, b: T) {
  return a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ja')
}

export default function DocsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [isStaff, setIsStaff] = useState(false)

  const [divisions, setDivisions] = useState<Division[]>([])
  const [purposes, setPurposes] = useState<Purpose[]>([])
  const [links, setLinks] = useState<DocLink[]>([])

  const [query, setQuery] = useState('')
  const [division, setDivision] = useState<string>('all')
  const [purpose, setPurpose] = useState<string>('all')

  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'ng'; text: string } | null>(null)

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
      if (staff) await fetchAll()
      setLoading(false)
    }
    void init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchAll() {
    const [d, p, l] = await Promise.all([
      supabase.from('doc_divisions').select('*').order('sort_order'),
      supabase.from('doc_purposes').select('*').order('sort_order'),
      supabase.from('doc_links').select('*').order('pinned', { ascending: false }).order('updated_at', { ascending: false }),
    ])
    const err = d.error ?? p.error ?? l.error
    if (err) {
      const hint = /relation .* does not exist/i.test(err.message)
        ? ' テーブルがまだありません。supabase/docs.sql を実行してください。'
        : ''
      setNotice({ kind: 'ng', text: `読み込みに失敗しました：${err.message}${hint}` })
      return
    }
    setDivisions(((d.data ?? []) as Division[]).sort(byOrder))
    setPurposes(((p.data ?? []) as Purpose[]).sort(byOrder))
    setLinks((l.data ?? []) as DocLink[])
  }

  const divName = useMemo(() => new Map(divisions.map((x) => [x.id, x.name])), [divisions])
  const purName = useMemo(() => new Map(purposes.map((x) => [x.id, x.name])), [purposes])

  /** 検索と絞り込み。ピン留めは常に先頭 */
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return links.filter((l) => {
      if (division !== 'all' && l.division_id !== division) return false
      if (purpose !== 'all' && l.purpose_id !== purpose) return false
      if (!q) return true
      const hay = [
        l.title,
        l.description ?? '',
        divName.get(l.division_id ?? '') ?? '',
        purName.get(l.purpose_id ?? '') ?? '',
        DOC_KIND_LABEL[l.kind] ?? '',
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [links, query, division, purpose, divName, purName])

  const pinnedShown = shown.filter((l) => l.pinned)
  const restShown = shown.filter((l) => !l.pinned)

  // ---------- リンクの追加・編集・削除
  function openNew() {
    setDraft({ ...EMPTY_DRAFT, division_id: division !== 'all' ? division : '', purpose_id: purpose !== 'all' ? purpose : '' })
  }
  function openEdit(l: DocLink) {
    setDraft({
      id: l.id,
      title: l.title,
      description: l.description ?? '',
      url: l.url,
      division_id: l.division_id ?? '',
      purpose_id: l.purpose_id ?? '',
      pinned: l.pinned,
    })
  }

  async function saveDraft() {
    if (!draft) return
    const url = normalizeUrl(draft.url)
    if (!url || !draft.title.trim()) {
      setNotice({ kind: 'ng', text: 'URL と名前は必須です' })
      return
    }
    setSaving(true)
    const row = {
      title: draft.title.trim(),
      description: draft.description.trim() || null,
      url,
      kind: detectKind(url),
      division_id: draft.division_id || null,
      purpose_id: draft.purpose_id || null,
      pinned: draft.pinned,
    }
    const res = draft.id
      ? await supabase.from('doc_links').update(row).eq('id', draft.id)
      : await supabase.from('doc_links').insert(row)
    setSaving(false)
    if (res.error) {
      setNotice({ kind: 'ng', text: `保存に失敗しました：${res.error.message}` })
      return
    }
    setDraft(null)
    setNotice({ kind: 'ok', text: draft.id ? '更新しました' : '追加しました' })
    await fetchAll()
  }

  async function togglePin(l: DocLink) {
    const { error } = await supabase.from('doc_links').update({ pinned: !l.pinned }).eq('id', l.id)
    if (error) {
      setNotice({ kind: 'ng', text: `更新に失敗しました：${error.message}` })
      return
    }
    setLinks((prev) => prev.map((x) => (x.id === l.id ? { ...x, pinned: !l.pinned } : x)))
  }

  async function removeLink(l: DocLink) {
    if (!confirm(`「${l.title}」をこの一覧から削除しますか？\n（Google ドライブ上のファイルは消えません）`)) return
    const { error } = await supabase.from('doc_links').delete().eq('id', l.id)
    if (error) {
      setNotice({ kind: 'ng', text: `削除に失敗しました：${error.message}` })
      return
    }
    setLinks((prev) => prev.filter((x) => x.id !== l.id))
  }

  // ---------- カテゴリー管理
  async function addCategory(table: 'doc_divisions' | 'doc_purposes', name: string) {
    const list = table === 'doc_divisions' ? divisions : purposes
    const sort_order = (list.at(-1)?.sort_order ?? 0) + 1
    const { error } = await supabase.from(table).insert({ name: name.trim(), sort_order })
    if (error) {
      setNotice({ kind: 'ng', text: `追加に失敗しました：${error.message}` })
      return
    }
    await fetchAll()
  }
  async function renameCategory(table: 'doc_divisions' | 'doc_purposes', id: string, name: string) {
    const { error } = await supabase.from(table).update({ name: name.trim() }).eq('id', id)
    if (error) setNotice({ kind: 'ng', text: `変更に失敗しました：${error.message}` })
    await fetchAll()
  }
  async function moveCategory(table: 'doc_divisions' | 'doc_purposes', id: string, dir: -1 | 1) {
    const list = table === 'doc_divisions' ? divisions : purposes
    const i = list.findIndex((x) => x.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= list.length) return
    const a = list[i]
    const b = list[j]
    // 同じ値だと入れ替わらないので、添字を並び順として振り直す
    await Promise.all([
      supabase.from(table).update({ sort_order: j + 1 }).eq('id', a.id),
      supabase.from(table).update({ sort_order: i + 1 }).eq('id', b.id),
    ])
    await fetchAll()
  }
  async function removeCategory(table: 'doc_divisions' | 'doc_purposes', c: { id: string; name: string }) {
    const count = links.filter((l) => (table === 'doc_divisions' ? l.division_id : l.purpose_id) === c.id).length
    const msg = count > 0
      ? `「${c.name}」を削除しますか？\n${count} 件の資料が属しています。資料は消えず、未分類になります。`
      : `「${c.name}」を削除しますか？`
    if (!confirm(msg)) return
    const { error } = await supabase.from(table).delete().eq('id', c.id)
    if (error) setNotice({ kind: 'ng', text: `削除に失敗しました：${error.message}` })
    if (table === 'doc_divisions' && division === c.id) setDivision('all')
    if (table === 'doc_purposes' && purpose === c.id) setPurpose('all')
    await fetchAll()
  }

  async function handleLogout() {
    await signOut()
    router.push('/login')
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-black">読み込み中…</div>
  }

  return (
    <div className="min-h-screen bg-surface-muted">
      <header className="border-b border-border-soft bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-1.5 text-sm text-black/60 hover:text-black">
              <ArrowLeft size={16} /> ポータル
            </Link>
            <img src="/logo.png" alt="ACCEL DASH" className="h-9 w-auto" />
            <span className="hidden text-lg font-bold text-black sm:inline">資料</span>
          </div>
          <div className="flex items-center gap-4">
            {email && <span className="text-sm text-black/70">{email}</span>}
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 rounded-lg border-2 border-border-soft bg-surface px-4 py-2 text-black hover:border-accel-secondary"
            >
              <LogOut size={18} />
              ログアウト
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {notice && (
          <div
            className={
              notice.kind === 'ok'
                ? 'mb-6 flex items-start justify-between gap-4 rounded-lg bg-accel-lightest px-5 py-3 text-black'
                : 'mb-6 flex items-start justify-between gap-4 rounded-lg bg-red-50 px-5 py-3 text-red-800'
            }
          >
            <span className="text-sm">{notice.text}</span>
            <button onClick={() => setNotice(null)} aria-label="閉じる" className="shrink-0 p-0">
              <X size={16} />
            </button>
          </div>
        )}

        {!isStaff ? (
          <div className="rounded-xl border border-border-soft bg-surface p-10 text-center text-black/70">
            このページは社内メンバー専用です。
          </div>
        ) : (
          <>
            {/* 見出しと操作 */}
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold text-black">資料置き場</h1>
                <p className="mt-1 text-sm text-black/60">
                  Google ドライブの重要資料・マニュアル・共有シートへのリンク集。ここで探して、開くだけ。
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setManageOpen(true)}
                  className="flex items-center gap-1.5 rounded-lg border-2 border-border-soft bg-surface px-3.5 py-2 text-sm font-semibold text-black hover:border-accel-secondary"
                >
                  <Settings2 size={16} /> カテゴリー
                </button>
                <button
                  onClick={openNew}
                  className="flex items-center gap-1.5 rounded-lg bg-accel-primary px-4 py-2 text-sm font-bold text-white hover:bg-accel-hover"
                >
                  <Plus size={16} /> 資料を追加
                </button>
              </div>
            </div>

            {/* 検索 */}
            <div className="relative mb-4">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-black/40" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="資料名・説明・カテゴリーで検索"
                className="w-full rounded-xl border-2 border-border-soft bg-surface py-3 pl-12 pr-4 text-black outline-none focus:border-accel-primary"
              />
            </div>

            {/* 事業部タブ */}
            <div className="mb-3 flex flex-wrap gap-2">
              {[{ id: 'all', name: 'すべて' }, ...divisions].map((d) => (
                <button
                  key={d.id}
                  onClick={() => setDivision(d.id)}
                  className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                    division === d.id
                      ? 'bg-accel-primary text-white'
                      : 'bg-surface text-black/70 ring-1 ring-border-soft hover:bg-accel-lightest'
                  }`}
                >
                  {d.name}
                </button>
              ))}
            </div>
            {/* 用途チップ */}
            <div className="mb-8 flex flex-wrap gap-2">
              {[{ id: 'all', name: '用途：すべて' }, ...purposes].map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPurpose(p.id)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                    purpose === p.id
                      ? 'bg-accel-text text-white'
                      : 'bg-surface text-black/60 ring-1 ring-border-soft hover:bg-accel-lightest'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>

            {links.length === 0 ? (
              <div className="rounded-xl border-2 border-dashed border-border-soft bg-surface p-12 text-center text-black/60">
                <p>まだ資料が登録されていません。</p>
                <button onClick={openNew} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-accel-primary px-4 py-2 text-sm font-bold text-white hover:bg-accel-hover">
                  <Plus size={16} /> 最初の資料を追加
                </button>
              </div>
            ) : shown.length === 0 ? (
              <div className="rounded-xl border border-border-soft bg-surface p-10 text-center text-black/60">
                条件に合う資料がありません。
              </div>
            ) : (
              <>
                {pinnedShown.length > 0 && (
                  <section className="mb-8">
                    <h2 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-black/70">
                      <Pin size={14} /> 重要
                    </h2>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {pinnedShown.map((l) => (
                        <LinkCard key={l.id} l={l} divName={divName} purName={purName} onEdit={openEdit} onPin={togglePin} onRemove={removeLink} />
                      ))}
                    </div>
                  </section>
                )}
                {restShown.length > 0 && (
                  <section>
                    {pinnedShown.length > 0 && <h2 className="mb-3 text-sm font-bold text-black/70">すべての資料</h2>}
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {restShown.map((l) => (
                        <LinkCard key={l.id} l={l} divName={divName} purName={purName} onEdit={openEdit} onPin={togglePin} onRemove={removeLink} />
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </>
        )}
      </main>

      {/* 追加・編集モーダル */}
      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDraft(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-surface p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-black">{draft.id ? '資料を編集' : '資料を追加'}</h2>
              <button onClick={() => setDraft(null)} aria-label="閉じる" className="text-black/50 hover:text-black">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <Field label="URL（Google ドライブのリンクを貼る）">
                <input
                  type="url"
                  value={draft.url}
                  onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  autoFocus
                  className="w-full rounded-lg border-2 border-border-soft px-3 py-2.5 text-black outline-none focus:border-accel-primary"
                />
                {draft.url.trim() && (
                  <p className="mt-1.5 text-xs text-black/60">
                    種類：{DOC_KIND_LABEL[detectKind(normalizeUrl(draft.url))]}
                  </p>
                )}
              </Field>
              <Field label="名前">
                <input
                  type="text"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="例：案件管理シート 2026"
                  className="w-full rounded-lg border-2 border-border-soft px-3 py-2.5 text-black outline-none focus:border-accel-primary"
                />
              </Field>
              <Field label="説明（任意）">
                <input
                  type="text"
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  placeholder="例：受任案件の進行状況。週次で更新"
                  className="w-full rounded-lg border-2 border-border-soft px-3 py-2.5 text-black outline-none focus:border-accel-primary"
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="事業部">
                  <select
                    value={draft.division_id}
                    onChange={(e) => setDraft({ ...draft, division_id: e.target.value })}
                    className="w-full rounded-lg border-2 border-border-soft bg-surface px-3 py-2.5 text-black outline-none focus:border-accel-primary"
                  >
                    <option value="">（未分類）</option>
                    {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </Field>
                <Field label="用途">
                  <select
                    value={draft.purpose_id}
                    onChange={(e) => setDraft({ ...draft, purpose_id: e.target.value })}
                    className="w-full rounded-lg border-2 border-border-soft bg-surface px-3 py-2.5 text-black outline-none focus:border-accel-primary"
                  >
                    <option value="">（未分類）</option>
                    {purposes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm text-black">
                <input type="checkbox" checked={draft.pinned} onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })} className="h-4 w-4" />
                重要資料として先頭に固定する
              </label>
            </div>
            <div className="mt-6 flex gap-3">
              <button
                onClick={saveDraft}
                disabled={saving}
                className="flex-1 rounded-lg bg-accel-primary px-4 py-3 font-bold text-white hover:bg-accel-hover disabled:opacity-60"
              >
                {saving ? '保存中…' : draft.id ? '更新する' : '追加する'}
              </button>
              <button onClick={() => setDraft(null)} className="rounded-lg border-2 border-border-soft px-5 py-3 text-black hover:bg-surface-muted">
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {/* カテゴリー管理 */}
      {manageOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setManageOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-surface p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-black">カテゴリーの管理</h2>
              <button onClick={() => setManageOpen(false)} aria-label="閉じる" className="text-black/50 hover:text-black">
                <X size={20} />
              </button>
            </div>
            <div className="grid gap-6 sm:grid-cols-2">
              <CategoryEditor
                title="事業部"
                items={divisions}
                onAdd={(n) => addCategory('doc_divisions', n)}
                onRename={(id, n) => renameCategory('doc_divisions', id, n)}
                onMove={(id, dir) => moveCategory('doc_divisions', id, dir)}
                onRemove={(c) => removeCategory('doc_divisions', c)}
              />
              <CategoryEditor
                title="用途"
                items={purposes}
                onAdd={(n) => addCategory('doc_purposes', n)}
                onRename={(id, n) => renameCategory('doc_purposes', id, n)}
                onMove={(id, dir) => moveCategory('doc_purposes', id, dir)}
                onRemove={(c) => removeCategory('doc_purposes', c)}
              />
            </div>
          </div>
        </div>
      )}
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

function LinkCard({
  l,
  divName,
  purName,
  onEdit,
  onPin,
  onRemove,
}: {
  l: DocLink
  divName: Map<string, string>
  purName: Map<string, string>
  onEdit: (l: DocLink) => void
  onPin: (l: DocLink) => void
  onRemove: (l: DocLink) => void
}) {
  const st = KIND_STYLE[l.kind] ?? KIND_STYLE.link
  return (
    <div className="group relative flex flex-col rounded-xl border border-border-soft bg-surface p-4 shadow-sm transition-shadow hover:shadow-md">
      <a href={l.url} target="_blank" rel="noopener noreferrer" className="flex flex-1 gap-3">
        <span className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl ${st.tone}`}>{st.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 font-bold leading-snug text-black">
            {l.title}
            <ExternalLink size={13} className="ml-1 inline-block text-black/30" />
          </p>
          {l.description && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-black/60">{l.description}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
            {l.division_id && divName.get(l.division_id) && (
              <span className="rounded-full bg-accel-lightest px-2 py-0.5 font-semibold text-accel-text">{divName.get(l.division_id)}</span>
            )}
            {l.purpose_id && purName.get(l.purpose_id) && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 font-semibold text-black/70">{purName.get(l.purpose_id)}</span>
            )}
            <span className="rounded-full px-2 py-0.5 text-black/40">{DOC_KIND_LABEL[l.kind]}</span>
          </div>
        </div>
      </a>
      {/* 操作。ホバーで出る（スマホは常時表示） */}
      <div className="mt-3 flex items-center justify-end gap-1 border-t border-border-soft pt-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
        <IconBtn title={l.pinned ? '固定を外す' : '重要として固定'} onClick={() => onPin(l)}>
          {l.pinned ? <PinOff size={14} /> : <Pin size={14} />}
        </IconBtn>
        <IconBtn title="編集" onClick={() => onEdit(l)}><Pencil size={14} /></IconBtn>
        <IconBtn title="削除" danger onClick={() => onRemove(l)}><Trash2 size={14} /></IconBtn>
      </div>
    </div>
  )
}

function IconBtn({ title, onClick, danger, children }: { title: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-lg text-black/50 transition-colors ${
        danger ? 'hover:bg-red-50 hover:text-red-600' : 'hover:bg-accel-lightest hover:text-accel-text'
      }`}
    >
      {children}
    </button>
  )
}

function CategoryEditor({
  title,
  items,
  onAdd,
  onRename,
  onMove,
  onRemove,
}: {
  title: string
  items: { id: string; name: string; sort_order: number }[]
  onAdd: (name: string) => void
  onRename: (id: string, name: string) => void
  onMove: (id: string, dir: -1 | 1) => void
  onRemove: (c: { id: string; name: string }) => void
}) {
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)

  return (
    <div>
      <h3 className="mb-2 text-sm font-bold text-black">{title}</h3>
      <ul className="divide-y divide-border-soft rounded-lg border border-border-soft">
        {items.map((c) => (
          <li key={c.id} className="flex items-center gap-1 px-3 py-2">
            {editing?.id === c.id ? (
              <input
                autoFocus
                value={editing.name}
                onChange={(e) => setEditing({ id: c.id, name: e.target.value })}
                onBlur={() => { if (editing.name.trim() && editing.name !== c.name) onRename(c.id, editing.name); setEditing(null) }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur()
                  if (e.key === 'Escape') setEditing(null)
                }}
                className="min-w-0 flex-1 rounded border border-accel-primary px-2 py-1 text-sm text-black outline-none"
              />
            ) : (
              <button onClick={() => setEditing({ id: c.id, name: c.name })} className="min-w-0 flex-1 truncate text-left text-sm text-black hover:underline" title="名前を変更">
                {c.name}
              </button>
            )}
            <IconBtn title="上へ" onClick={() => onMove(c.id, -1)}><ChevronUp size={14} /></IconBtn>
            <IconBtn title="下へ" onClick={() => onMove(c.id, 1)}><ChevronDown size={14} /></IconBtn>
            <IconBtn title="削除" danger onClick={() => onRemove(c)}><Trash2 size={14} /></IconBtn>
          </li>
        ))}
        {items.length === 0 && <li className="px-3 py-3 text-xs text-black/50">まだありません</li>}
      </ul>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => { e.preventDefault(); if (newName.trim()) { onAdd(newName); setNewName('') } }}
      >
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={`${title}を追加`}
          className="min-w-0 flex-1 rounded-lg border-2 border-border-soft px-3 py-2 text-sm text-black outline-none focus:border-accel-primary"
        />
        <button type="submit" className="rounded-lg bg-accel-primary px-3 py-2 text-sm font-bold text-white hover:bg-accel-hover">
          追加
        </button>
      </form>
    </div>
  )
}
