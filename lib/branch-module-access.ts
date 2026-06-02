import { BRANCH_OPTIONS, hasAllBranchAccess } from '@/lib/branches'
import { PERMISSION_GROUPS, PERMISSIONS } from '@/lib/permissions/registry'

export const BRANCH_MODULE_ACCESS_ROLE_KEEP = 'keep'

export const BRANCH_MODULE_ACCESS_ROLE_OPTIONS = [
  {
    value: 'inherit',
    label: 'Inherit app role',
    description: 'Use the default permissions for the selected global role.',
  },
  {
    value: 'branch_admin',
    label: 'Branch admin',
    description: 'Full module control inside the selected branch only.',
  },
  {
    value: 'branch_none',
    label: 'No branch module access',
    description: 'Lock available sections inside the selected branch.',
  },
  {
    value: 'branch_executive_view',
    label: 'Executive branch view',
    description: 'View all available sections inside the selected branch.',
  },
  {
    value: 'branch_business_analytics',
    label: 'Business analytics',
    description: 'View Business Excellence and reporting sections for the branch.',
  },
  {
    value: 'branch_service',
    label: 'Service',
    description: 'Access service department modules inside the selected branch.',
  },
  {
    value: 'branch_sales',
    label: 'Sales',
    description: 'Access sales department modules inside the selected branch.',
  },
  {
    value: 'branch_h_promise',
    label: 'H Promise',
    description: 'Access H Promise department modules inside the selected branch.',
  },
  {
    value: 'branch_operations',
    label: 'Workshop operations',
    description: 'View workshop, open RO, and operational tracking sections.',
  },
  {
    value: 'branch_customer_ops',
    label: 'Customer operations',
    description: 'View complaint and customer follow-up sections.',
  },
  {
    value: 'branch_proforma_user',
    label: 'Proforma user',
    description: 'View, create, and edit proforma records for the branch.',
  },
  {
    value: 'branch_proforma_approver',
    label: 'Proforma approver',
    description: 'View, create, edit, and approve proforma records for the branch.',
  },
] as const

export const BRANCH_MODULE_ACCESS_ROLE_EDIT_OPTIONS = [
  {
    value: BRANCH_MODULE_ACCESS_ROLE_KEEP,
    label: 'Keep current branch access',
    description: 'Do not change this user permission overrides.',
  },
  ...BRANCH_MODULE_ACCESS_ROLE_OPTIONS,
] as const

export type BranchModuleAccessRoleValue = typeof BRANCH_MODULE_ACCESS_ROLE_OPTIONS[number]['value']
export type BranchModuleAccessRoleEditValue = typeof BRANCH_MODULE_ACCESS_ROLE_EDIT_OPTIONS[number]['value']

const BRANCH_VALUES = BRANCH_OPTIONS.map((branch) => branch.value)

function getBranchPrefixes(branchAccess: string | null | undefined) {
  if (!branchAccess) return []
  if (hasAllBranchAccess(branchAccess)) return BRANCH_VALUES
  return BRANCH_VALUES.includes(branchAccess as typeof BRANCH_VALUES[number]) ? [branchAccess] : []
}

function descendantGroupKeys(rootKey: string) {
  const keys = new Set<string>([rootKey])
  let changed = true

  while (changed) {
    changed = false
    for (const group of PERMISSION_GROUPS) {
      if (group.parentKey && keys.has(group.parentKey) && !keys.has(group.key)) {
        keys.add(group.key)
        changed = true
      }
    }
  }

  return keys
}

function groupKeysForBranch(prefix: string, role: BranchModuleAccessRoleValue) {
  const allBranchGroupKeys = Array.from(new Set(
    PERMISSIONS
      .filter((permission) => permission.groupKey === prefix || permission.groupKey.startsWith(`${prefix}.`))
      .map((permission) => permission.groupKey)
  ))

  if (role === 'branch_admin') return allBranchGroupKeys
  if (role === 'branch_executive_view') return allBranchGroupKeys
  if (role === 'branch_business_analytics') {
    return allBranchGroupKeys.filter((key) => key === prefix || key === `${prefix}.service` || key.startsWith(`${prefix}.business_excellence`))
  }
  if (role === 'branch_service') {
    const serviceKeys = descendantGroupKeys(`${prefix}.service`)
    return allBranchGroupKeys.filter((key) => key === prefix || serviceKeys.has(key))
  }
  if (role === 'branch_sales') {
    const salesKeys = descendantGroupKeys(`${prefix}.sales`)
    return allBranchGroupKeys.filter((key) => key === prefix || salesKeys.has(key))
  }
  if (role === 'branch_h_promise') {
    const hPromiseKeys = descendantGroupKeys(`${prefix}.h_promise`)
    return allBranchGroupKeys.filter((key) => key === prefix || hPromiseKeys.has(key))
  }
  if (role === 'branch_operations') {
    return [
      prefix,
      `${prefix}.service`,
      `${prefix}.business_excellence`,
      `${prefix}.business_excellence.workshop_performance`,
      `${prefix}.business_excellence.open_ro`,
      `${prefix}.demo_job_cards`,
    ]
  }
  if (role === 'branch_customer_ops') {
    return [
      prefix,
      `${prefix}.service`,
      `${prefix}.business_excellence`,
      `${prefix}.business_excellence.complaints`,
      `${prefix}.demo_job_cards`,
    ]
  }
  if (role === 'branch_proforma_user' || role === 'branch_proforma_approver') {
    return [prefix, `${prefix}.service`, `${prefix}.proforma`]
  }

  return []
}

function actionsForRole(role: BranchModuleAccessRoleValue) {
  if (role === 'branch_admin') return new Set(['view', 'create', 'edit', 'delete', 'approve'])
  if (role === 'branch_service') return new Set(['view', 'create', 'edit'])
  if (role === 'branch_sales') return new Set(['view', 'create', 'edit'])
  if (role === 'branch_h_promise') return new Set(['view', 'create', 'edit'])
  if (role === 'branch_proforma_user') return new Set(['view', 'create', 'edit'])
  if (role === 'branch_proforma_approver') return new Set(['view', 'create', 'edit', 'approve'])
  return new Set(['view'])
}

export function isBranchModuleAccessRoleValue(value: unknown): value is BranchModuleAccessRoleValue {
  return typeof value === 'string'
    && BRANCH_MODULE_ACCESS_ROLE_OPTIONS.some((option) => option.value === value)
}

export function isBranchModuleAccessRoleEditValue(value: unknown): value is BranchModuleAccessRoleEditValue {
  return value === BRANCH_MODULE_ACCESS_ROLE_KEEP || isBranchModuleAccessRoleValue(value)
}

export function canUseBranchModuleAccessRole(branchAccess: string | null | undefined) {
  return getBranchPrefixes(branchAccess).length > 0
}

export function buildBranchModuleAccessPermissionChanges(
  branchAccess: string | null | undefined,
  role: BranchModuleAccessRoleValue
) {
  const branchPrefixes = getBranchPrefixes(branchAccess)
  const scopedPermissionKeys = PERMISSIONS
    .filter((permission) => branchPrefixes.some((prefix) => permission.key === `${prefix}.view` || permission.key.startsWith(`${prefix}.`)))
    .map((permission) => permission.key)

  if (role === 'inherit') {
    return Object.fromEntries(scopedPermissionKeys.map((key) => [key, null])) as Record<string, boolean | null>
  }

  const allowedGroupKeys = new Set(branchPrefixes.flatMap((prefix) => groupKeysForBranch(prefix, role)))
  const allowedActions = actionsForRole(role)

  return Object.fromEntries(scopedPermissionKeys.map((key) => {
    const permission = PERMISSIONS.find((item) => item.key === key)
    const allowed = role !== 'branch_none'
      && Boolean(permission && allowedGroupKeys.has(permission.groupKey) && allowedActions.has(permission.action))
    return [key, allowed]
  }))
}
