'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { signOut } from '@/lib/auth'
import { Pencil, Trash2, LogOut, Plus, Upload, ImageIcon, X } from 'lucide-react'

interface App {
  id: string
  slug: string
  title: string
  description: string
  image_url: string | null
  category: string
  order: number
}

interface User {
  id: string
  email: string
  created_at: string
  last_sign_in_at: string | null
  confirmed: boolean
  is_admin: boolean
  is_me: boolean
  app_ids: string[]
}

/**
 * Supabase Storage の画像を縮小して取る URL を作る。
 *
 * アップロードは 5MB まで許容していて縮小もしていないため、
 * 原寸のまま一覧に並べると数 MB × アプリ数を読み込むことになる。
 * Storage の変換機能（/render/image/）で必要な幅だけ取る。
 * 変換に対応していない URL はそのまま返す。
 */
function thumbUrl(url: string, width: number): string {
  if (!url.includes('/storage/v1/object/public/')) return url
  const converted = url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/')
  const sep = converted.includes('?') ? '&' : '?'
  return `${converted}${sep}width=${width}&quality=70&resize=cover`
}

/**
 * 画像を指定した幅以下に縮小する。JPEG で書き出す。
 * 元より小さい場合や、読み込みに失敗した場合は元のファイルを返す
 * （縮小できないことでアップロード自体が失敗しないようにする）。
 */
async function shrinkImage(file: File, maxWidth: number): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return file

  try {
    const bitmap = await createImageBitmap(file)
    if (bitmap.width <= maxWidth) {
      bitmap.close()
      return file
    }

    const scale = maxWidth / bitmap.width
    const w = maxWidth
    const h = Math.round(bitmap.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close()
      return file
    }
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.82)
    )
    if (!blob || blob.size >= file.size) return file

    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
    return new File([blob], name, { type: 'image/jpeg' })
  } catch {
    return file
  }
}

type Notice = { kind: 'ok' | 'ng'; text: string } | null

export default function Home() {
  const router = useRouter()
  const fileInput = useRef<HTMLInputElement>(null)

  const [apps, setApps] = useState<App[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [tab, setTab] = useState<'apps' | 'users'>('apps')
  const [session, setSession] = useState<any>(null)
  const [notice, setNotice] = useState<Notice>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editData, setEditData] = useState<Partial<App>>({})
  const [saving, setSaving] = useState(false)
  const [confirmingApp, setConfirmingApp] = useState<string | null>(null)
  const [showNewApp, setShowNewApp] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newApp, setNewApp] = useState({ slug: '', title: '', description: '', order: 0 })

  const [uploading, setUploading] = useState(false)
  const [stockOpen, setStockOpen] = useState(false)
  const [stockQuery, setStockQuery] = useState('')
  const [stockPhotos, setStockPhotos] = useState<any[]>([])
  const [stockLoading, setStockLoading] = useState(false)
  const [stockError, setStockError] = useState('')

  const [newUserEmail, setNewUserEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [confirmingUser, setConfirmingUser] = useState<string | null>(null)

  useEffect(() => {
    checkAuth()
  }, [])

  async function authHeaders(extra: Record<string, string> = {}) {
    // state に持っているトークンを先に使う。
    // 以前は毎回 getSession() を呼んでいて、操作のたびに往復が増えていた。
    // 無いときだけ取りに行く（初回や期限切れの直後）。
    if (session?.access_token) {
      return { ...extra, Authorization: `Bearer ${session.access_token}` }
    }
    const { data } = await supabase.auth.getSession()
    return { ...extra, Authorization: `Bearer ${data.session?.access_token ?? ''}` }
  }

  async function readError(res: Response, fallback: string) {
    try {
      const body = await res.json()
      return body?.error || fallback
    } catch {
      return fallback
    }
  }

  async function checkAuth() {
    const { data } = await supabase.auth.getSession()
    if (!data.session) {
      router.push('/login')
      return
    }

    setSession(data.session)
    const email = data.session.user.email || ''
    const admin = email.endsWith('@accel-partners.co.jp')
    setIsAdmin(admin)

    // アプリ一覧だけ待って画面を出す。
    // 以前は fetchUsers() も待っていたため、管理者は
    //   getSession → apps → /api/users（Auth の全ユーザー取得 + app_access）
    // を直列で待たされ、その間ずっと空白だった。
    // ユーザー一覧は「ユーザー」タブを開くまで見えないので、裏で読む。
    await fetchApps()
    setLoading(false)

    if (admin) {
      // 待たない。取得できたら一覧に反映される
      void fetchUsers()
    }
  }

  async function fetchApps() {
    const { data, error } = await supabase
      .from('apps')
      .select('*')
      .order('order', { ascending: true })

    if (error) {
      setNotice({ kind: 'ng', text: `アプリの取得に失敗しました：${error.message}` })
      return
    }
    setApps(data ?? [])
  }

  async function fetchUsers() {
    const res = await fetch('/api/users', { headers: await authHeaders() })
    if (!res.ok) {
      setNotice({ kind: 'ng', text: await readError(res, 'ユーザーの取得に失敗しました') })
      return
    }
    setUsers(await res.json())
  }

  function handleEditStart(app: App) {
    setEditingId(app.id)
    setEditData(app)
    setStockOpen(false)
    setStockPhotos([])
    setStockError('')
    setStockQuery(app.title || '')
    setNotice(null)
  }

  function handleEditCancel() {
    setEditingId(null)
    setEditData({})
    setStockOpen(false)
  }

  async function handleEditSave(appId: string) {
    setSaving(true)
    const res = await fetch('/api/apps', {
      method: 'PATCH',
      headers: await authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        id: appId,
        title: editData.title,
        description: editData.description,
        image_url: editData.image_url,
        order: editData.order
      })
    })
    setSaving(false)

    if (!res.ok) {
      setNotice({ kind: 'ng', text: await readError(res, '保存に失敗しました') })
      return
    }

    await fetchApps()
    handleEditCancel()
    setNotice({ kind: 'ok', text: '保存しました' })
  }

  async function handleCreateApp() {
    if (!newApp.slug.trim() || !newApp.title.trim()) {
      setNotice({ kind: 'ng', text: 'サブドメインとアプリ名は必須です' })
      return
    }

    setCreating(true)
    const res = await fetch('/api/apps', {
      method: 'POST',
      headers: await authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        slug: newApp.slug.trim().toLowerCase(),
        title: newApp.title.trim(),
        description: newApp.description.trim(),
        order: Number(newApp.order) || 0
      })
    })
    setCreating(false)

    if (!res.ok) {
      setNotice({ kind: 'ng', text: await readError(res, 'アプリの追加に失敗しました') })
      return
    }

    setNewApp({ slug: '', title: '', description: '', order: 0 })
    setShowNewApp(false)
    await fetchApps()
    setNotice({ kind: 'ok', text: 'アプリを追加しました' })
  }

  async function handleDeleteApp(appId: string) {
    const res = await fetch(`/api/apps?id=${appId}`, {
      method: 'DELETE',
      headers: await authHeaders()
    })
    setConfirmingApp(null)

    if (!res.ok) {
      setNotice({ kind: 'ng', text: await readError(res, '削除に失敗しました') })
      return
    }
    await fetchApps()
    setNotice({ kind: 'ok', text: 'アプリを削除しました' })
  }

  async function handleUpload(file: File) {
    setUploading(true)
    setStockError('')

    // 送る前にブラウザで縮小する。
    // 5MB の写真をそのまま置くと一覧の読み込みが重くなるうえ、
    // Storage の変換も初回だけ時間がかかる。
    // 一覧の表示は幅 800px の帯なので 1600px あれば十分。
    const shrunk = await shrinkImage(file, 1600)

    const form = new FormData()
    form.append('file', shrunk)

    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: await authHeaders(),
      body: form
    })
    setUploading(false)

    if (!res.ok) {
      setStockError(await readError(res, 'アップロードに失敗しました'))
      return
    }

    const { url } = await res.json()
    setEditData((prev) => ({ ...prev, image_url: url }))
  }

  async function handleStockSearch() {
    if (!stockQuery.trim()) return
    setStockLoading(true)
    setStockError('')

    const res = await fetch(`/api/images?q=${encodeURIComponent(stockQuery)}`, {
      headers: await authHeaders()
    })
    setStockLoading(false)

    if (!res.ok) {
      setStockPhotos([])
      setStockError(await readError(res, '素材の取得に失敗しました'))
      return
    }

    const photos = await res.json()
    setStockPhotos(photos)
    if (photos.length === 0) setStockError('該当する素材が見つかりませんでした')
  }

  async function handleInvite() {
    if (!newUserEmail.trim()) return
    setInviting(true)

    const res = await fetch('/api/users', {
      method: 'POST',
      headers: await authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ email: newUserEmail })
    })
    setInviting(false)

    if (!res.ok) {
      setNotice({ kind: 'ng', text: await readError(res, '招待に失敗しました') })
      return
    }

    setNewUserEmail('')
    await fetchUsers()
    setNotice({ kind: 'ok', text: `${newUserEmail} に招待メールを送信しました` })
  }


  // アプリ権限の付け外し。画面を先に更新し、失敗したら戻す。
  async function toggleAppAccess(userId: string, appId: string, allow: boolean) {
    const before = users
    setUsers((prev) =>
      prev.map((u) =>
        u.id !== userId
          ? u
          : {
              ...u,
              app_ids: allow
                ? [...u.app_ids, appId]
                : u.app_ids.filter((id) => id !== appId)
            }
      )
    )

    const res = await fetch('/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, app_id: appId, allow })
    })

    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setUsers(before)
      setNotice({ kind: 'ng', text: body?.error ?? `権限を変更できませんでした（${res.status}）` })
    }
  }

  async function handleDeleteUser(userId: string) {
    const res = await fetch(`/api/users?id=${userId}`, {
      method: 'DELETE',
      headers: await authHeaders()
    })
    setConfirmingUser(null)

    if (!res.ok) {
      setNotice({ kind: 'ng', text: await readError(res, '削除に失敗しました') })
      return
    }
    await fetchUsers()
    setNotice({ kind: 'ok', text: 'ユーザーを削除しました' })
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
          <img src="/logo.png" alt="ACCEL DASH" className="h-9 w-auto" />
          <div className="flex items-center gap-4">
            {session?.user?.email && (
              <span className="text-sm text-black/70">{session.user.email}</span>
            )}
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

        {isAdmin && (
          <div className="mb-8 flex gap-2 border-b border-border-soft">
            <button
              onClick={() => setTab('apps')}
              className={
                tab === 'apps'
                  ? 'border-b-2 border-accel-primary px-5 py-3 text-black'
                  : 'border-b-2 border-transparent px-5 py-3 text-black/50 hover:text-black'
              }
            >
              アプリ
            </button>
            <button
              onClick={() => setTab('users')}
              className={
                tab === 'users'
                  ? 'border-b-2 border-accel-primary px-5 py-3 text-black'
                  : 'border-b-2 border-transparent px-5 py-3 text-black/50 hover:text-black'
              }
            >
              ユーザー
            </button>
          </div>
        )}

        {tab === 'apps' && (
          <section>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <h2>アプリ一覧</h2>
              {isAdmin && (
                <button
                  onClick={() => setShowNewApp((v) => !v)}
                  className="flex items-center gap-2 rounded-lg border-2 border-border-soft bg-surface px-4 py-2 text-black hover:border-accel-secondary"
                >
                  <Plus size={18} />
                  アプリを追加
                </button>
              )}
            </div>

            {showNewApp && isAdmin && (
              <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-border-soft bg-surface p-6">
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-black">サブドメイン</label>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={newApp.slug}
                      onChange={(e) => setNewApp({ ...newApp, slug: e.target.value })}
                      placeholder="magnet"
                      className="min-w-[160px] flex-1"
                    />
                    <span className="text-sm text-black/60">.accel-dash.com</span>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-black">アプリ名</label>
                  <input
                    type="text"
                    value={newApp.title}
                    onChange={(e) => setNewApp({ ...newApp, title: e.target.value })}
                    placeholder="採用広報ダッシュボード"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-black">説明</label>
                  <textarea
                    value={newApp.description}
                    onChange={(e) => setNewApp({ ...newApp, description: e.target.value })}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-black">表示順</label>
                  <input
                    type="number"
                    value={newApp.order}
                    onChange={(e) => setNewApp({ ...newApp, order: Number(e.target.value) })}
                  />
                </div>

                <p className="text-sm text-black/60">画像は追加したあと、編集から設定できます。</p>

                <div className="flex gap-3">
                  <button
                    onClick={handleCreateApp}
                    disabled={creating}
                    className="rounded-lg bg-accel-primary px-6 py-2 text-white hover:bg-accel-hover active:bg-accel-active"
                  >
                    {creating ? '追加中…' : '追加する'}
                  </button>
                  <button
                    onClick={() => setShowNewApp(false)}
                    className="rounded-lg border-2 border-border-soft px-6 py-2 text-black hover:border-accel-secondary"
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            )}

            {apps.length === 0 ? (
              isAdmin ? (
                <p className="text-black/70">アプリがありません</p>
              ) : (
                <div className="rounded-2xl border border-border-soft bg-surface p-6">
                  <p className="text-black">利用できるアプリがまだ割り当てられていません。</p>
                  <p className="mt-2 text-sm text-black/60">
                    担当者に連絡してください。割り当てられると、このページに表示されます。
                  </p>
                </div>
              )
            ) : (
              <div className="grid gap-5 sm:grid-cols-2">
                {apps.map((app) => (
                  <article
                    key={app.id}
                    className="overflow-hidden rounded-2xl border border-border-soft bg-surface"
                  >
                    {editingId === app.id ? (
                      <div className="flex flex-col gap-5 p-6">
                        <div className="flex flex-col gap-2">
                          <label className="text-sm font-semibold text-black">アプリ名</label>
                          <input
                            type="text"
                            value={editData.title ?? ''}
                            onChange={(e) => setEditData({ ...editData, title: e.target.value })}
                          />
                        </div>

                        <div className="flex flex-col gap-2">
                          <label className="text-sm font-semibold text-black">説明</label>
                          <textarea
                            value={editData.description ?? ''}
                            onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                          />
                        </div>

                        <div className="flex flex-col gap-3">
                          <label className="text-sm font-semibold text-black">アプリ画像</label>

                          {editData.image_url ? (
                            <div className="relative">
                              <img
                                src={editData.image_url}
                                alt=""
                                className="h-36 w-full rounded-lg object-cover"
                              />
                              <button
                                onClick={() => setEditData({ ...editData, image_url: null })}
                                aria-label="画像を外す"
                                className="absolute right-2 top-2 rounded-lg bg-black/70 p-2 text-white"
                              >
                                <X size={16} />
                              </button>
                            </div>
                          ) : (
                            <div className="flex h-36 items-center justify-center rounded-lg border-2 border-dashed border-border-soft text-sm text-black/50">
                              画像なし
                            </div>
                          )}

                          <div className="flex flex-wrap gap-3">
                            <button
                              onClick={() => fileInput.current?.click()}
                              disabled={uploading}
                              className="flex items-center gap-2 rounded-lg border-2 border-border-soft px-4 py-2 text-sm text-black hover:border-accel-secondary"
                            >
                              <Upload size={16} />
                              {uploading ? 'アップロード中…' : 'ファイルを選ぶ'}
                            </button>
                            <button
                              onClick={() => setStockOpen((v) => !v)}
                              className="flex items-center gap-2 rounded-lg border-2 border-border-soft px-4 py-2 text-sm text-black hover:border-accel-secondary"
                            >
                              <ImageIcon size={16} />
                              フリー素材から選ぶ
                            </button>
                          </div>

                          <input
                            ref={fileInput}
                            type="file"
                            accept="image/*"
                            hidden
                            onChange={(e) => {
                              const file = e.target.files?.[0]
                              if (file) handleUpload(file)
                              e.target.value = ''
                            }}
                          />

                          {stockOpen && (
                            <div className="flex flex-col gap-3 rounded-lg bg-surface-muted p-4">
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  value={stockQuery}
                                  onChange={(e) => setStockQuery(e.target.value)}
                                  onKeyDown={(e) => e.key === 'Enter' && handleStockSearch()}
                                  placeholder="英語キーワード（例: business training）"
                                  className="flex-1"
                                />
                                <button
                                  onClick={handleStockSearch}
                                  disabled={stockLoading}
                                  className="rounded-lg bg-accel-primary px-5 text-white hover:bg-accel-hover"
                                >
                                  {stockLoading ? '検索中…' : '検索'}
                                </button>
                              </div>

                              {stockPhotos.length > 0 && (
                                <div className="grid grid-cols-3 gap-2">
                                  {stockPhotos.map((photo) => (
                                    <button
                                      key={photo.id}
                                      onClick={() => {
                                        setEditData({ ...editData, image_url: photo.url })
                                        setStockOpen(false)
                                      }}
                                      className="overflow-hidden rounded-md p-0"
                                    >
                                      <img
                                        src={photo.thumb}
                                        alt={photo.credit}
                                        className="h-20 w-full object-cover"
                                      />
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                          {stockError && <p className="text-sm text-red-700">{stockError}</p>}
                        </div>

                        <div className="flex flex-col gap-2">
                          <label className="text-sm font-semibold text-black">表示順</label>
                          <input
                            type="number"
                            value={editData.order ?? 0}
                            onChange={(e) => setEditData({ ...editData, order: Number(e.target.value) })}
                          />
                        </div>

                        <div className="flex gap-3">
                          <button
                            onClick={() => handleEditSave(app.id)}
                            disabled={saving}
                            className="rounded-lg bg-accel-primary px-6 py-2 text-white hover:bg-accel-hover active:bg-accel-active"
                          >
                            {saving ? '保存中…' : '保存'}
                          </button>
                          <button
                            onClick={handleEditCancel}
                            className="rounded-lg border-2 border-border-soft px-6 py-2 text-black hover:border-accel-secondary"
                          >
                            キャンセル
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {app.image_url && (
                          // 原寸を読むと重い。表示は高さ 160px の帯なので、
                          // Supabase Storage の変換で幅 800px・品質 70 に落として取る。
                          // width/height を書くのはレイアウトのガタつき防止。
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={thumbUrl(app.image_url, 800)}
                            alt=""
                            width={800}
                            height={160}
                            loading="lazy"
                            decoding="async"
                            className="h-40 w-full object-cover bg-surface-muted"
                          />
                        )}
                        <div className="flex items-start justify-between gap-4 p-6">
                          <div className="min-w-0">
                            <h3 className="mb-1">{app.title}</h3>
                            <p className="mb-3 text-sm text-black/80">{app.description}</p>
                            <a
                              href={`https://${app.slug}.accel-dash.com`}
                              className="text-sm break-all underline"
                            >
                              {app.slug}.accel-dash.com →
                            </a>
                          </div>
                          {isAdmin && (
                            <div className="flex shrink-0 gap-1">
                              <button
                                onClick={() => handleEditStart(app)}
                                aria-label="編集"
                                className="rounded-lg p-2 text-black hover:bg-accel-lightest"
                              >
                                <Pencil size={18} />
                              </button>
                              <button
                                onClick={() => setConfirmingApp(app.id)}
                                aria-label="削除"
                                className="rounded-lg p-2 text-red-600 hover:bg-red-50"
                              >
                                <Trash2 size={18} />
                              </button>
                            </div>
                          )}
                        </div>

                        {confirmingApp === app.id && (
                          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-soft bg-red-50 px-6 py-4">
                            <span className="text-sm text-red-800">
                              「{app.title}」を削除しますか？
                            </span>
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleDeleteApp(app.id)}
                                className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700"
                              >
                                削除する
                              </button>
                              <button
                                onClick={() => setConfirmingApp(null)}
                                className="rounded-lg border-2 border-border-soft bg-surface px-4 py-2 text-sm text-black"
                              >
                                やめる
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {tab === 'users' && isAdmin && (
          <section>
            <h2 className="mb-5">ユーザー管理</h2>

            <div className="mb-6 rounded-2xl border border-border-soft bg-surface p-6">
              <label htmlFor="newUser" className="mb-2 block text-sm font-semibold text-black">
                招待するメールアドレス
              </label>
              <div className="flex flex-wrap gap-3">
                <input
                  id="newUser"
                  type="email"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
                  placeholder="name@example.com"
                  className="min-w-[240px] flex-1"
                />
                <button
                  onClick={handleInvite}
                  disabled={inviting}
                  className="flex items-center gap-2 rounded-lg bg-accel-primary px-6 py-3 text-white hover:bg-accel-hover active:bg-accel-active"
                >
                  <Plus size={18} />
                  {inviting ? '送信中…' : '招待'}
                </button>
              </div>
              <p className="mt-3 text-sm text-black/60">
                招待メールのリンクからパスワードを設定してもらいます。
                <br />
                @accel-partners.co.jp は管理者（このタブとアプリ編集が使え、全アプリが見えます）。
                それ以外のアドレスは、下の一覧で「見せるアプリ」にチェックを入れたものだけが見えます。
              </p>
            </div>

            {users.length === 0 ? (
              <p className="text-black/70">ユーザーがありません</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {users.map((user) => (
                  <li
                    key={user.id}
                    className="rounded-xl border border-border-soft bg-surface px-6 py-4"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 font-semibold text-black">
                          <span className="truncate">{user.email}</span>
                          {user.is_me && (
                            <span className="rounded bg-accel-lightest px-2 py-0.5 text-xs font-normal">
                              自分
                            </span>
                          )}
                          <span
                            className={
                              user.is_admin
                                ? 'rounded bg-accel-lightest px-2 py-0.5 text-xs font-normal'
                                : 'rounded bg-surface-muted px-2 py-0.5 text-xs font-normal text-black/60'
                            }
                          >
                            {user.is_admin ? '管理者' : '一般'}
                          </span>
                          {!user.confirmed && (
                            <span className="rounded bg-surface-muted px-2 py-0.5 text-xs font-normal text-black/60">
                              招待中
                            </span>
                          )}
                        </p>
                        <p className="text-sm text-black/60">
                          登録：{new Date(user.created_at).toLocaleDateString('ja-JP')}
                          {user.last_sign_in_at &&
                            ` ／ 最終ログイン：${new Date(user.last_sign_in_at).toLocaleDateString('ja-JP')}`}
                        </p>
                      </div>
                      {!user.is_me && (
                        <button
                          onClick={() => setConfirmingUser(user.id)}
                          aria-label="削除"
                          className="shrink-0 rounded-lg p-2 text-red-600 hover:bg-red-50"
                        >
                          <Trash2 size={18} />
                        </button>
                      )}
                    </div>

                    {/* アプリ権限。管理者は RLS 側で全部見えるので対象外にする */}
                    {!user.is_admin && (
                      <div className="mt-4 rounded-lg bg-surface-muted px-4 py-3">
                        <p className="mb-2 text-sm font-semibold text-black">
                          見せるアプリ
                          {user.app_ids.length === 0 && (
                            <span className="ml-2 font-normal text-black/60">
                              — 現在なし（ログインしても何も表示されません）
                            </span>
                          )}
                        </p>
                        <div className="flex flex-wrap gap-x-5 gap-y-2">
                          {apps.map((app) => (
                            <label
                              key={app.id}
                              className="flex items-center gap-2 text-sm text-black"
                            >
                              <input
                                type="checkbox"
                                checked={user.app_ids.includes(app.id)}
                                onChange={(e) =>
                                  toggleAppAccess(user.id, app.id, e.target.checked)
                                }
                                className="h-4 w-4"
                              />
                              {app.title}
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                    {confirmingUser === user.id && (
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-red-50 px-4 py-3">
                        <span className="text-sm text-red-800">
                          {user.email} を削除しますか？ログインできなくなります。
                        </span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleDeleteUser(user.id)}
                            className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700"
                          >
                            削除する
                          </button>
                          <button
                            onClick={() => setConfirmingUser(null)}
                            className="rounded-lg border-2 border-border-soft bg-surface px-4 py-2 text-sm text-black"
                          >
                            やめる
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </main>
    </div>
  )
}
