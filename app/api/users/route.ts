import { supabase } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('Authorization')
    
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error } = await supabase.auth.getUser(token)
    
    if (error || !user?.email?.endsWith('@accel-partners.co.jp')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const users: any[] = []
    
    if (user.email) {
      users.push({
        id: user.id,
        email: user.email,
        created_at: user.created_at || new Date().toISOString()
      })
    }

    const { data, error: listError } = await supabase.auth.admin.listUsers()
    
    if (!listError && data?.users) {
      const otherUsers = data.users
        .filter(u => u.email !== user.email)
        .map(u => ({
          id: u.id,
          email: u.email,
          created_at: u.created_at
        }))
      users.push(...otherUsers)
    }
    
    return NextResponse.json(users)
  } catch (error) {
    console.error('Error fetching users:', error)
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('Authorization')
    
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error } = await supabase.auth.getUser(token)
    
    if (error || !user?.email?.endsWith('@accel-partners.co.jp')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { email } = await req.json()

    if (!email.endsWith('@accel-partners.co.jp')) {
      return NextResponse.json({ error: 'Only @accel-partners.co.jp emails allowed' }, { status: 400 })
    }

    const { error: signUpError } = await supabase.auth.signUp({
      email: email,
      password: Math.random().toString(36).slice(-12),
      options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL || 'https://accel-dash.com'}/login`
      }
    })

    if (signUpError) throw signUpError

    return NextResponse.json({ 
      email: email,
      message: '招待メールを送信しました'
    }, { status: 201 })
  } catch (error) {
    console.error('Error creating user:', error)
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const authHeader = req.headers.get('Authorization')
    
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error } = await supabase.auth.getUser(token)
    
    if (error || !user?.email?.endsWith('@accel-partners.co.jp')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('id')

    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 })
    }

    const { error: deleteError } = await supabase.auth.admin.deleteUser(userId)

    if (deleteError) throw deleteError
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting user:', error)
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 })
  }
}
