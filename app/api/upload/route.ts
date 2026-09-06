import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, requireAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

const BUCKET = 'app-images'
const MAX_BYTES = 5 * 1024 * 1024

function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

async function ensureBucket() {
  const { data } = await supabaseAdmin.storage.getBucket(BUCKET)
  if (data) return
  await supabaseAdmin.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: MAX_BYTES
  })
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return fail(auth.message, auth.status)
  const me = auth.user

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')

  if (!file || typeof file === 'string') return fail('ファイルが見つかりません')
  if (!file.type.startsWith('image/')) return fail('画像ファイルを選んでください')
  if (file.size > MAX_BYTES) return fail('画像は 5MB 以下にしてください')

  await ensureBucket()

  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '')
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false })

  if (error) return fail(error.message, 500)

  const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path)
  return NextResponse.json({ url: data.publicUrl }, { status: 201 })
}
