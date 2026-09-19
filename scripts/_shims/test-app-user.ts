/**
 * A stand-in for `@/lib/auth/app-user` for route-level verify scripts: the "logged-in user" is whoever the
 * test sets, or nobody. Mapped by tsconfig.discount-verify.json only.
 */
import type { AppUser } from '../../lib/auth/app-user'

export type { AppUser }

let current: AppUser | null = null

export function setTestAppUser(user: AppUser | null) {
  current = user
}

export async function getAuthenticatedAppUser(): Promise<AppUser | null> {
  return current
}

export async function hasSupabaseSession() {
  return current !== null
}

export function clearAppUserCache() {}
export async function clearAppUserCacheAndWait() {}
