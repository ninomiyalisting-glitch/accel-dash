import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const me = await requireAdmin(req)
  if (!me) return NextResponse.json({ error: '権限がありません' }, { status: 403 })

  const key = process.env.UNSPLASH_ACCESS_KEY
  if (!key) {
    return NextResponse.json(
      { error: 'フリー素材検索は未設定です（Vercel に UNSPLASH_ACCESS_KEY を追加してください）' },
      { status: 501 }
    )
  }

  const q = (new URL(req.url).searchParams.get('q') || '').trim()
  if (!q) return NextResponse.json({ error: 'キーワードを入力してください' }, { status: 400 })

  const endpoint = new URL('https://api.unsplash.com/search/photos')
  endpoint.searchParams.set('query', q)
  endpoint.searchParams.set('per_page', '12')
  endpoint.searchParams.set('orientation', 'landscape')
  endpoint.searchParams.set('content_filter', 'high')

  const res = await fetch(endpoint, {
    headers: { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' },
    cache: 'no-store'
  })

  if (!res.ok) {
    return NextResponse.json({ error: `素材の取得に失敗しました (${res.status})` }, { status: 502 })
  }

  const json = await res.json()
  const photos = (json.results ?? []).map((p: any) => ({
    id: p.id,
    thumb: p.urls?.small,
    url: p.urls?.regular,
    credit: p.user?.name ?? '',
    link: p.links?.html ?? ''
  }))

  return NextResponse.json(photos)
}
