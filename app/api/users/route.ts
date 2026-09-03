import { supabase } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    
    if (!session?.user?.email?.endsWith('@accel-partners.co.jp')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const users: any[] = []
    
    if (session.user.email) {
      users.push({
        id: session.user.id,
        email: session.user.email,
        created_at: session.user.created_at || new Date().toISOString()
      })
    }

    const { data, error } = await supabase.auth.admin.listUsers()
    
    if (!error && data?.users) {
      const otherUsers = data.users
        .filter(u => u.email !== session.user.email)
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
    const { data: { session } } = await supabase.auth.getSession()
    
    if (!session?.user?.email?.endsWith('@accel-partners.co.jp')) {
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
