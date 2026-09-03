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
      const res = await fetch('/api/users')
      if (res.ok) {
        const data = await res.json()
        setUsers(data)
      } else if (res.status === 403) {
        console.warn('User fetch skipped: not admin')
      }
    } catch (err) {
      console.error('Error fetching users:', err)
    }
  }

  async function handleEditStart(app: App) {
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
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newUserEmail })
      })
      
      if (res.ok) {
        setNewUserEmail('')
        await fetchUsers()
      } else {
        alert('ユーザー追加に失敗しました')
      }
    } finally {
      setUserLoading(false)
    }
  }

  async function handleDeleteUser(userId: string) {
    try {
      const res = await fetch('/api/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
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
    return <div className="min-h-screen flex items-center justify-center">読み込み中...</div>
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div className="flex items-center gap-4">
            <img src="/favicon.ico" alt="Accel Partners" className="w-10 h-10" />
            <h1 className="text-3xl font-bold">アクセルダッシュ</h1>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
          >
            <LogOut size={20} />
            ログアウト
          </button>
        </div>

        {session?.user?.email && (
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
            ログイン中：{session.user.email}
          </p>
        )}

        {isAdmin && (
          <div className="flex gap-2 mb-6 border-b">
            <button
              onClick={() => setTab('apps')}
              className={`px-4 py-2 font-semibold ${tab === 'apps' ? 'border-b-2 border-blue-500 text-blue-500' : 'text-gray-600 dark:text-gray-400'}`}
            >
              アプリ
            </button>
            <button
              onClick={() => setTab('users')}
              className={`px-4 py-2 font-semibold ${tab === 'users' ? 'border-b-2 border-blue-500 text-blue-500' : 'text-gray-600 dark:text-gray-400'}`}
            >
              ユーザー
            </button>
          </div>
        )}

        {tab === 'apps' && (
          <div>
            <h2 className="text-2xl font-bold mb-4">アプリ一覧</h2>
            {apps.length === 0 ? (
              <p className="text-gray-600 dark:text-gray-400">アプリがありません</p>
            ) : (
              <div className="space-y-4">
                {apps.map((app) => (
                  <div
                    key={app.id}
                    className="bg-white dark:bg-slate-900 rounded-lg p-4 shadow flex justify-between items-start"
                  >
                    <div className="flex-1">
                      {editingId === app.id ? (
                        <div className="space-y-2">
                          <input
                            type="text"
                            value={editData.title || app.title}
                            onChange={(e) => setEditData({ ...editData, title: e.target.value })}
                            className="w-full px-2 py-1 border rounded dark:bg-slate-800 dark:border-slate-700"
                            placeholder="Title"
                          />
                          <textarea
                            value={editData.description || app.description}
                            onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                            className="w-full px-2 py-1 border rounded dark:bg-slate-800 dark:border-slate-700"
                            placeholder="Description"
                            rows={3}
                          />
                          <input
                            type="text"
                            value={editData.image_url || app.image_url || ''}
                            onChange={(e) => setEditData({ ...editData, image_url: e.target.value })}
                            className="w-full px-2 py-1 border rounded dark:bg-slate-800 dark:border-slate-700"
                            placeholder="Image URL"
                          />
                          <input
                            type="number"
                            value={editData.order ?? app.order}
                            onChange={(e) => setEditData({ ...editData, order: parseInt(e.target.value) })}
                            className="w-full px-2 py-1 border rounded dark:bg-slate-800 dark:border-slate-700"
                            placeholder="Order"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleEditSave(app.id)}
                              className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600"
                            >
                              保存
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600"
                            >
                              キャンセル
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <h2 className="text-2xl font-bold mb-2">{app.title}</h2>
                          <p className="text-gray-600 dark:text-gray-400 mb-2">{app.description}</p>
                          {app.image_url && (
                            <img src={app.image_url} alt={app.title} className="w-full h-40 object-cover rounded mb-2" />
                          )}
                          <a href={`https://${app.slug}.accel-dash.com`} className="text-blue-500 hover:underline">{app.slug}.accel-dash.com →</a>
                        </div>
                      )}
                    </div>
                    {isAdmin && !editingId && (
                      <div className="flex gap-2 ml-4">
                        <button
                          onClick={() => handleEditStart(app)}
                          className="p-2 text-blue-500 hover:bg-blue-100 dark:hover:bg-blue-900 rounded"
                        >
                          <Pencil size={20} />
                        </button>
                        <button
                          onClick={() => handleDelete(app.id)}
                          className="p-2 text-red-500 hover:bg-red-100 dark:hover:bg-red-900 rounded"
                        >
                          <Trash2 size={20} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'users' && isAdmin && (
          <div>
            <h2 className="text-2xl font-bold mb-4">ユーザー管理</h2>
            <div className="mb-6 bg-white dark:bg-slate-900 rounded-lg p-4 shadow">
              <div className="flex gap-2">
                <input
                  type="email"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  placeholder="メールアドレス"
                  className="flex-1 px-3 py-2 border rounded dark:bg-slate-800 dark:border-slate-700"
                />
                <button
                  onClick={handleAddUser}
                  disabled={userLoading}
                  className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400"
                >
                  <Plus size={20} className="inline mr-1" />
                  追加
                </button>
              </div>
            </div>

            {users.length === 0 ? (
              <p className="text-gray-600 dark:text-gray-400">ユーザーがありません</p>
            ) : (
              <div className="space-y-2">
                {users.map((user) => (
                  <div
                    key={user.id}
                    className="bg-white dark:bg-slate-900 rounded-lg p-4 shadow flex justify-between items-center"
                  >
                    <div>
                      <p className="font-semibold">{user.email}</p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        作成日：{new Date(user.created_at).toLocaleDateString('ja-JP')}
                      </p>
                    </div>
                    {user.email !== session?.user?.email && (
                      <button
                        onClick={() => handleDeleteUser(user.id)}
                        className="p-2 text-red-500 hover:bg-red-100 dark:hover:bg-red-900 rounded"
                      >
                        <Trash2 size={20} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
