import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, requireAdmin, ADMIN_DOMAIN, appUrl } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export async function GET(req: NextRequest) {
  const me = await requireAdmin(req)
  if (!me) return fail('権限がありません', 403)

  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 })
  if (error) return fail(error.message, 500)

  const users = (data?.users ?? [])
    .map((u) => ({
      id: u.id,
      email: u.email ?? '',
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
      confirmed: Boolean(u.email_confirmed_at || u.confirmed_at),
      is_me: u.id === me.id
    }))
    .sort((a, b) => (a.is_me === b.is_me ? a.email.localeCompare(b.email) : a.is_me ? -1 : 1))

  return NextResponse.json(users)
}

export async function POST(req: NextRequest) {
  const me = await requireAdmin(req)
  if (!me) return fail('権限がありません', 403)

  const { email } = await req.json().catch(() => ({ email: '' }))
  const address = String(email || '').trim().toLowerCase()

  if (!address) return fail('メールアドレスを入力してください')
  if (!address.endsWith(ADMIN_DOMAIN)) {
    return fail(`${ADMIN_DOMAIN} のメールアドレスのみ招待できます`)
  }

  const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(address, {
    redirectTo: `${appUrl()}/auth/callback`
  })

  if (error) {
    const already = /already|registered|exists/i.test(error.message)
    return fail(already ? 'このメールアドレスは登録済みです' : error.message, already ? 409 : 500)
  }

  return NextResponse.json({ email: address, message: '招待メールを送信しました' }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const me = await requireAdmin(req)
  if (!me) return fail('権限がありません', 403)

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return fail('ユーザー ID が必要です')
  if (id === me.id) return fail('自分自身は削除できません')

  const { error } = await supabaseAdmin.auth.admin.deleteUser(id)
  if (error) return fail(error.message, 500)

  return NextResponse.json({ success: true })
}
