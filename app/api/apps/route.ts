import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, requireAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

const EDITABLE = ['slug', 'title', 'description', 'image_url', 'category', 'status', 'order', 'owner']

function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

function pick(body: Record<string, any>) {
  const out: Record<string, any> = {}
  for (const key of EDITABLE) {
    if (key in body) out[key] = body[key]
  }
  return out
}

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('apps')
    .select('*')
    .order('order', { ascending: true })

  if (error) return fail(error.message, 500)
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return fail(auth.message, auth.status)
  const me = auth.user

  const body = await req.json().catch(() => null)
  if (!body?.id) return fail('アプリ ID が必要です')

  const updates = pick(body)
  if (Object.keys(updates).length === 0) return fail('更新する項目がありません')
  updates.updated_at = new Date().toISOString()

  const { data, error } = await supabaseAdmin
    .from('apps')
    .update(updates)
    .eq('id', body.id)
    .select()
    .single()

  if (error) return fail(error.message, 500)
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return fail(auth.message, auth.status)
  const me = auth.user

  const body = await req.json().catch(() => ({}))
  const values = pick(body)
  if (!values.slug || !values.title) return fail('スラッグとアプリ名は必須です')

  const { data, error } = await supabaseAdmin.from('apps').insert(values).select().single()
  if (error) return fail(error.message, 500)
  return NextResponse.json(data, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return fail(auth.message, auth.status)
  const me = auth.user

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return fail('アプリ ID が必要です')

  const { error } = await supabaseAdmin.from('apps').delete().eq('id', id)
  if (error) return fail(error.message, 500)
  return NextResponse.json({ success: true })
}
