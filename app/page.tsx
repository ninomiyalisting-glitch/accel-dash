'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { signOut } from '@/lib/auth'
import { Pencil, Trash2, LogOut } from 'lucide-react'

interface App {
  id: string
  slug: string
  title: string
  description: string
  image_url: string | null
  category: string
  order: number
}

export default function Home() {
  const router = useRouter()
  const [apps, setApps] = useState<App[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editData, setEditData] = useState<Partial<App>>({})

  useEffect(() => {
    checkAuth()
  }, [])

  async function checkAuth() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      router.push('/login')
      return
    }
    fetchApps()
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
    if (!confirm('Delete this app?')) return
    
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

  async function handleLogout() {
    await signOut()
    router.push('/login')
  }

  if (loading) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">Accel Dash</h1>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
          >
            <LogOut size={20} />
            Logout
          </button>
        </div>

        <div className="grid gap-6">
          {apps.map((app) => (
            <div key={app.id} className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
              {editingId === app.id ? (
                <div className="space-y-4">
                  <input
                    type="text"
                    value={editData.title || app.title}
                    onChange={(e) => setEditData({ ...editData, title: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700"
                    placeholder="Title"
                  />
                  <textarea
                    value={editData.description || app.description}
                    onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700"
                    placeholder="Description"
                    rows={3}
                  />
                  <input
                    type="text"
                    value={editData.image_url || app.image_url || ''}
                    onChange={(e) => setEditData({ ...editData, image_url: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700"
                    placeholder="Image URL"
                  />
                  <input
                    type="number"
                    value={editData.order ?? app.order}
                    onChange={(e) => setEditData({ ...editData, order: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700"
                    placeholder="Order"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleUpdate(app.id)}
                      className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600"
                    >
                      Cancel
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
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}