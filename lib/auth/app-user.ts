import 'server-only'

import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { createClient } from '@/lib/supabase/server'

export type AppUser = {
  id: string
  supabaseId: string
  email: string
  fullName: string
  role: typeof users.$inferSelect.role
  brand: string | null
  department: string | null
  isActive: boolean
}

export async function getAuthenticatedAppUser() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return null
  }

  const [appUser] = await db
    .select({
      id: users.id,
      supabaseId: users.supabaseId,
      email: users.email,
      fullName: users.fullName,
      role: users.role,
      brand: users.brand,
      department: users.department,
      isActive: users.isActive,
    })
    .from(users)
    .where(and(eq(users.supabaseId, user.id), isNull(users.deletedAt)))
    .limit(1)

  if (!appUser || !appUser.isActive) {
    return null
  }

  return appUser satisfies AppUser
}
