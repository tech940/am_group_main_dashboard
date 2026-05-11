import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function getCurrentUser() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  
  if (error || !user) {
    return null
  }
  
  return user
}

export async function requireAuth() {
  const user = await getCurrentUser()
  
  if (!user) {
    redirect('/auth/login')
  }
  
  return user
}

export async function getUserRole() {
  const user = await getCurrentUser()
  
  if (!user) {
    return null
  }
  
  // Fetch user role from database
  // This will be implemented after database schema is created
  return 'viewer' // Default role for now
}
