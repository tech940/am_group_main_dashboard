import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user details from users table using supabase_id
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id, email, full_name, role, brand, department, is_active')
      .eq('supabase_id', user.id)
      .single()

    if (userError || !userData) {
      console.error('Error fetching user data:', userError)
      return NextResponse.json({ 
        error: 'User not found in database',
        details: 'Your account needs to be set up in the users table first.'
      }, { status: 404 })
    }

    return NextResponse.json({
      id: userData.id,
      email: userData.email,
      fullName: userData.full_name,
      role: userData.role,
      brand: userData.brand,
      department: userData.department,
      isActive: userData.is_active
    })
  } catch (error) {
    console.error('Error in GET /api/auth/user:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Made with Bob
