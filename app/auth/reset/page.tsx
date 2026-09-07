'use client'

import { useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Mail } from 'lucide-react'

export default function ResetPasswordPage() {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSending(true)

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback`
    })
    setSending(false)

    if (resetError) {
      setError(resetError.message)
      return
    }
    setSent(true)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-accel-lightest p-6">
      <div className="w-full max-w-md rounded-2xl border border-border-soft bg-surface p-10 shadow-sm">
        <div className="mb-9 flex flex-col items-center">
          <img src="/logo.png" alt="ACCEL DASH" className="h-10 w-auto" />
          <h1 className="sr-only">パスワードの再設定</h1>
        </div>

        {sent ? (
          <div className="flex flex-col gap-6">
            <p className="rounded-lg bg-accel-lightest px-4 py-3 text-sm text-black">
              {email} に再設定用のメールを送りました。メール内のリンクから新しいパスワードを設定してください。
            </p>
            <Link href="/login" className="text-center text-sm underline">
              ログイン画面へ戻る
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            <p className="text-sm text-black/70">
              登録済みのメールアドレスを入力してください。パスワード再設定用のリンクをお送りします。
            </p>

            <div className="flex flex-col gap-2">
              <label htmlFor="email" className="text-sm font-semibold text-black">
                メールアドレス
              </label>
              <div className="relative">
                <Mail
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-accel-secondary"
                  size={20}
                />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
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
              disabled={sending}
              className="w-full rounded-lg bg-accel-primary px-4 py-3 text-white hover:bg-accel-hover active:bg-accel-active"
            >
              {sending ? '送信中…' : '再設定メールを送る'}
            </button>

            <Link href="/login" className="text-center text-sm underline">
              ログイン画面へ戻る
            </Link>
          </form>
        )}
      </div>
    </div>
  )
}
