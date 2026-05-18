import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq, isNull } from 'drizzle-orm'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// GET - Fetch all users
export async function GET() {
  try {
    const allUsers = await db.select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      role: users.role,
      brand: users.brand,
      department: users.department,
      phoneNumber: users.phoneNumber,
      isActive: users.isActive,
      createdAt: users.createdAt,
    }).from(users).where(isNull(users.deletedAt))

    return NextResponse.json(allUsers)
  } catch (error) {
    console.error('Error fetching users:', error)
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
  }
}

// POST - Create new user
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { email, fullName, password, role, brand, department } = body

    // Validate required fields
    if (!email || !fullName || !password || !role) {
      return NextResponse.json(
        { error: 'Missing required fields: email, fullName, password, role' },
        { status: 400 }
      )
    }

    // Check if user already exists
    const existingUser = await db.select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1)

    if (existingUser.length > 0) {
      return NextResponse.json(
        { error: 'User with this email already exists' },
        { status: 409 }
      )
    }

    // Create user in Supabase Auth first using admin client
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
      }
    })

    if (authError || !authData.user) {
      console.error('Supabase auth error:', authError)
      return NextResponse.json(
        { error: authError?.message || 'Failed to create auth user' },
        { status: 500 }
      )
    }

    // Create user profile in our database
    const [newUser] = await db.insert(users).values({
      supabaseId: authData.user.id,
      email,
      fullName,
      role,
      brand: brand || null,
      department: department || null,
      isActive: true,
    }).returning({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      role: users.role,
      brand: users.brand,
      department: users.department,
      isActive: users.isActive,
      createdAt: users.createdAt,
    })

    return NextResponse.json(newUser, { status: 201 })
  } catch (error) {
    console.error('Error creating user:', error)
    return NextResponse.json(
      { error: 'Failed to create user' },
      { status: 500 }
    )
  }
}

// PUT - Update user
export async function PUT(request: Request) {
  try {
    const body = await request.json()
    const { id, ...updateData } = body

    if (!id) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
    }

    const [updatedUser] = await db.update(users)
      .set({
        ...updateData,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning()

    if (!updatedUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json(updatedUser)
  } catch (error) {
    console.error('Error updating user:', error)
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 })
  }
}

// DELETE - Delete user from both Supabase Auth and database
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
    }

    // Get user's supabaseId before deleting
    const [user] = await db.select({
      id: users.id,
      supabaseId: users.supabaseId,
      email: users.email
    })
      .from(users)
      .where(eq(users.id, id))
      .limit(1)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Delete from Supabase Auth first
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(user.supabaseId)
    
    if (authError) {
      console.error('Error deleting from Supabase Auth:', authError)
      // Continue with database deletion even if auth deletion fails
    }

    // Soft delete from database
    await db.update(users)
      .set({
        deletedAt: new Date(),
        isActive: false
      })
      .where(eq(users.id, id))

    return NextResponse.json({ success: true, message: 'User deleted successfully' })
  } catch (error) {
    console.error('Error deleting user:', error)
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 })
  }
}

// Made with Bob
