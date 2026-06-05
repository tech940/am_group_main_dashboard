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
    key: 'platinum',
    name: 'Platinum',
    parentKey: null,
    description: 'AM Platinum branch modules.',
    sortOrder: 13,
    actions: ['view'],
  },
  {
    key: 'honda',
    name: 'Honda',
    parentKey: null,
    description: 'AM Diamond Honda branch modules.',
    sortOrder: 14,
    actions: ['view'],
  },
  {
    key: 'ktm',
    name: 'KTM',
    parentKey: null,
    description: 'AM KTM branch modules.',
    sortOrder: 15,
    actions: ['view'],
  },
  {
    key: 'triumph',
    name: 'Triumph',
    parentKey: null,
    description: 'AM Triumph branch modules.',
    sortOrder: 16,
    actions: ['view'],
  },
  {
    key: 'bajaj',
    name: 'Bajaj',
    parentKey: null,
    description: 'AM Bajaj branch modules.',
    sortOrder: 17,
    actions: ['view'],
  },
  {
    key: 'mg',
    name: 'MG',
    parentKey: null,
    description: 'AM MG branch modules.',
    sortOrder: 18,
    actions: ['view'],
  },
  {
    key: 'kia.service',
    name: 'Service',
    parentKey: 'kia',
    description: 'AM KIA service department modules.',
    sortOrder: 19,
    actions: ['view'],
  },
  {
    key: 'kia.business_excellence',
    name: 'Business Excellence',
    parentKey: 'kia.service',
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
    parentKey: 'kia.service',
    description: 'Demo vehicle aging, alerts, and job card analytics.',
    sortOrder: 30,
    actions: ['view'],
  },
  {
    key: 'kia.service_appointment',
    name: 'Service Appointment',
    parentKey: 'kia.service',
    description: 'AM KIA service appointment register and calendar.',
    sortOrder: 32,
    actions: ['view'],
  },
  {
    key: 'kia.demo_cars_list',
    name: 'Demo Cars List',
    parentKey: 'kia.service',
    description: 'Active test-drive demo stock list and vehicle remarks tracking.',
    sortOrder: 31,
    actions: ['view', 'edit'],
  },
  {
    key: 'kia.proforma',
    name: 'Kia Proforma',
    parentKey: 'kia.service',
    description: 'Kia proforma generation, approvals, finance remarks, user database, and analytics.',
    sortOrder: 35,
    actions: ['view', 'create', 'edit', 'approve'],
  },
  {
    key: 'kia.sales',
    name: 'Sales',
    parentKey: 'kia',
    description: 'AM KIA sales department modules.',
    sortOrder: 36,
    actions: ['view'],
  },
  {
    key: 'kia.h_promise',
    name: 'H Promise',
    parentKey: 'kia',
    description: 'AM KIA H Promise department modules.',
    sortOrder: 37,
    actions: ['view'],
  },
  {
    key: 'hyundai.service',
    name: 'Service',
    parentKey: 'hyundai',
    description: 'AM Hyundai service department modules.',
    sortOrder: 120,
    actions: ['view'],
  },
  {
    key: 'hyundai.repair_orders',
    name: 'Repair Orders',
    parentKey: 'hyundai.business_excellence',
    description: 'AM Hyundai repair order register inside Business Excellence.',
    sortOrder: 123,
    actions: ['view'],
  },
  {
    key: 'hyundai.business_excellence',
    name: 'Business Excellence',
    parentKey: 'hyundai.service',
    description: 'AM Hyundai Business Excellence dashboards and reports.',
    sortOrder: 121,
    actions: ['view'],
  },
  {
    key: 'hyundai.business_excellence.ro_billing',
    name: 'RO Billing',
    parentKey: 'hyundai.business_excellence',
    description: 'AM Hyundai RO Billing Report tables, KPIs, and trends.',
    sortOrder: 124,
    actions: ['view'],
  },
  {
    key: 'hyundai.business_excellence.workshop_performance',
    name: 'Workshop Performance',
    parentKey: 'hyundai.business_excellence',
    description: 'AM Hyundai workshop performance KPIs and service type tables.',
    sortOrder: 125,
    actions: ['view'],
  },
  {
    key: 'hyundai.business_excellence.open_ro',
    name: 'Open RO',
    parentKey: 'hyundai.business_excellence',
    description: 'AM Hyundai open repair order aging and WIP controls.',
    sortOrder: 126,
    actions: ['view'],
  },
  {
    key: 'hyundai.business_excellence.complaints',
    name: 'Complaints',
    parentKey: 'hyundai.business_excellence',
    description: 'AM Hyundai complaint analytics and customer register.',
    sortOrder: 127,
    actions: ['view'],
  },
  {
    key: 'hyundai.business_excellence.rsa',
    name: 'RSA',
    parentKey: 'hyundai.business_excellence',
    description: 'AM Hyundai RSA add-on analytics.',
    sortOrder: 128,
    actions: ['view'],
  },
  {
    key: 'hyundai.business_excellence.ew',
    name: 'EW',
    parentKey: 'hyundai.business_excellence',
    description: 'AM Hyundai extended warranty analytics.',
    sortOrder: 129,
    actions: ['view'],
  },
  {
    key: 'hyundai.business_excellence.mcp',
    name: 'MCP',
    parentKey: 'hyundai.business_excellence',
    description: 'AM Hyundai MCP analytics.',
    sortOrder: 130,
    actions: ['view'],
  },
  {
    key: 'hyundai.demo_job_cards',
    name: 'Demo Job Cards',
    parentKey: 'hyundai.service',
    description: 'AM Hyundai demo vehicle job card tracking.',
    sortOrder: 131,
    actions: ['view'],
  },
  {
    key: 'hyundai.demo_cars_list',
    name: 'Demo Cars List',
    parentKey: 'hyundai.service',
    description: 'AM Hyundai active demo stock list and vehicle details tracking.',
    sortOrder: 132,
    actions: ['view', 'edit'],
  },
  {
    key: 'hyundai.service_appointment',
    name: 'Service Appointment',
    parentKey: 'hyundai.service',
    description: 'AM Hyundai service appointment calendar.',
    sortOrder: 133,
    actions: ['view'],
  },
  {
    key: 'hyundai.proforma',
    name: 'Hyundai Proforma',
    parentKey: 'hyundai.service',
    description: 'AM Hyundai proforma generation, approvals, finance remarks, and analytics.',
    sortOrder: 134,
    actions: ['view', 'create', 'edit', 'approve'],
  },
  {
    key: 'hyundai.sales',
    name: 'Sales',
    parentKey: 'hyundai',
    description: 'AM Hyundai sales department modules.',
    sortOrder: 135,
    actions: ['view'],
  },
  {
    key: 'hyundai.h_promise',
    name: 'H Promise',
    parentKey: 'hyundai',
    description: 'AM Hyundai H Promise department modules.',
    sortOrder: 136,
    actions: ['view'],
  },
  {
    key: 'platinum.service',
    name: 'Service',
    parentKey: 'platinum',
    description: 'AM Platinum service department modules.',
    sortOrder: 140,
    actions: ['view'],
  },
  {
    key: 'platinum.business_excellence',
    name: 'Business Excellence',
    parentKey: 'platinum.service',
    description: 'AM Platinum Business Excellence dashboards and reports.',
    sortOrder: 141,
    actions: ['view'],
  },
  {
    key: 'platinum.business_excellence.ro_billing',
    name: 'RO Billing',
    parentKey: 'platinum.business_excellence',
    description: 'AM Platinum RO Billing Report tables, KPIs, and trends.',
    sortOrder: 142,
    actions: ['view'],
  },
  {
    key: 'platinum.business_excellence.workshop_performance',
    name: 'Workshop Performance',
    parentKey: 'platinum.business_excellence',
    description: 'AM Platinum workshop performance KPIs and service type tables.',
    sortOrder: 143,
    actions: ['view'],
  },
  {
    key: 'platinum.business_excellence.open_ro',
    name: 'Open RO',
    parentKey: 'platinum.business_excellence',
    description: 'AM Platinum open repair order aging and WIP controls.',
    sortOrder: 144,
    actions: ['view'],
  },
  {
    key: 'platinum.business_excellence.complaints',
    name: 'Complaints',
    parentKey: 'platinum.business_excellence',
    description: 'AM Platinum complaint analytics and customer register.',
    sortOrder: 145,
    actions: ['view'],
  },
  {
    key: 'platinum.business_excellence.rsa',
    name: 'RSA',
    parentKey: 'platinum.business_excellence',
    description: 'AM Platinum RSA add-on analytics.',
    sortOrder: 146,
    actions: ['view'],
  },
  {
    key: 'platinum.business_excellence.ew',
    name: 'EW',
    parentKey: 'platinum.business_excellence',
    description: 'AM Platinum extended warranty analytics.',
    sortOrder: 147,
    actions: ['view'],
  },
  {
    key: 'platinum.business_excellence.mcp',
    name: 'MCP',
    parentKey: 'platinum.business_excellence',
    description: 'AM Platinum MCP analytics.',
    sortOrder: 148,
    actions: ['view'],
  },
  {
    key: 'platinum.demo_job_cards',
    name: 'Demo Job Cards',
    parentKey: 'platinum.service',
    description: 'AM Platinum demo vehicle job card tracking.',
    sortOrder: 149,
    actions: ['view'],
  },
  {
    key: 'platinum.demo_cars_list',
    name: 'Demo Cars List',
    parentKey: 'platinum.service',
    description: 'AM Platinum active demo stock list and vehicle details tracking.',
    sortOrder: 150,
    actions: ['view', 'edit'],
  },
  {
    key: 'platinum.service_appointment',
    name: 'Service Appointment',
    parentKey: 'platinum.service',
    description: 'AM Platinum service appointment calendar.',
    sortOrder: 151,
    actions: ['view'],
  },
  {
    key: 'platinum.proforma',
    name: 'Platinum Proforma',
    parentKey: 'platinum.service',
    description: 'AM Platinum proforma generation, approvals, finance remarks, and analytics.',
    sortOrder: 152,
    actions: ['view', 'create', 'edit', 'approve'],
  },
  {
    key: 'platinum.sales',
    name: 'Sales',
    parentKey: 'platinum',
    description: 'AM Platinum sales department modules.',
    sortOrder: 153,
    actions: ['view'],
  },
  {
    key: 'platinum.h_promise',
    name: 'H Promise',
    parentKey: 'platinum',
    description: 'AM Platinum H Promise department modules.',
    sortOrder: 154,
    actions: ['view'],
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
    'kia.service',
    'kia.business_excellence',
    'kia.business_excellence.ro_billing',
    'kia.business_excellence.workshop_performance',
    'kia.business_excellence.open_ro',
    'kia.business_excellence.complaints',
    'kia.business_excellence.rsa',
    'kia.business_excellence.ew',
    'kia.business_excellence.mcp',
    'kia.demo_job_cards',
    'kia.service_appointment',
    'kia.demo_cars_list',
    'kia.proforma',
    'purchase_orders',
    'finance_orders',
    'reports',
  ], ['view', 'approve']),
  md: keysForGroups([
    'kia',
    'kia.service',
    'kia.business_excellence',
    'kia.business_excellence.ro_billing',
    'kia.business_excellence.workshop_performance',
    'kia.business_excellence.open_ro',
    'kia.business_excellence.complaints',
    'kia.demo_job_cards',
    'kia.service_appointment',
    'kia.demo_cars_list',
    'kia.proforma',
    'purchase_orders',
    'finance_orders',
    'reports',
  ], ['view', 'approve']),
  ea: keysForGroups([
    'kia',
    'kia.service',
    'kia.business_excellence',
    'kia.business_excellence.open_ro',
    'kia.business_excellence.complaints',
    'kia.demo_job_cards',
    'kia.service_appointment',
    'kia.demo_cars_list',
    'kia.proforma',
    'purchase_orders',
    'finance_orders',
  ], ['view', 'approve']),
  purchase_manager: keysForGroups(['purchase_orders'], ['view', 'create', 'edit']),
  finance_head: keysForGroups(['finance_orders'], ['view', 'create', 'edit']),
  accounts: keysForGroups(['purchase_orders', 'finance_orders'], ['view', 'edit', 'approve']),
  manager: keysForGroups(['kia', 'kia.service', 'kia.business_excellence', 'kia.demo_job_cards', 'kia.service_appointment', 'kia.demo_cars_list', 'kia.proforma'], ['view', 'approve']),
  technician: keysForGroups(['kia.service', 'kia.demo_job_cards', 'kia.service_appointment', 'kia.demo_cars_list', 'kia.proforma'], ['view', 'create', 'edit']),
  viewer: keysForGroups(['kia.service', 'kia.service_appointment', 'kia.demo_cars_list', 'kia.proforma'], ['view', 'create', 'edit']),
}

export function getTemplateMap(role: PermissionRole) {
  const allowed = new Set(ROLE_PERMISSION_TEMPLATES[role] || [])
  return Object.fromEntries(PERMISSIONS.map((permission) => [permission.key, allowed.has(permission.key)]))
}
