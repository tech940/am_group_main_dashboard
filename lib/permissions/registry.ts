import type { AppUser } from '@/lib/auth/app-user'

export const PERMISSION_ACTIONS = ['view', 'create', 'edit', 'delete', 'approve'] as const

export type PermissionAction = typeof PERMISSION_ACTIONS[number]
export type PermissionRole = AppUser['role']

export type PermissionGroupDefinition = {
  key: string
  name: string
  parentKey: string | null
  description: string
  sortOrder: number
  actions: PermissionAction[]
}

export type PermissionDefinition = {
  key: string
  groupKey: string
  label: string
  description: string
  resource: string
  action: PermissionAction
  sortOrder: number
}

export const PERMISSION_GROUPS: PermissionGroupDefinition[] = [
  {
    key: 'kia',
    name: 'KIA',
    parentKey: null,
    description: 'AM KIA analytics and workshop modules.',
    sortOrder: 10,
    actions: ['view'],
  },
  {
    key: 'tata',
    name: 'Tata',
    parentKey: null,
    description: 'AM Tata branch modules.',
    sortOrder: 11,
    actions: ['view'],
  },
  {
    key: 'hyundai',
    name: 'Hyundai',
    parentKey: null,
    description: 'AM Hyundai branch modules.',
    sortOrder: 12,
    actions: ['view'],
  },
  {
    key: 'honda',
    name: 'Honda',
    parentKey: null,
    description: 'AM Diamond Honda branch modules.',
    sortOrder: 13,
    actions: ['view'],
  },
  {
    key: 'ktm',
    name: 'KTM',
    parentKey: null,
    description: 'AM KTM branch modules.',
    sortOrder: 14,
    actions: ['view'],
  },
  {
    key: 'triumph',
    name: 'Triumph',
    parentKey: null,
    description: 'AM Triumph branch modules.',
    sortOrder: 15,
    actions: ['view'],
  },
  {
    key: 'bajaj',
    name: 'Bajaj',
    parentKey: null,
    description: 'AM Bajaj branch modules.',
    sortOrder: 16,
    actions: ['view'],
  },
  {
    key: 'mg',
    name: 'MG',
    parentKey: null,
    description: 'AM MG branch modules.',
    sortOrder: 17,
    actions: ['view'],
  },
  {
    key: 'kia.business_excellence',
    name: 'Business Excellence',
    parentKey: 'kia',
    description: 'Executive Business Excellence dashboards and reports.',
    sortOrder: 20,
    actions: ['view'],
  },
  {
    key: 'kia.business_excellence.ro_billing',
    name: 'RO Billing',
    parentKey: 'kia.business_excellence',
    description: 'RO Billing Report tables, KPIs, and trends.',
    sortOrder: 21,
    actions: ['view'],
  },
  {
    key: 'kia.business_excellence.workshop_performance',
    name: 'Workshop Performance',
    parentKey: 'kia.business_excellence',
    description: 'Workshop performance KPIs, service type tables, and revenue cards.',
    sortOrder: 22,
    actions: ['view'],
  },
  {
    key: 'kia.business_excellence.open_ro',
    name: 'Open RO',
    parentKey: 'kia.business_excellence',
    description: 'Open repair order aging, delay reasons, and WIP controls.',
    sortOrder: 23,
    actions: ['view'],
  },
  {
    key: 'kia.business_excellence.complaints',
    name: 'Complaints',
    parentKey: 'kia.business_excellence',
    description: 'Complaint analytics, movement, and customer complaint register.',
    sortOrder: 24,
    actions: ['view'],
  },
  {
    key: 'kia.business_excellence.rsa',
    name: 'RSA',
    parentKey: 'kia.business_excellence',
    description: 'RSA add-on analytics sourced from RSA report data.',
    sortOrder: 25,
    actions: ['view'],
  },
  {
    key: 'kia.business_excellence.ew',
    name: 'EW',
    parentKey: 'kia.business_excellence',
    description: 'Extended warranty analytics sourced from EW report data.',
    sortOrder: 26,
    actions: ['view'],
  },
  {
    key: 'kia.business_excellence.mcp',
    name: 'MCP',
    parentKey: 'kia.business_excellence',
    description: 'MCP analytics sourced from MCP report data.',
    sortOrder: 27,
    actions: ['view'],
  },
  {
    key: 'kia.demo_job_cards',
    name: 'Demo Job Cards',
    parentKey: 'kia',
    description: 'Demo vehicle aging, alerts, and job card analytics.',
    sortOrder: 30,
    actions: ['view'],
  },
  {
    key: 'kia.proforma',
    name: 'Kia Proforma',
    parentKey: 'kia',
    description: 'Kia proforma generation, approvals, finance remarks, user database, and analytics.',
    sortOrder: 35,
    actions: ['view', 'create', 'edit', 'approve'],
  },
  {
    key: 'purchase_orders',
    name: 'Purchase Orders',
    parentKey: null,
    description: 'Purchase order workflow and approvals.',
    sortOrder: 40,
    actions: ['view', 'create', 'edit', 'delete', 'approve'],
  },
  {
    key: 'finance_orders',
    name: 'Finance Orders',
    parentKey: null,
    description: 'Finance order workflow, accounts verification, and approvals.',
    sortOrder: 50,
    actions: ['view', 'create', 'edit', 'delete', 'approve'],
  },
  {
    key: 'reports',
    name: 'Reports',
    parentKey: null,
    description: 'Shared operational reports and exports.',
    sortOrder: 60,
    actions: ['view', 'create', 'edit', 'delete'],
  },
  {
    key: 'user_management',
    name: 'User Management',
    parentKey: null,
    description: 'User creation, profile management, branch, brand, and role assignment.',
    sortOrder: 70,
    actions: ['view', 'create', 'edit', 'delete'],
  },
  {
    key: 'access_control',
    name: 'Access Control',
    parentKey: null,
    description: 'Admin permission center and user access overrides.',
    sortOrder: 80,
    actions: ['view', 'edit'],
  },
  {
    key: 'dashboard_settings',
    name: 'Dashboard Settings',
    parentKey: null,
    description: 'Application settings, backup configuration, and dashboard preferences.',
    sortOrder: 90,
    actions: ['view', 'edit'],
  },
]

export const PERMISSIONS: PermissionDefinition[] = PERMISSION_GROUPS.flatMap((group) =>
  group.actions.map((action, index) => ({
    key: `${group.key}.${action}`,
    groupKey: group.key,
    label: `${group.name}: ${action[0].toUpperCase()}${action.slice(1)}`,
    description: `${action[0].toUpperCase()}${action.slice(1)} access for ${group.name}.`,
    resource: group.key,
    action,
    sortOrder: group.sortOrder * 10 + index,
  }))
)

const permissionKeysByGroup = new Map(
  PERMISSION_GROUPS.map((group) => [group.key, group.actions.map((action) => `${group.key}.${action}`)])
)

function keysForGroups(groups: string[], actions?: PermissionAction[]) {
  const actionSet = actions ? new Set(actions) : null
  return groups.flatMap((group) => (permissionKeysByGroup.get(group) || [])
    .filter((key) => {
      if (!actionSet) return true
      const action = key.split('.').at(-1) as PermissionAction | undefined
      return Boolean(action && actionSet.has(action))
    }))
}

const allPermissionKeys = PERMISSIONS.map((permission) => permission.key)

export const ROLE_PERMISSION_TEMPLATE_LABELS: Record<PermissionRole, string> = {
  admin: 'Admin',
  ceo: 'CEO',
  md: 'MD',
  ea: 'EA',
  purchase_manager: 'Purchase Manager',
  finance_head: 'Finance Head',
  accounts: 'Accounts',
  manager: 'Manager',
  technician: 'Technician',
  viewer: 'Employee',
}

export const ROLE_PERMISSION_TEMPLATES: Record<PermissionRole, string[]> = {
  admin: allPermissionKeys,
  ceo: keysForGroups([
    'kia',
    'kia.business_excellence',
    'kia.business_excellence.ro_billing',
    'kia.business_excellence.workshop_performance',
    'kia.business_excellence.open_ro',
    'kia.business_excellence.complaints',
    'kia.business_excellence.rsa',
    'kia.business_excellence.ew',
    'kia.business_excellence.mcp',
    'kia.demo_job_cards',
    'kia.proforma',
    'purchase_orders',
    'finance_orders',
    'reports',
  ], ['view', 'approve']),
  md: keysForGroups([
    'kia',
    'kia.business_excellence',
    'kia.business_excellence.ro_billing',
    'kia.business_excellence.workshop_performance',
    'kia.business_excellence.open_ro',
    'kia.business_excellence.complaints',
    'kia.demo_job_cards',
    'kia.proforma',
    'purchase_orders',
    'finance_orders',
    'reports',
  ], ['view', 'approve']),
  ea: keysForGroups([
    'kia',
    'kia.business_excellence',
    'kia.business_excellence.open_ro',
    'kia.business_excellence.complaints',
    'kia.demo_job_cards',
    'kia.proforma',
    'purchase_orders',
    'finance_orders',
  ], ['view', 'approve']),
  purchase_manager: keysForGroups(['purchase_orders'], ['view', 'create', 'edit']),
  finance_head: keysForGroups(['finance_orders'], ['view', 'create', 'edit']),
  accounts: keysForGroups(['purchase_orders', 'finance_orders'], ['view', 'edit', 'approve']),
  manager: keysForGroups(['kia', 'kia.business_excellence', 'kia.demo_job_cards', 'kia.proforma'], ['view', 'approve']),
  technician: keysForGroups(['kia.demo_job_cards', 'kia.proforma'], ['view', 'create', 'edit']),
  viewer: keysForGroups(['kia.proforma'], ['view', 'create', 'edit']),
}

export function getTemplateMap(role: PermissionRole) {
  const allowed = new Set(ROLE_PERMISSION_TEMPLATES[role] || [])
  return Object.fromEntries(PERMISSIONS.map((permission) => [permission.key, allowed.has(permission.key)]))
}
