import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    const appUser = await getAuthenticatedAppUser()
    redirect(appUser?.role === 'md' ? '/purchase-orders' : '/dashboard')
  } else {
    redirect('/auth/login')
  }
}

// Made with Bob
