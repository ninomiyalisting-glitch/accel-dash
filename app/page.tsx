'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { signOut } from '@/lib/auth'
import { Pencil, Trash2, LogOut, Plus } from 'lucide-react'

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
}

export default function Home() {
  const router = useRouter()
  const [apps, setApps] = useState<App[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editData, setEditData] = useState<Partial<App>>({})
  const [isAdmin, setIsAdmin] = useState(false)
  const [tab, setTab] = useState<'apps' | 'users'>('apps')
  const [newUserEmail, setNewUserEmail] = useState('')
  const [userLoading, setUserLoading] = useState(false)
  const [session, setSession] = useState<any>(null)

  useEffect(() => {
    checkAuth()
  }, [])

  async function checkAuth() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      router.push('/login')
      return
    }

    setSession(session)
    const email = session.user.email || ''
    setIsAdmin(email.endsWith('@accel-partners.co.jp'))

    await fetchApps()
    await fetchUsers()
    setLoading(false)
  }

  async function fetchApps() {
    const { data, error } = await supabase
      .from('apps')
      .select('*')
      .order('order', { ascending: true })

    if (!error && data) {
      setApps(data)
    }
  }

  async function fetchUsers() {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const res = await fetch('/api/users', {
        headers: { Authorization: `Bearer ${session.access_token}` }
      })
      if (res.ok) {
        setUsers(await res.json())
      }
    } catch (err) {
      console.error('Error fetching users:', err)
    }
  }

  function handleEditStart(app: App) {
    setEditingId(app.id)
    setEditData(app)
  }

  async function handleEditSave(appId: string) {
    const { error } = await supabase
      .from('apps')
      .update(editData)
      .eq('id', appId)

    if (!error) {
      await fetchApps()
      setEditingId(null)
      setEditData({})
    }
  }

  async function handleDelete(appId: string) {
    const { error } = await supabase
      .from('apps')
      .delete()
      .eq('id', appId)

    if (!error) {
      await fetchApps()
    }
  }

  async function handleAddUser() {
    if (!newUserEmail.trim()) return

    setUserLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const res = await fetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ email: newUserEmail })
      })

      if (res.ok) {
        setNewUserEmail('')
        await fetchUsers()
      }
    } finally {
      setUserLoading(false)
    }
  }

  async function handleDeleteUser(userId: string) {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const res = await fetch(`/api/users?id=${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` }
      })

      if (res.ok) {
        await fetchUsers()
      }
    } catch (err) {
      console.error('Error deleting user:', err)
    }
  }

  async function handleLogout() {
    await signOut()
    router.push('/login')
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-accel-text">
        読み込み中…
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-surface-muted">
      <header className="border-b border-border-soft bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div className="flex items-center gap-3">
            <img src="/favicon.ico" alt="Accel Partners" className="h-9 w-9" />
            <div>
              <h1 className="text-2xl font-bold text-accel-dark">アクセルダッシュ</h1>
              {session?.user?.email && (
                <p className="text-sm text-accel-text/70">
                  ログイン中：{session.user.email}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 rounded-lg border-2 border-border-soft bg-surface px-4 py-2 text-accel-text hover:border-accel-secondary"
          >
            <LogOut size={18} />
            ログアウト
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {isAdmin && (
          <div className="mb-8 flex gap-2 border-b border-border-soft">
            <button
              onClick={() => setTab('apps')}
              className={
                tab === 'apps'
                  ? 'border-b-2 border-accel-primary px-5 py-3 text-accel-primary'
                  : 'border-b-2 border-transparent px-5 py-3 text-accel-text/60 hover:text-accel-text'
              }
            >
              アプリ
            </button>
            <button
              onClick={() => setTab('users')}
              className={
                tab === 'users'
                  ? 'border-b-2 border-accel-primary px-5 py-3 text-accel-primary'
                  : 'border-b-2 border-transparent px-5 py-3 text-accel-text/60 hover:text-accel-text'
              }
            >
              ユーザー
            </button>
          </div>
        )}

        {tab === 'apps' && (
          <section>
            <h2 className="mb-5">アプリ一覧</h2>

            {apps.length === 0 ? (
              <p className="text-accel-text/70">アプリがありません</p>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2">
                {apps.map((app) => (
                  <article
                    key={app.id}
                    className="overflow-hidden rounded-2xl border border-border-soft bg-surface"
                  >
                    {editingId === app.id ? (
                      <div className="flex flex-col gap-4 p-6">
                        <div className="flex flex-col gap-2">
                          <label className="text-sm font-semibold">アプリ名</label>
                          <input
                            type="text"
                            value={editData.title ?? app.title}
                            onChange={(e) => setEditData({ ...editData, title: e.target.value })}
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <label className="text-sm font-semibold">説明</label>
                          <textarea
                            value={editData.description ?? app.description}
                            onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <label className="text-sm font-semibold">画像 URL</label>
                          <input
                            type="text"
                            value={editData.image_url ?? app.image_url ?? ''}
                            onChange={(e) => setEditData({ ...editData, image_url: e.target.value })}
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <label className="text-sm font-semibold">表示順</label>
                          <input
                            type="number"
                            value={editData.order ?? app.order}
                            onChange={(e) => setEditData({ ...editData, order: Number(e.target.value) })}
                          />
                        </div>
                        <div className="flex gap-3">
                          <button
                            onClick={() => handleEditSave(app.id)}
                            className="rounded-lg bg-accel-primary px-5 py-2 text-white hover:bg-accel-hover active:bg-accel-active"
                          >
                            保存
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="rounded-lg border-2 border-border-soft px-5 py-2 text-accel-text hover:border-accel-secondary"
                          >
                            キャンセル
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {app.image_url && (
                          <img
                            src={app.image_url}
                            alt=""
                            className="h-40 w-full object-cover"
                          />
                        )}
                        <div className="flex items-start justify-between gap-4 p-6">
                          <div className="min-w-0">
                            <h3 className="mb-1">{app.title}</h3>
                            <p className="mb-3 text-sm text-accel-text/80">{app.description}</p>
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
                                className="rounded-lg p-2 text-accel-primary hover:bg-accel-lightest"
                              >
                                <Pencil size={18} />
                              </button>
                              <button
                                onClick={() => handleDelete(app.id)}
                                aria-label="削除"
                                className="rounded-lg p-2 text-red-600 hover:bg-red-50"
                              >
                                <Trash2 size={18} />
                              </button>
                            </div>
                          )}
                        </div>
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
              <label htmlFor="newUser" className="mb-2 block text-sm font-semibold">
                招待するメールアドレス
              </label>
              <div className="flex flex-wrap gap-3">
                <input
                  id="newUser"
                  type="email"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  placeholder="name@accel-partners.co.jp"
                  className="min-w-[240px] flex-1"
                />
                <button
                  onClick={handleAddUser}
                  disabled={userLoading}
                  className="flex items-center gap-2 rounded-lg bg-accel-primary px-6 py-3 text-white hover:bg-accel-hover active:bg-accel-active"
                >
                  <Plus size={18} />
                  {userLoading ? '送信中…' : '招待'}
                </button>
              </div>
            </div>

            {users.length === 0 ? (
              <p className="text-accel-text/70">ユーザーがありません</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {users.map((user) => (
                  <li
                    key={user.id}
                    className="flex items-center justify-between gap-4 rounded-xl border border-border-soft bg-surface px-6 py-4"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{user.email}</p>
                      <p className="text-sm text-accel-text/70">
                        登録日：{new Date(user.created_at).toLocaleDateString('ja-JP')}
                      </p>
                    </div>
                    {user.email !== session?.user?.email && (
                      <button
                        onClick={() => handleDeleteUser(user.id)}
                        aria-label="削除"
                        className="shrink-0 rounded-lg p-2 text-red-600 hover:bg-red-50"
                      >
                        <Trash2 size={18} />
                      </button>
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
