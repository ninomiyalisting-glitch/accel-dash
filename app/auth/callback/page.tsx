'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Lock } from 'lucide-react'

export default function AuthCallbackPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function resolveSession() {
      const code = new URLSearchParams(window.location.search).get('code')
      if (code) {
        await supabase.auth.exchangeCodeForSession(code).catch(() => null)
      }

      const { data } = await supabase.auth.getSession()
      if (cancelled) return

      if (data.session) {
        setEmail(data.session.user.email || '')
        setReady(true)
      } else {
        setError('リンクの有効期限が切れています。管理者に再送を依頼してください。')
        setReady(true)
      }
    }

    resolveSession()
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session && !cancelled) {
        setEmail(session.user.email || '')
        setError('')
        setReady(true)
      }
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('パスワードは 8 文字以上にしてください')
      return
    }
    if (password !== confirm) {
      setError('確認用パスワードが一致しません')
      return
    }

    setSaving(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setSaving(false)

    if (updateError) {
      setError(updateError.message)
      return
    }
    router.push('/')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-accel-lightest p-6">
      <div className="w-full max-w-md rounded-2xl border border-border-soft bg-surface p-10 shadow-sm">
        <div className="mb-8 flex flex-col items-center gap-4">
          <img src="/logo.png" alt="ACCEL DASH" className="h-9 w-auto" />
          <p className="text-center text-sm text-black/70">パスワードを設定してください</p>
        </div>

        {!ready ? (
          <p className="text-center text-black/70">確認中…</p>
        ) : !email ? (
          <div className="flex flex-col gap-6">
            <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
            <a href="/login" className="text-center text-sm underline">
              ログイン画面へ
            </a>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            <p className="text-sm text-black/70">{email}</p>

            <div className="flex flex-col gap-2">
              <label htmlFor="pw" className="text-sm font-semibold text-black">
                新しいパスワード
              </label>
              <div className="relative">
                <Lock
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-accel-secondary"
                  size={20}
                />
                <input
                  id="pw"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="8 文字以上"
                  required
                  className="pl-12"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="pw2" className="text-sm font-semibold text-black">
                確認のためもう一度
              </label>
              <div className="relative">
                <Lock
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-accel-secondary"
                  size={20}
                />
                <input
                  id="pw2"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  className="pl-12"
                />
              </div>
            </div>

            {error && (
              <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
            )}

            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-lg bg-accel-primary px-4 py-3 text-white hover:bg-accel-hover active:bg-accel-active"
            >
              {saving ? '設定中…' : 'パスワードを設定してはじめる'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
