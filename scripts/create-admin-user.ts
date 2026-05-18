/**
 * Script to create an admin user directly in Supabase
 * Run this with: npx tsx scripts/create-admin-user.ts
 */

import { config } from 'dotenv'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

// Load environment variables from .env file
config({ path: resolve(__dirname, '../.env') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function createAdminUser() {
  // User details - CHANGE THESE
  const email = 'admin@amgroup.com'
  const password = 'Admin@123456'
  const fullName = 'Admin User'
  const role = 'admin'

  console.log('🚀 Creating admin user...')
  console.log('Email:', email)
  console.log('Password:', password)
  console.log('Name:', fullName)
  console.log('Role:', role)
  console.log('')

  try {
    // Create Supabase admin client
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })

    // 1. Create user in Supabase Auth
    console.log('📝 Step 1: Creating Supabase Auth user...')
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
      }
    })

    if (authError) {
      console.error('❌ Error creating auth user:', authError.message)
      process.exit(1)
    }

    console.log('✅ Supabase Auth user created!')
    console.log('   User ID:', authData.user.id)
    console.log('')

    // 2. Create user profile in database using Supabase client
    console.log('📝 Step 2: Creating user profile in database...')
    const { data: newUser, error: dbError } = await supabase
      .from('users')
      .insert({
        supabase_id: authData.user.id,
        email,
        full_name: fullName,
        role,
        brand: null, // Admin users have no brand restriction - can access all brands
        is_active: true,
      })
      .select()
      .single()

    if (dbError) {
      console.error('❌ Error creating user profile:', dbError.message)
      console.log('')
      console.log('⚠️  Auth user was created but profile creation failed.')
      console.log('   You may need to manually add the user to the users table.')
      process.exit(1)
    }

    console.log('✅ User profile created in database!')
    console.log('   Database ID:', newUser.id)
    console.log('')

    console.log('🎉 SUCCESS! Admin user created successfully!')
    console.log('')
    console.log('📋 Login Credentials:')
    console.log('   Email:', email)
    console.log('   Password:', password)
    console.log('')
    console.log('🌐 You can now log in at: http://localhost:3000/auth/login')

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

createAdminUser()

// Made with Bob
