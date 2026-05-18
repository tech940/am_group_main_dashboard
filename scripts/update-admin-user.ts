/**
 * Script to update existing admin user with brand field
 * Run this with: npx tsx scripts/update-admin-user.ts
 */

import { config } from 'dotenv'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

// Load environment variables from .env file
config({ path: resolve(__dirname, '../.env') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function updateAdminUser() {
  const email = 'admin@amgroup.com'

  console.log('🚀 Updating admin user...')
  console.log('Email:', email)
  console.log('')

  try {
    // Create Supabase admin client
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })

    // 1. Get the auth user
    console.log('📝 Step 1: Finding Supabase Auth user...')
    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers()
    
    if (listError) {
      console.error('❌ Error listing users:', listError.message)
      process.exit(1)
    }

    const authUser = users.find(u => u.email === email)
    
    if (!authUser) {
      console.error('❌ Auth user not found!')
      console.log('   Please run: npx tsx scripts/create-admin-user.ts')
      process.exit(1)
    }

    console.log('✅ Auth user found!')
    console.log('   User ID:', authUser.id)
    console.log('')

    // 2. Check if user profile exists
    console.log('📝 Step 2: Checking user profile in database...')
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('*')
      .eq('supabase_id', authUser.id)
      .single()

    if (checkError && checkError.code !== 'PGRST116') {
      console.error('❌ Error checking user profile:', checkError.message)
      process.exit(1)
    }

    if (existingUser) {
      // Update existing user
      console.log('✅ User profile exists, updating...')
      const { error: updateError } = await supabase
        .from('users')
        .update({
          brand: null, // Admin users have no brand restriction
          role: 'admin',
          is_active: true,
        })
        .eq('supabase_id', authUser.id)

      if (updateError) {
        console.error('❌ Error updating user profile:', updateError.message)
        process.exit(1)
      }

      console.log('✅ User profile updated!')
    } else {
      // Create new profile
      console.log('⚠️  User profile does not exist, creating...')
      const { error: insertError } = await supabase
        .from('users')
        .insert({
          supabase_id: authUser.id,
          email: authUser.email,
          full_name: authUser.user_metadata?.full_name || 'Admin User',
          role: 'admin',
          brand: null, // Admin users have no brand restriction
          is_active: true,
        })

      if (insertError) {
        console.error('❌ Error creating user profile:', insertError.message)
        process.exit(1)
      }

      console.log('✅ User profile created!')
    }

    console.log('')
    console.log('🎉 SUCCESS! Admin user is ready!')
    console.log('')
    console.log('📋 Login Credentials:')
    console.log('   Email:', email)
    console.log('   Password: Admin@123456')
    console.log('')
    console.log('🌐 You can now log in at: http://localhost:3000/auth/login')

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

updateAdminUser()

// Made with Bob