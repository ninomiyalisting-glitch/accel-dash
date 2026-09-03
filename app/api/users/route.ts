import { supabase } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    
    if (!session?.user?.email?.endsWith('@accel-partners.co.jp')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false })
    
    if (error) throw error
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error fetching users:', error)
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    
    if (!session?.user?.email?.endsWith('@accel-partners.co.jp')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { email } = await req.json()

    if (!email.endsWith('@accel-partners.co.jp')) {
      return NextResponse.json({ error: 'Only @accel-partners.co.jp emails allowed' }, { status: 400 })
    }

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true
    })

    if (error) throw error
    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error('Error creating user:', error)
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    
    if (!session?.user?.email?.endsWith('@accel-partners.co.jp')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('id')

    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 })
    }

    const { error } = await supabase.auth.admin.deleteUser(userId)

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting user:', error)
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 })
  }
}