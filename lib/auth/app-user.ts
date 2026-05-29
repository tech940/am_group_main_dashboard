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

function isTransientDbConnectionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : ''
  const causeCode = typeof error === 'object' && error !== null && 'cause' in error
    && typeof (error as { cause?: unknown }).cause === 'object'
    && (error as { cause?: unknown }).cause !== null
    && 'code' in ((error as { cause?: unknown }).cause as Record<string, unknown>)
    ? String(((error as { cause?: { code?: unknown } }).cause?.code))
    : ''

  return code === 'CONNECT_TIMEOUT'
    || causeCode === 'CONNECT_TIMEOUT'
    || message.includes('CONNECT_TIMEOUT')
    || message.includes('Connection terminated')
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function findAppUserBySupabaseId(supabaseId: string) {
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
    .where(and(eq(users.supabaseId, supabaseId), isNull(users.deletedAt)))
    .limit(1)

  return appUser
}

export async function getAuthenticatedAppUser() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return null
  }

  let appUser: Awaited<ReturnType<typeof findAppUserBySupabaseId>>
  try {
    appUser = await findAppUserBySupabaseId(user.id)
  } catch (error) {
    if (!isTransientDbConnectionError(error)) {
      throw error
    }

    await wait(350)
    appUser = await findAppUserBySupabaseId(user.id)
  }

  if (!appUser || !appUser.isActive) {
    return null
  }

  return appUser satisfies AppUser
}
