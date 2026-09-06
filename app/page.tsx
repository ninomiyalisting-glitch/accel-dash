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

      const token = session.access_token
      const res = await fetch('/api/users', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      if (res.ok) {
        const data = await res.json()
        setUsers(data)
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
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const token = session.access_token
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
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

      const token = session.access_token
      const res = await fetch(`/api/users?id=${userId}`, {
        method: 'DELETE',
        headers: { 
          'Authorization': `Bearer ${token}`
        }
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
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>読み込み中...</div>
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#ffffff', color: '#145200', padding: '32px' }}>
      <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <img src="/favicon.ico" alt="Accel Partners" style={{ width: '40px', height: '40px' }} />
            <h1 style={{ fontSize: '32px', fontWeight: 'bold', margin: 0 }}>アクセルダッシュ</h1>
          </div>
          <button
            onClick={handleLogout}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 16px',
              backgroundColor: '#ef4444',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '16px'
            }}
          >
            <LogOut size={20} />
            ログアウト
          </button>
        </div>

        {session?.user?.email && (
          <p style={{ fontSize: '14px', color: '#666', marginBottom: '24px' }}>
            ログイン中：{session.user.email}
          </p>
        )}

        {isAdmin && (
          <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', borderBottom: '1px solid #ddd', paddingBottom: '16px' }}>
            <button
              onClick={() => setTab('apps')}
              style={{
                padding: '12px 16px',
                fontWeight: '600',
                backgroundColor: 'transparent',
                border: 'none',
                borderBottom: tab === 'apps' ? '2px solid #279300' : 'none',
                color: tab === 'apps' ? '#279300' : '#666',
                cursor: 'pointer'
              }}
            >
              アプリ
            </button>
            <button
              onClick={() => setTab('users')}
              style={{
                padding: '12px 16px',
                fontWeight: '600',
                backgroundColor: 'transparent',
                border: 'none',
                borderBottom: tab === 'users' ? '2px solid #279300' : 'none',
                color: tab === 'users' ? '#279300' : '#666',
                cursor: 'pointer'
              }}
            >
              ユーザー
            </button>
          </div>
        )}

        {tab === 'apps' && (
          <div>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '16px' }}>アプリ一覧</h2>
            {apps.length === 0 ? (
              <p style={{ color: '#666' }}>アプリがありません</p>
            ) : (
              <div style={{ display: 'grid', gap: '16px' }}>
                {apps.map((app) => (
                  <div
                    key={app.id}
                    style={{
                      backgroundColor: '#f9f9f9',
                      borderRadius: '8px',
                      padding: '16px',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start'
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      {editingId === app.id ? (
                        <div style={{ display: 'grid', gap: '12px' }}>
                          <input
                            type="text"
                            value={editData.title || app.title}
                            onChange={(e) => setEditData({ ...editData, title: e.target.value })}
                            style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px', width: '100%' }}
                            placeholder="Title"
                          />
                          <textarea
                            value={editData.description || app.description}
                            onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                            style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px', width: '100%', minHeight: '60px' }}
                            placeholder="Description"
                          />
                          <input
                            type="text"
                            value={editData.image_url || app.image_url || ''}
                            onChange={(e) => setEditData({ ...editData, image_url: e.target.value })}
                            style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '4px', width: '100%' }}
                            placeholder="Image URL"
                          />
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              onClick={() => handleEditSave(app.id)}
                              style={{ padding: '8px 16px', backgroundColor: '#22c55e', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                            >
                              保存
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              style={{ padding: '8px 16px', backgroundColor: '#999', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                            >
                              キャンセル
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <h3 style={{ fontSize: '20px', fontWeight: 'bold', margin: '0 0 8px 0' }}>{app.title}</h3>
                          <p style={{ color: '#666', margin: '0 0 8px 0' }}>{app.description}</p>
                          {app.image_url && <img src={app.image_url} alt={app.title} style={{ width: '100%', height: '160px', objectFit: 'cover', borderRadius: '4px', marginBottom: '8px' }} />}
                          <a href={`https://${app.slug}.accel-dash.com`} style={{ color: '#279300', textDecoration: 'underline' }}>{app.slug}.accel-dash.com →</a>
                        </div>
                      )}
                    </div>
                    {isAdmin && !editingId && (
                      <div style={{ display: 'flex', gap: '8px', marginLeft: '16px' }}>
                        <button
                          onClick={() => handleEditStart(app)}
                          style={{ padding: '8px', backgroundColor: 'transparent', color: '#279300', border: 'none', cursor: 'pointer' }}
                        >
                          <Pencil size={20} />
                        </button>
                        <button
                          onClick={() => handleDelete(app.id)}
                          style={{ padding: '8px', backgroundColor: 'transparent', color: '#ef4444', border: 'none', cursor: 'pointer' }}
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
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '16px' }}>ユーザー管理</h2>
            <div style={{ backgroundColor: '#f9f9f9', borderRadius: '8px', padding: '16px', marginBottom: '24px', display: 'flex', gap: '8px' }}>
              <input
                type="email"
                value={newUserEmail}
                onChange={(e) => setNewUserEmail(e.target.value)}
                placeholder="メールアドレス"
                style={{ flex: 1, padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
              />
              <button
                onClick={handleAddUser}
                disabled={userLoading}
                style={{ padding: '8px 16px', backgroundColor: '#279300', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', opacity: userLoading ? 0.6 : 1 }}
              >
                <Plus size={20} style={{ display: 'inline', marginRight: '4px' }} />
                追加
              </button>
            </div>

            {users.length === 0 ? (
              <p style={{ color: '#666' }}>ユーザーがありません</p>
            ) : (
              <div style={{ display: 'grid', gap: '8px' }}>
                {users.map((user) => (
                  <div
                    key={user.id}
                    style={{
                      backgroundColor: '#f9f9f9',
                      borderRadius: '8px',
                      padding: '16px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <div>
                      <p style={{ fontWeight: '600', margin: 0 }}>{user.email}</p>
                      <p style={{ fontSize: '12px', color: '#666', margin: '4px 0 0 0' }}>作成日：{new Date(user.created_at).toLocaleDateString('ja-JP')}</p>
                    </div>
                    {user.email !== session?.user?.email && (
                      <button
                        onClick={() => handleDeleteUser(user.id)}
                        style={{ padding: '8px', backgroundColor: 'transparent', color: '#ef4444', border: 'none', cursor: 'pointer' }}
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
