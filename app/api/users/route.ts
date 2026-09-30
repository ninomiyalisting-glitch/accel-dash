import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, requireAdmin, ADMIN_DOMAIN, appUrl } from '@/lib/supabaseAdmin'
import { isFinanceApp, canManageFinance, FINANCE_OWNER } from '@/lib/financeAccess'

export const dynamic = 'force-dynamic'

function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

/** 財務アプリの apps.id（無ければ null） */
async function financeAppId(): Promise<string | null> {
  const { data } = await supabaseAdmin.from('apps').select('id, slug')
  const app = (data ?? []).find((a) => isFinanceApp(a))
  return app ? String(app.id) : null
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return fail(auth.message, auth.status)
  const me = auth.user

  // ユーザー一覧とアプリ権限は互いに独立しているので同時に取る。
  // 直列にすると Auth の一覧取得を待ってから権限を引くことになり、
  // 管理者の初回表示がその分だけ遅くなる。
  const [usersRes, accessRes, membersRes, finId] = await Promise.all([
    supabaseAdmin.auth.admin.listUsers({ perPage: 200 }),
    supabaseAdmin.from('app_access').select('app_id, user_id'),
    supabaseAdmin.from('finance_members').select('email'),
    financeAppId(),
  ])

  const { data, error } = usersRes
  if (error) return fail(error.message, 500)

  const { data: accessRows, error: accessError } = accessRes
  if (accessError) return fail(`アプリ権限の取得に失敗しました：${accessError.message}`, 500)

  /* 財務は finance_members が正。app_access の行ではなく、こちらで「見られるか」を返す */
  const financeEmails = new Set(
    (membersRes.data ?? []).map((m: { email: string }) => String(m.email).toLowerCase())
  )
  const withFinance = (ids: string[], email: string) => {
    if (!finId) return ids
    const rest = ids.filter((id) => String(id) !== finId)
    return financeEmails.has(email.toLowerCase()) ? [...rest, finId] : rest
  }

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
      app_ids: withFinance(accessByUser.get(u.id) ?? [], u.email ?? '')
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

  /* 財務だけは別扱い：付け外しできるのは FINANCE_OWNER だけで、finance_members を書き換える */
  const finId = await financeAppId()
  if (finId && String(appId) === finId) {
    if (!canManageFinance(me.email)) {
      return fail(`財務の閲覧権限を変更できるのは ${FINANCE_OWNER} だけです`, 403)
    }
    const { data: target, error: targetError } = await supabaseAdmin.auth.admin.getUserById(userId)
    const email = String(target?.user?.email ?? '').trim().toLowerCase()
    if (targetError || !email) return fail('対象のユーザーが見つかりません', 404)

    if (allow) {
      const { error } = await supabaseAdmin
        .from('finance_members')
        .upsert({ email, note: `ポータルで付与（${me.email}）` }, { onConflict: 'email' })
      if (error) return fail(`財務の権限の付与に失敗しました：${error.message}`, 500)
      await supabaseAdmin
        .from('app_access')
        .upsert({ app_id: appId, user_id: userId, granted_by: me.id }, { onConflict: 'app_id,user_id' })
    } else {
      if (email === FINANCE_OWNER) return fail('管理者本人の財務の権限は外せません')
      const { error } = await supabaseAdmin.from('finance_members').delete().ilike('email', email)
      if (error) return fail(`財務の権限の解除に失敗しました：${error.message}`, 500)
      await supabaseAdmin.from('app_access').delete().eq('app_id', appId).eq('user_id', userId)
    }
    return NextResponse.json({ user_id: userId, app_id: appId, allow })
  }

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
