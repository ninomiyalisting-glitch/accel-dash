import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, requireAdmin, ADMIN_DOMAIN, appUrl } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return fail(auth.message, auth.status)
  const me = auth.user

  // ユーザー一覧とアプリ権限は互いに独立しているので同時に取る。
  // 直列にすると Auth の一覧取得を待ってから権限を引くことになり、
  // 管理者の初回表示がその分だけ遅くなる。
  const [usersRes, accessRes] = await Promise.all([
    supabaseAdmin.auth.admin.listUsers({ perPage: 200 }),
    supabaseAdmin.from('app_access').select('app_id, user_id'),
  ])

  const { data, error } = usersRes
  if (error) return fail(error.message, 500)

  const { data: accessRows, error: accessError } = accessRes
  if (accessError) return fail(`アプリ権限の取得に失敗しました：${accessError.message}`, 500)

  const accessByUser = new Map<string, string[]>()
  for (const r of accessRows ?? []) {
    const list = accessByUser.get(r.user_id) ?? []
    list.push(r.app_id)
    accessByUser.set(r.user_id, list)
  }

  const users = (data?.users ?? [])
    .map((u) => ({
      id: u.id,
      email: u.email ?? '',
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
      is_admin: Boolean(u.email?.endsWith(ADMIN_DOMAIN)),
      confirmed: Boolean(u.email_confirmed_at || u.confirmed_at),
      is_me: u.id === me.id,
      app_ids: accessByUser.get(u.id) ?? []
    }))
    .sort((a, b) => (a.is_me === b.is_me ? a.email.localeCompare(b.email) : a.is_me ? -1 : 1))

  return NextResponse.json(users)
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return fail(auth.message, auth.status)
  const me = auth.user

  const { email } = await req.json().catch(() => ({ email: '' }))
  const address = String(email || '').trim().toLowerCase()

  if (!address) return fail('メールアドレスを入力してください')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    return fail('メールアドレスの形式が正しくありません')
  }

  const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(address, {
    redirectTo: `${appUrl()}/auth/callback`
  })

  if (error) {
    const message = error.message || ''

    if (/already|registered|exists/i.test(message)) {
      return fail('このメールアドレスは登録済みです', 409)
    }
    if (/rate limit/i.test(message)) {
      return fail(
        'メール送信の時間あたり上限に達しました。しばらく待つと再送できます。' +
          '続けて招待するには、Supabase に独自の SMTP（Resend など）を設定してください。',
        429
      )
    }
    if (/invalid|format/i.test(message)) {
      return fail('メールアドレスを受け付けられませんでした：' + message, 400)
    }
    return fail(message || '招待に失敗しました', 500)
  }

  return NextResponse.json({ email: address, message: '招待メールを送信しました' }, { status: 201 })
}

/**
 * アプリ権限の付け外し。
 * 担当者（@accel-partners.co.jp）は RLS 側で全アプリが見えるため、
 * ここでの設定は実質それ以外のユーザーに効く。
 */
export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return fail(auth.message, auth.status)
  const me = auth.user

  const body = await req.json().catch(() => null)
  const userId = String((body as Record<string, unknown>)?.user_id ?? '')
  const appId = String((body as Record<string, unknown>)?.app_id ?? '')
  const allow = Boolean((body as Record<string, unknown>)?.allow)

  if (!userId) return fail('ユーザー ID が必要です')
  if (!appId) return fail('アプリ ID が必要です')

  if (allow) {
    const { error } = await supabaseAdmin
      .from('app_access')
      .upsert({ app_id: appId, user_id: userId, granted_by: me.id }, { onConflict: 'app_id,user_id' })
    if (error) return fail(`権限の付与に失敗しました：${error.message}`, 500)
  } else {
    const { error } = await supabaseAdmin
      .from('app_access')
      .delete()
      .eq('app_id', appId)
      .eq('user_id', userId)
    if (error) return fail(`権限の解除に失敗しました：${error.message}`, 500)
  }

  return NextResponse.json({ user_id: userId, app_id: appId, allow })
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return fail(auth.message, auth.status)
  const me = auth.user

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return fail('ユーザー ID が必要です')
  if (id === me.id) return fail('自分自身は削除できません')

  const { error } = await supabaseAdmin.auth.admin.deleteUser(id)
  if (error) return fail(error.message, 500)

  return NextResponse.json({ success: true })
}
