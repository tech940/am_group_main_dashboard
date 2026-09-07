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

  if (currentStage === 'ceo' && (status === 'ceo_pending' || status === 'ceo_on_hold')) {
    return role === 'ceo'
  }

  if (currentStage === 'ea' && (status === 'ea_pending' || status === 'ea_on_hold')) {
    return role === 'ea' || role === 'eba'
  }

  if (currentStage === 'md' && (status === 'md_pending' || status === 'md_on_hold')) {
    return role === 'md'
  }

  // Legacy fallback support
  if (currentStage === 'ed' && (status === 'ed_pending' || status === 'ed_on_hold')) {
    return role === 'ed' || role === 'ceo'
  }

  if (currentStage === 'hr' && (status === 'hr_pending' || status === 'hr_on_hold')) {
    return role === 'hr' || role === 'ea' || role === 'eba'
  }

  return false
}

export function isUserStageApprover(
  user: { id: string; role: string } | null | undefined,
  stage: 'ceo' | 'ea' | 'md' | 'ed' | 'hr'
): boolean {
  if (!user || !user.role) return false
  const role = user.role.trim().toLowerCase()
  if (role === 'developer' || role === 'admin') return true

  if (stage === 'ceo') return role === 'ceo'
  if (stage === 'ea') return role === 'ea' || role === 'eba'
  if (stage === 'md') return role === 'md'
  if (stage === 'ed') return role === 'ed' || role === 'ceo'
  if (stage === 'hr') return role === 'hr' || role === 'ea' || role === 'eba'

  return false
}

export function canUserViewFuelApprovals(user: AppUser | null | undefined): boolean {
  if (!user) return false
  return true
}
