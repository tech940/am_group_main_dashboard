import type { AppUser } from '@/lib/auth/app-user'
import type { FuelApprovalStatus, FuelApprovalStage } from './types'

export function canUserApproveStage(
  user: { id: string; role: string } | null | undefined,
  status: FuelApprovalStatus,
  currentStage: FuelApprovalStage
): boolean {
  if (!user || !user.role) return false
  const role = user.role.trim().toLowerCase()

  // Developer / Superadmin can always approve any stage
  if (role === 'developer' || role === 'admin') return true

  if (currentStage === 'ed' && (status === 'ed_pending' || status === 'ed_on_hold')) {
    return role === 'ed'
  }

  if (currentStage === 'hr' && (status === 'hr_pending' || status === 'hr_on_hold')) {
    return role === 'hr'
  }

  if (currentStage === 'md' && (status === 'md_pending' || status === 'md_on_hold')) {
    return role === 'md' || role === 'ceo'
  }

  return false
}

export function isUserStageApprover(
  user: { id: string; role: string } | null | undefined,
  stage: 'ed' | 'hr' | 'md'
): boolean {
  if (!user || !user.role) return false
  const role = user.role.trim().toLowerCase()
  if (role === 'developer' || role === 'admin') return true

  if (stage === 'ed') return role === 'ed'
  if (stage === 'hr') return role === 'hr'
  if (stage === 'md') return role === 'md' || role === 'ceo'

  return false
}

export function canUserViewFuelApprovals(user: AppUser | null | undefined): boolean {
  if (!user) return false
  return true
}
