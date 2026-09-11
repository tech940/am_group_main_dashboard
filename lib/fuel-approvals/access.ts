import type { FuelApprovalStatus, FuelApprovalStage } from './types'
import type { AppUser } from '@/lib/auth/app-user'

export function isAccountsRole(role?: string | null): boolean {
  if (!role) return false
  const r = role.trim().toLowerCase()
  return r === 'accounts' || r === 'finance_head' || r === 'finance_team'
}

export function canUserApproveStage(
  user: { id: string; role: string } | null | undefined,
  status: FuelApprovalStatus,
  currentStage: FuelApprovalStage
): boolean {
  if (!user || !user.role) return false
  const role = user.role.trim().toLowerCase()

  // Developer / Superadmin can always approve any stage
  if (role === 'developer' || role === 'admin') return true

  // CEO Approval (Final approval)
  if ((currentStage === 'ceo' || currentStage === 'ed') && (status === 'ceo_pending' || status === 'ceo_on_hold' || status === 'ed_pending' || status === 'ed_on_hold')) {
    return role === 'ceo' || role === 'ed'
  }

  // Legacy fallback support for any older pending statuses
  if (currentStage === 'accounts' && (status === 'accounts_pending' || status === 'accounts_on_hold')) {
    return isAccountsRole(role) || role === 'ceo' || role === 'ed'
  }

  if (currentStage === 'ea' && (status === 'ea_pending' || status === 'ea_on_hold')) {
    return isAccountsRole(role) || role === 'ea' || role === 'eba' || role === 'ceo'
  }

  if (currentStage === 'md' && (status === 'md_pending' || status === 'md_on_hold')) {
    return isAccountsRole(role) || role === 'md' || role === 'ceo'
  }

  if (currentStage === 'hr' && (status === 'hr_pending' || status === 'hr_on_hold')) {
    return isAccountsRole(role) || role === 'hr' || role === 'ea' || role === 'eba' || role === 'ceo'
  }

  return false
}

export function isUserStageApprover(
  user: { id: string; role: string } | null | undefined,
  stage: 'ceo' | 'accounts' | 'ea' | 'md' | 'ed' | 'hr'
): boolean {
  if (!user || !user.role) return false
  const role = user.role.trim().toLowerCase()
  if (role === 'developer' || role === 'admin') return true

  if (stage === 'ceo') return role === 'ceo' || role === 'ed'
  if (stage === 'accounts') return isAccountsRole(role)
  if (stage === 'ea') return role === 'ea' || role === 'eba' || isAccountsRole(role)
  if (stage === 'md') return role === 'md' || isAccountsRole(role)
  if (stage === 'ed') return role === 'ed' || role === 'ceo'
  if (stage === 'hr') return role === 'hr' || role === 'ea' || role === 'eba' || isAccountsRole(role)

  return false
}

export function canUserViewFuelApprovals(user: AppUser | null | undefined): boolean {
  if (!user) return false
  return true
}
