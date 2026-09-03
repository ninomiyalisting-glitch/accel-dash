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

  useEffect(() => {
    checkAuth()
  }, [])

  async function checkAuth() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      router.push('/login')
      return
    }

    const email = session.user.email || ''
    setIsAdmin(email.endsWith('@accel-partners.co.jp'))
    
    fetchApps()
    if (email.endsWith('@accel-partners.co.jp')) {
      fetchUsers()
    } else {
      setLoading(false)
    }
  }

  async function fetchApps() {
    try {
      const { data, error } = await supabase
        .from('apps')
        .select('*')
        .order('order', { ascending: true })
      
      if (error) throw error
      setApps(data || [])
    } catch (error) {
      console.error('Error fetching apps:', error)
    } finally {
      setLoading(false)
    }
  }

  async function fetchUsers() {
    try {
      const response = await fetch('/api/users')
      if (response.status === 403) {
        console.warn('User management not available')
        return
      }
      if (!response.ok) throw new Error('Failed to fetch users')
      const data = await response.json()
      setUsers(data)
    } catch (error) {
      console.error('Error fetching users:', error)
    }
  }

  async function handleUpdate(id: string) {
    try {
      const { error } = await supabase
        .from('apps')
        .update(editData)
        .eq('id', id)
      
      if (error) throw error
      setEditingId(null)
      fetchApps()
    } catch (error) {
      console.error('Error updating app:', error)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('このアプリを削除しますか？')) return
    
    try {
      const { error } = await supabase
        .from('apps')
        .delete()
        .eq('id', id)
      
      if (error) throw error
      fetchApps()
    } catch (error) {
      console.error('Error deleting app:', error)
    }
  }

  async function handleAddUser() {
    if (!newUserEmail.trim()) return

    setUserLoading(true)
    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newUserEmail.trim() })
      })

      if (!response.ok) {
        const error = await response.json()
        alert(error.error || 'ユーザーの追加に失敗しました')
        return
      }

      setNewUserEmail('')
      fetchUsers()
      alert('ユーザーを追加しました')
    } catch (error) {
      console.error('Error adding user:', error)
      alert('ユーザーの追加に失敗しました')
    } finally {
      setUserLoading(false)
    }
  }

  async function handleDeleteUser(userId: string) {
    if (!confirm('このユーザーを削除しますか？')) return

    try {
      const response = await fetch(`/api/users?id=${userId}`, {
        method: 'DELETE'
      })

      if (!response.ok) throw new Error('Failed to delete user')
      fetchUsers()
    } catch (error) {
      console.error('Error deleting user:', error)
      alert('ユーザーの削除に失敗しました')
    }
  }

  async function handleLogout() {
    await signOut()
    router.push('/login')
  }

  if (loading) {
    return <div className="flex items-center justify-center h-screen">読み込み中...</div>
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">アクセルダッシュ</h1>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
          >
            <LogOut size={20} />
            ログアウト
          </button>
        </div>

        {isAdmin && (
          <div className="flex gap-4 mb-8 border-b border-gray-300 dark:border-gray-700">
            <button
              onClick={() => setTab('apps')}
              className={`px-4 py-2 font-semibold ${
                tab === 'apps'
                  ? 'border-b-2 border-blue-500 text-blue-500'
                  : 'text-gray-600 dark:text-gray-400'
              }`}
            >
              アプリ
            </button>
            <button
              onClick={() => setTab('users')}
              className={`px-4 py-2 font-semibold ${
                tab === 'users'
                  ? 'border-b-2 border-blue-500 text-blue-500'
                  : 'text-gray-600 dark:text-gray-400'
              }`}
            >
              ユーザー
            </button>
          </div>
        )}

        {tab === 'apps' && (
          <div className="grid gap-6">
            {apps.length === 0 ? (
              <div className="text-center text-gray-600 dark:text-gray-400 py-12">
                アプリがありません
              </div>
            ) : (
              apps.map((app) => (
                <div key={app.id} className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
                  {editingId === app.id ? (
                    <div className="space-y-4">
                      <input
                        type="text"
                        value={editData.title || app.title}
                        onChange={(e) => setEditData({ ...editData, title: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700"
                        placeholder="タイトル"
                      />
                      <textarea
                        value={editData.description || app.description}
                        onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700"
                        placeholder="説明"
                        rows={3}
                      />
                      <input
                        type="text"
                        value={editData.image_url || app.image_url || ''}
                        onChange={(e) => setEditData({ ...editData, image_url: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700"
                        placeholder="画像URL"
                      />
                      <input
                        type="number"
                        value={editData.order ?? app.order}
                        onChange={(e) => setEditData({ ...editData, order: parseInt(e.target.value) })}
                        className="w-full px-3 py-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700"
                        placeholder="順序"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleUpdate(app.id)}
                          className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600"
                        >
                          保存
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600"
                        >
                          キャンセル
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h2 className="text-2xl font-bold mb-2">{app.title}</h2>
                        <p className="text-gray-600 dark:text-gray-400 mb-2">{app.description}</p>
                        <a href={`https://${app.slug}.accel-dash.com`} className="text-blue-500 hover:underline">
                          {app.slug}.accel-dash.com →
                        </a>
                      </div>
                      {isAdmin && (
                        <div className="flex gap-2 ml-4">
                          <button
                            onClick={() => {
                              setEditingId(app.id)
                              setEditData(app)
                            }}
                            className="p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                          >
                            <Pencil size={20} />
                          </button>
                          <button
                            onClick={() => handleDelete(app.id)}
                            className="p-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
                          >
                            <Trash2 size={20} />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'users' && isAdmin && (
          <div className="space-y-6">
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
              <h2 className="text-2xl font-bold mb-4">新規ユーザー追加</h2>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  placeholder="user@accel-partners.co.jp"
                  className="flex-1 px-3 py-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700"
                />
                <button
                  onClick={handleAddUser}
                  disabled={userLoading}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-400 flex items-center gap-2"
                >
                  <Plus size={20} />
                  追加
                </button>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
              <h2 className="text-2xl font-bold mb-4">ユーザー一覧 ({users.length})</h2>
              {users.length === 0 ? (
                <div className="text-center text-gray-600 dark:text-gray-400 py-12">
                  ユーザーがありません
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="border-b dark:border-slate-700">
                      <tr>
                        <th className="px-4 py-2">メールアドレス</th>
                        <th className="px-4 py-2">作成日</th>
                        <th className="px-4 py-2">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((user) => (
                        <tr key={user.id} className="border-b dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800">
                          <td className="px-4 py-3">{user.email}</td>
                          <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                            {new Date(user.created_at).toLocaleDateString('ja-JP')}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => handleDeleteUser(user.id)}
                              className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-sm"
                            >
                              削除
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
