'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Activity,
  Check,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  LayoutGrid,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Upload,
  UserCog,
  Users,
  Wrench,
  X,
} from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AUTO_DEACTIVATION_EXEMPT_ROLES, AUTO_DEACTIVATION_IDLE_DAYS } from '@/lib/auth/user-deactivation-config'
import { BRANCH_OPTIONS } from '@/lib/branches'
import { getBrandDealers } from '@/lib/dealers/registry'
import { getApprovalOnlyBranches } from '@/lib/kia/approval-branches'
import { formatIstDateTime } from '@/lib/date-time'
import { cn } from '@/lib/utils'
import { AccessControlPanel } from './access-control-panel'
import { AccessMap, type AccessMatrixData } from './access-map'
import { RolesPanel, type RolesData } from './roles-panel'

type Capabilities = {
  authority: 'developer' | 'branch_admin'
  branch: string | null
  canManageSettings: boolean
  canManageBranchAdmins: boolean
  canPermanentlyDelete: boolean
  assignableRoles: string[]
}

type ManagedUser = {
  id: string
  email: string
  fullName: string
  role: string
  brand: string | null
  dealers: string | null
  department: string | null
  phoneNumber: string | null
  isActive: boolean
  lastSeenAt: string | null
  idleHours: number | null
  updatedAt: string
  capabilities: {
    canManage: boolean
    canChangePermissions: boolean
    managedBySuperAdmin: boolean
  }
}

// Set rather than .includes() — AUTO_DEACTIVATION_EXEMPT_ROLES is a readonly literal tuple, so
// .includes(someString) does not typecheck against it.
const EXEMPT_FROM_AUTO_DEACTIVATION: ReadonlySet<string> = new Set(AUTO_DEACTIVATION_EXEMPT_ROLES)

/**
 * Shows why an account was (or is about to be) auto-deactivated. Amber marks anyone past the idle
 * window in lib/auth/user-deactivation.ts. This is last ACTIVITY, not last login — the two diverge
 * by weeks because Supabase sessions auto-refresh.
 *
 * Roles in AUTO_DEACTIVATION_EXEMPT_ROLES are excluded from the sweep at the SQL level, so amber on
 * them would assert a deactivation that provably cannot happen — they read a slate "Exempt" chip
 * instead. Exemption is taken from the same constant the sweep filters on, so the two can't drift.
 */
function LastSeenCell({ idleHours, role }: { idleHours: number | null; role: string }) {
  if (idleHours === null) return <span className="text-xs text-slate-400">Never</span>
  if (idleHours < 1) return <span className="text-xs text-slate-600">Just now</span>
  if (idleHours < 24) return <span className="text-xs text-slate-600">{idleHours}h ago</span>

  const days = Math.floor(idleHours / 24)
  const pastWindow = days >= AUTO_DEACTIVATION_IDLE_DAYS

  if (pastWindow && EXEMPT_FROM_AUTO_DEACTIVATION.has(role)) {
    return (
      <span className="flex items-center gap-1.5">
        <span className="text-xs text-slate-600">{days}d ago</span>
        <span
          title={`${ROLE_LABELS[role] || role} is never automatically deactivated, however long it stays idle`}
          className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset', BADGE_TONES.slate)}
        >
          Exempt
        </span>
      </span>
    )
  }

  return (
    <span className={cn('text-xs', pastWindow ? 'font-semibold text-amber-600' : 'text-slate-600')}>
      {days}d ago
    </span>
  )
}

type UsersResponse = {
  users: ManagedUser[]
  actorCapabilities: Capabilities
  summary: {
    totalUsers: number
    administrators: number
    managers: number
    active: number
    inactive: number
  }
}

type PermissionResponse = {
  users: Array<ManagedUser & { branchLabel: string; canManage: boolean }>
  selectedUser: (ManagedUser & { canManage: boolean }) | null
  groups: Array<{ key: string; name: string; parentKey: string | null; description: string; sortOrder?: number }>
  permissions: Array<{ key: string; groupKey: string; label: string; action: string }>
  snapshot: {
    effective: Record<string, boolean>
    roleDefaults: Record<string, boolean>
    overrides: Record<string, boolean>
  }
  actorCapabilities: Capabilities
}

type OverviewResponse = {
  actorCapabilities: Capabilities
  summary: {
    totalUsers: number
    activeUsers: number
    inactiveUsers: number
    administrators: number
    protectedUsers: number
    permissionExceptions: number
  }
  branches: Array<{ branch: string | null; total: number; active: number }>
  recentActivity: Array<{ id: string; action: string; branch: string | null; createdAt: string }>
}

type AuditResponse = {
  actorCapabilities: Capabilities
  source?: 'admin' | 'kia'
  entries: Array<{
    id: string
    action: string
    branch: string | null
    reason: string | null
    createdAt: string
    actor: { fullName: string } | null
    target: { fullName: string } | null
  }>
}

const ROLE_LABELS: Record<string, string> = {
  developer: 'Developer',
  branch_admin: 'Branch Admin',
  admin: 'Legacy Admin',
  ceo: 'CEO',
  md: 'MD',
  ea: 'EA',
  accounts: 'Accounts',
  purchase_manager: 'Purchase Manager',
  finance_head: 'Finance Head',
  manager: 'Manager',
  technician: 'Technician',
  viewer: 'Employee / Viewer',
  service_manager: 'Service Manager',
  general_manager: 'General Sales Manager',
  service_general_manager: 'General Service Manager',
  sales_head: 'Sales Head',
  sales_executive: 'Sales Executive',
  sales_manager: 'Sales Manager',
  finance_team: 'Finance Team',
  eba: 'EBA',
  ed: 'ED (Executive Director)',
  vp: 'VP (Vice President)',
  call_agent: 'Call Agent',
  ca: 'CA',
  // CRM / CRE / CXM / CCM: four roles within one letter of each other, with very different powers
  // (delivery vs follow-ups). Spelled out so they can't be confused in the role dropdown.
  // Keep in step with ROLE_PERMISSION_TEMPLATE_LABELS in lib/permissions/registry.ts — the Users tab
  // reads this map and the Roles tab reads that one, and they must not disagree.
  crm: 'CRM (Relationship Manager) — retired, use CXM',
  idt: 'IDT (Internal Dev Trainee)',
  cre: 'CRE (Relationship Executive)',
  edp: 'EDP (Electronic Data Processing)',
  cxm: 'CXM (Customer Experience) — marks Delivered',
  ccm: 'CCM (Customer Care Manager) — Delivered backup',
  process_coordinator: 'Process Coordinator (PC)',
}

const TAB_DEFINITIONS: Array<{
  key: 'overview' | 'users' | 'branch-admins' | 'access' | 'access-map' | 'roles' | 'audit' | 'sync-logs' | 'system' | 'settings'
  label: string
  icon: typeof Users
  superOnly?: boolean
  // Reachable by deep-link but not shown as its own tab button. 'access' (the granular
  // per-permission editor) is consolidated under 'access-map' — you open it by clicking a
  // user's Edit in the Access Map, so it no longer needs a redundant top-level tab.
  hidden?: boolean
}> = [
  { key: 'overview', label: 'Overview', icon: Activity },
  { key: 'users', label: 'Users', icon: Users },
  { key: 'branch-admins', label: 'Branch Admins', icon: UserCog, superOnly: true },
  { key: 'access', label: 'Access', icon: KeyRound, hidden: true },
  { key: 'access-map', label: 'Access Map', icon: LayoutGrid },
  { key: 'roles', label: 'Roles', icon: ShieldCheck, superOnly: true },
  { key: 'audit', label: 'Audit', icon: ShieldCheck },
  { key: 'sync-logs', label: 'Data Sync Logs', icon: RefreshCw },
  { key: 'system', label: 'System', icon: Wrench, superOnly: true },
  { key: 'settings', label: 'Settings', icon: Settings, superOnly: true },
]

// The only dashboard setting today: dates excluded from KIA Business Excellence working-day math
// (in addition to Sundays). Stored in dashboard_settings as a JSON array of 'YYYY-MM-DD' strings.
const KIA_BE_HOLIDAYS_KEY = 'kiaBusinessExcellenceHolidays'
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function normalizeHolidayList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const valid = value.map((item) => String(item || '').trim()).filter((item) => ISO_DATE_RE.test(item))
  return Array.from(new Set(valid)).sort()
}

function formatHolidayLabel(date: string) {
  const parsed = new Date(`${date}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return date
  return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', weekday: 'short' })
}

function branchLabel(branch: string | null) {
  if (!branch) return 'Unassigned'
  if (branch === 'all') return 'All Branches'
  if (branch.includes(',')) {
    return branch
      .split(',')
      .map((b) => BRANCH_OPTIONS.find((item) => item.value === b.trim())?.label || b)
      .join(', ')
  }
  return BRANCH_OPTIONS.find((item) => item.value === branch)?.label || 'Unassigned'
}

// Semantic accent tones — drawn from the palette already used across the app (badges, pills,
// petty cash). Each admin section / KPI gets a consistent colour so the console reads as a
// colour-coded map rather than a wall of grey.
type AccentTone = 'indigo' | 'emerald' | 'slate' | 'violet' | 'amber' | 'rose' | 'blue' | 'cyan' | 'orange' | 'teal'

const STAT_TONES: Record<AccentTone, { bar: string; chip: string; value: string }> = {
  indigo:  { bar: 'bg-indigo-500',  chip: 'bg-indigo-50 text-indigo-600',   value: 'text-indigo-950' },
  emerald: { bar: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-600', value: 'text-emerald-950' },
  slate:   { bar: 'bg-slate-300',   chip: 'bg-slate-100 text-slate-500',    value: 'text-slate-800' },
  violet:  { bar: 'bg-violet-500',  chip: 'bg-violet-50 text-violet-600',   value: 'text-violet-950' },
  amber:   { bar: 'bg-amber-500',   chip: 'bg-amber-50 text-amber-600',     value: 'text-amber-950' },
  rose:    { bar: 'bg-rose-500',    chip: 'bg-rose-50 text-rose-600',       value: 'text-rose-950' },
  blue:    { bar: 'bg-blue-500',    chip: 'bg-blue-50 text-blue-600',       value: 'text-blue-950' },
  cyan:    { bar: 'bg-cyan-500',    chip: 'bg-cyan-50 text-cyan-600',       value: 'text-cyan-950' },
  orange:  { bar: 'bg-orange-500',  chip: 'bg-orange-50 text-orange-600',   value: 'text-orange-950' },
  teal:    { bar: 'bg-teal-500',    chip: 'bg-teal-50 text-teal-600',       value: 'text-teal-950' },
}

// Per-tab accent — the active pill is filled with the tone, inactive tabs keep a tinted icon so
// every sub-section has a recognisable colour identity.
const TAB_TONES: Record<string, { icon: string; active: string }> = {
  overview:        { icon: 'text-indigo-500',  active: 'bg-indigo-600 hover:bg-indigo-600 ring-indigo-600/20 shadow-indigo-500/30' },
  users:           { icon: 'text-blue-500',    active: 'bg-blue-600 hover:bg-blue-600 ring-blue-600/20 shadow-blue-500/30' },
  'branch-admins': { icon: 'text-cyan-500',    active: 'bg-cyan-600 hover:bg-cyan-600 ring-cyan-600/20 shadow-cyan-500/30' },
  access:          { icon: 'text-violet-500',  active: 'bg-violet-600 hover:bg-violet-600 ring-violet-600/20 shadow-violet-500/30' },
  'access-map':    { icon: 'text-violet-500',  active: 'bg-violet-600 hover:bg-violet-600 ring-violet-600/20 shadow-violet-500/30' },
  roles:           { icon: 'text-amber-500',   active: 'bg-amber-500 hover:bg-amber-500 ring-amber-500/20 shadow-amber-500/30' },
  audit:           { icon: 'text-rose-500',    active: 'bg-rose-600 hover:bg-rose-600 ring-rose-600/20 shadow-rose-500/30' },
  'sync-logs':     { icon: 'text-emerald-500', active: 'bg-emerald-600 hover:bg-emerald-600 ring-emerald-600/20 shadow-emerald-500/30' },
  system:          { icon: 'text-orange-500',  active: 'bg-orange-600 hover:bg-orange-600 ring-orange-600/20 shadow-orange-500/30' },
  settings:        { icon: 'text-teal-500',    active: 'bg-teal-600 hover:bg-teal-600 ring-teal-600/20 shadow-teal-500/30' },
}

function toneFor(key: string) {
  return TAB_TONES[key] || TAB_TONES.overview
}

// Soft badge/avatar styling per tone (tinted fill + inset ring), used for role chips and avatars.
const BADGE_TONES: Record<AccentTone, string> = {
  indigo:  'bg-indigo-50 text-indigo-700 ring-indigo-200',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  slate:   'bg-slate-100 text-slate-600 ring-slate-200',
  violet:  'bg-violet-50 text-violet-700 ring-violet-200',
  amber:   'bg-amber-50 text-amber-700 ring-amber-200',
  rose:    'bg-rose-50 text-rose-700 ring-rose-200',
  blue:    'bg-blue-50 text-blue-700 ring-blue-200',
  cyan:    'bg-cyan-50 text-cyan-700 ring-cyan-200',
  orange:  'bg-orange-50 text-orange-700 ring-orange-200',
  teal:    'bg-teal-50 text-teal-700 ring-teal-200',
}

// Role → tone, grouped by function so the Users table reads as colour families:
// leadership=violet, sales=blue, finance=emerald/teal, service=cyan, ops=amber, rest=slate.
const ROLE_TONE: Record<string, AccentTone> = {
  developer: 'violet', md: 'violet', admin: 'violet', branch_admin: 'violet', ceo: 'violet', ed: 'violet',
  sales_head: 'blue', general_manager: 'blue', sales_manager: 'blue', sales_executive: 'blue',
  finance_head: 'emerald', finance_team: 'emerald', accounts: 'teal',
  service_general_manager: 'cyan', service_manager: 'cyan',
  ea: 'amber', eba: 'amber', purchase_manager: 'amber', manager: 'amber',
  viewer: 'slate', technician: 'slate',
  edp: 'orange',
}

function initialsOf(name: string) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function RoleBadge({ role }: { role: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ring-inset', BADGE_TONES[ROLE_TONE[role] || 'slate'])}>
      {ROLE_LABELS[role] || role}
    </span>
  )
}

// Colour an audit action by intent: destructive=rose, create=emerald, update=amber, else violet.
function auditActionTone(action: string): AccentTone {
  const a = action.toLowerCase()
  if (/(delete|remove|reset|deactivat|revoke|cancel|denied|declin)/.test(a)) return 'rose'
  if (/(creat|add|approv|grant|allocat|activ)/.test(a)) return 'emerald'
  if (/(updat|edit|chang|set|transfer|releas)/.test(a)) return 'amber'
  return 'violet'
}

function ActionBadge({ action }: { action: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-md px-2 py-0.5 font-mono text-xs font-bold ring-1 ring-inset', BADGE_TONES[auditActionTone(action)])}>
      {action}
    </span>
  )
}

// A colour-chipped section heading — a tinted icon tile + title, so each card announces its
// section instead of relying on plain bold text.
function SectionHeading({ icon: Icon, tone, title, subtitle }: { icon: typeof Users; tone: AccentTone; title: string; subtitle?: string }) {
  const t = STAT_TONES[tone]
  return (
    <div className="flex items-center gap-3">
      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', t.chip)}><Icon className="h-4.5 w-4.5" /></span>
      <div>
        <CardTitle className="text-base">{title}</CardTitle>
        {subtitle && <p className="mt-0.5 text-xs font-medium text-slate-500">{subtitle}</p>}
      </div>
    </div>
  )
}

function StatCard({ label, value, icon: Icon, tone = 'indigo' }: { label: string; value: number; icon: typeof Users; tone?: AccentTone }) {
  const t = STAT_TONES[tone]
  return (
    <Card className="relative overflow-hidden border-slate-200/80 bg-white shadow-sm transition-shadow hover:shadow-md">
      <div className={cn('absolute inset-x-0 top-0 h-1', t.bar)} />
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
          <p className={cn('mt-2 text-3xl font-black', t.value)}>{value}</p>
        </div>
        <div className={cn('rounded-2xl p-3', t.chip)}><Icon className="h-5 w-5" /></div>
      </CardContent>
    </Card>
  )
}

function BranchSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const currentValues = value ? value.split(',').map((v) => v.trim()) : [];
  const isAll = currentValues.includes('all');

  const toggleBranch = (branchVal: string) => {
    if (branchVal === 'all') {
      /*
       * A REAL toggle. This used to `onChange('all')` unconditionally, so the box could be ticked
       * but never unticked — and since every individual branch is disabled while it is on, checking
       * "All Branches" left no way back to a specific branch. The control was a one-way trap, which
       * is exactly what blocks pinning a user to their own branch.
       *
       * Unchecking clears the selection to '' — no branch — which is the honest intermediate state
       * while the admin picks the ones they want.
       */
      onChange(isAll ? '' : 'all');
      return;
    }

    // From "all", clicking a single branch NARROWS to just that one rather than doing nothing.
    let nextValues = isAll ? [] : [...currentValues];
    if (nextValues.includes(branchVal)) {
      nextValues = nextValues.filter((v) => v !== branchVal);
    } else {
      nextValues.push(branchVal);
    }

    if (nextValues.length === 0) {
      onChange('');
    } else if (nextValues.length === BRANCH_OPTIONS.length) {
      onChange('all');
    } else {
      onChange(nextValues.join(','));
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3 bg-slate-50">
      <div className="flex items-center gap-2 pb-2 border-b border-slate-200">
        <input
          type="checkbox"
          id="branch-all"
          checked={isAll}
          onChange={() => toggleBranch('all')}
          className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
        />
        <label htmlFor="branch-all" className="text-xs font-semibold text-slate-700">All Branches</label>
      </div>
      <div className="grid grid-cols-2 gap-2 pt-1">
        {BRANCH_OPTIONS.map((branch) => {
          const checked = isAll || currentValues.includes(branch.value);
          return (
            <div key={branch.value} className="flex items-center gap-2">
              <input
                type="checkbox"
                id={`branch-${branch.value}`}
                checked={checked}
                /*
                 * Deliberately NOT disabled while "All Branches" is on. Disabling them is what made
                 * the trap above inescapable, and the narrowing branch in toggleBranch was written
                 * for exactly this click — it was unreachable dead code.
                 */
                onChange={() => toggleBranch(branch.value)}
                className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              />
              <label htmlFor={`branch-${branch.value}`} className="text-xs text-slate-600 font-medium">{branch.label}</label>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function isSingleBrand(brand: string): boolean {
  return Boolean(brand) && brand !== 'all' && !brand.includes(',')
}

// Branch/dealer scope within a single brand. Only shown when the brand has dealer locations
// (KIA, Hyundai, Platinum). No selection = the user sees every branch of the brand.
function DealerSelector({ brand, value, onChange }: { brand: string; value: string[]; onChange: (value: string[]) => void }) {
  /*
   * Registered DMS dealers PLUS approval-only branches.
   *
   * Banihal is a real KIA outlet with no DMS dealer code, so it is absent from getBrandDealers and
   * was therefore impossible to tick — meaning nobody could be granted its payment approvals, and
   * its own staff could not see their own requests. See lib/kia/approval-branches.ts.
   *
   * Safe to offer: getUserDealerScope returns DEALER_SCOPE_NONE for a pin that resolves to no
   * registered dealer, so ticking Banihal fails CLOSED in sales and Business Excellence rather than
   * widening them. It only opens what the approvals scope explicitly honours.
   */
  const options = isSingleBrand(brand)
    ? [
        ...getBrandDealers(brand),
        ...getApprovalOnlyBranches(brand).map((b) => ({ code: b.code, label: `${b.label} — approvals only` })),
      ]
    : []
  if (options.length === 0) return null

  const toggle = (code: string) => {
    onChange(value.includes(code) ? value.filter((v) => v !== code) : [...value, code])
  }

  return (
    <div>
      <Label className="mb-1.5 block">Branch scope <span className="font-normal text-slate-400">— leave empty for all branches</span></Label>
      <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
        {options.map((dealer) => (
          <label key={dealer.code} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={value.includes(dealer.code)}
              onChange={() => toggle(dealer.code)}
              className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            />
            <span className="text-xs font-medium text-slate-600">{dealer.label} <span className="text-slate-400">({dealer.code})</span></span>
          </label>
        ))}
      </div>
    </div>
  )
}

export function AdminConsole() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const requestedTab = searchParams.get('tab') || 'overview'
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null)
  const [overview, setOverview] = useState<OverviewResponse | null>(null)
  const [usersData, setUsersData] = useState<UsersResponse | null>(null)
  const [permissionsData, setPermissionsData] = useState<PermissionResponse | null>(null)
  const [accessMatrix, setAccessMatrix] = useState<AccessMatrixData | null>(null)
  const [rolesData, setRolesData] = useState<RolesData | null>(null)
  const [auditData, setAuditData] = useState<AuditResponse | null>(null)
  const [auditSource, setAuditSource] = useState<'admin' | 'kia'>('admin')
  const [syncLogs, setSyncLogs] = useState<{
    kia: Array<{ table: string; label: string; lastUpdated: string | null; rowCount: number }>
    hyundai: Array<{ table: string; label: string; lastUpdated: string | null; rowCount: number }>
    platinum: Array<{ table: string; label: string; lastUpdated: string | null; rowCount: number }>
  } | null>(null)
  const [systemCounts, setSystemCounts] = useState<{ bookings: number; activity: number; allocations: number; transfers: number; retailMarks: number } | null>(null)
  const [emailLogs, setEmailLogs] = useState<{
    counts: { pending: number; sent: number; failed: number; total: number }
    last24h: { total: number; failed: number }
    rows: Array<{ id: string; customerEmail: string; subject: string; emailType: string | null; status: string; error: string | null; sentAt: string | null; createdAt: string }>
  } | null>(null)
  const [resetting, setResetting] = useState(false)
  const [settingsData, setSettingsData] = useState<Record<string, unknown> | null>(null)
  const [holidays, setHolidays] = useState<string[]>([])
  const [newHoliday, setNewHoliday] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createStep, setCreateStep] = useState(1)
  const [createForm, setCreateForm] = useState({
    fullName: '',
    email: '',
    password: '',
    role: 'viewer',
    brand: '',
    dealers: [] as string[],
    department: '',
  })
  const [saving, setSaving] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState(searchParams.get('user') || '')
  const [permissionChanges, setPermissionChanges] = useState<Record<string, boolean | null>>({})
  const [editUser, setEditUser] = useState<ManagedUser | null>(null)
  const [editForm, setEditForm] = useState({ fullName: '', email: '', password: '', role: '', brand: '', dealers: [] as string[], department: '', phoneNumber: '' })

  const activeTab = useMemo(() => {
    const definition = TAB_DEFINITIONS.find((item) => item.key === requestedTab)
    if (!definition) return 'overview'
    if (definition.superOnly && capabilities?.authority !== 'developer') return 'overview'
    return definition.key
  }, [requestedTab, capabilities])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const endpoint = activeTab === 'overview'
        ? '/api/admin/overview'
        : activeTab === 'users' || activeTab === 'branch-admins'
          ? '/api/admin/users?pageSize=100'
          : activeTab === 'access'
            ? `/api/admin/permissions${selectedUserId ? `?userId=${selectedUserId}` : ''}`
            : activeTab === 'access-map'
              ? '/api/admin/access-matrix'
            : activeTab === 'roles'
              ? '/api/admin/roles'
            : activeTab === 'audit'
              ? `/api/admin/audit?pageSize=50&source=${auditSource}`
              : activeTab === 'sync-logs'
                ? '/api/admin/data-freshness'
                : activeTab === 'system'
                  ? '/api/admin/reset-test-data'
                  : '/api/admin/settings'
      const response = await fetch(endpoint, { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Unable to load the Admin Console.')

      if (activeTab === 'overview') {
        setOverview(payload)
        setCapabilities(payload.actorCapabilities)
      } else if (activeTab === 'users' || activeTab === 'branch-admins') {
        setUsersData(payload)
        setCapabilities(payload.actorCapabilities)
      } else if (activeTab === 'access') {
        setPermissionsData(payload)
        setCapabilities(payload.actorCapabilities)
        setSelectedUserId(payload.selectedUser?.id || '')
        setPermissionChanges({})
      } else if (activeTab === 'access-map') {
        setAccessMatrix(payload)
        setCapabilities(payload.actorCapabilities)
      } else if (activeTab === 'roles') {
        setRolesData(payload)
        setCapabilities(payload.actorCapabilities)
      } else if (activeTab === 'audit') {
        setAuditData(payload)
        setCapabilities(payload.actorCapabilities)
      } else if (activeTab === 'sync-logs') {
        setSyncLogs(payload)
        setCapabilities(payload.actorCapabilities)
      } else if (activeTab === 'system') {
        setSystemCounts(payload.counts)
        const emailResponse = await fetch('/api/admin/email-logs', { cache: 'no-store' })
        if (emailResponse.ok) setEmailLogs(await emailResponse.json())
      } else {
        setSettingsData(payload)
        setHolidays(normalizeHolidayList((payload as Record<string, unknown>)?.[KIA_BE_HOLIDAYS_KEY]))
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load the Admin Console.')
    } finally {
      setLoading(false)
    }
  }, [activeTab, selectedUserId, auditSource])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const visibleTabs = TAB_DEFINITIONS.filter((tab) => !tab.hidden && (!tab.superOnly || capabilities?.authority === 'developer'))
  const filteredUsers = (usersData?.users || []).filter((user) => {
    if (activeTab === 'branch-admins' && user.role !== 'branch_admin') return false
    const query = search.trim().toLowerCase()
    return !query || `${user.fullName} ${user.email} ${user.role} ${user.brand}`.toLowerCase().includes(query)
  })

  async function createUser() {
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...createForm,
          brand: capabilities?.authority === 'branch_admin' ? capabilities.branch : createForm.brand,
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Failed to create user.')
      setCreateOpen(false)
      setCreateStep(1)
      setCreateForm({ fullName: '', email: '', password: '', role: 'viewer', brand: '', dealers: [], department: '' })
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to create user.')
    } finally {
      setSaving(false)
    }
  }

  async function setUserActive(user: ManagedUser, isActive: boolean) {
    setSaving(true)
    try {
      const response = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: user.id, isActive, expectedUpdatedAt: user.updatedAt }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Failed to update user.')
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to update user.')
    } finally {
      setSaving(false)
    }
  }

  function openEditUser(user: ManagedUser) {
    setEditUser(user)
    setEditForm({
      fullName: user.fullName,
      email: user.email,
      password: '',
      role: user.role,
      brand: user.brand || '',
      dealers: user.dealers ? user.dealers.split(',').map((code) => code.trim()).filter(Boolean) : [],
      department: user.department || '',
      phoneNumber: user.phoneNumber || '',
    })
  }

  async function updateUser() {
    if (!editUser) return
    setSaving(true)
    try {
      const response = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editUser.id,
          expectedUpdatedAt: editUser.updatedAt,
          fullName: editForm.fullName,
          department: editForm.department,
          phoneNumber: editForm.phoneNumber,
          ...(capabilities?.authority === 'developer' ? {
            role: editForm.role,
            brand: editForm.brand,
            dealers: editForm.dealers,
            email: editForm.email,
            ...(editForm.password ? { password: editForm.password } : {}),
          } : {}),
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Failed to update user.')
      setEditUser(null)
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to update user.')
    } finally {
      setSaving(false)
    }
  }

  async function permanentlyDeleteUser(user: ManagedUser) {
    if (!window.confirm(`Permanently delete ${user.fullName}? This cannot be undone.`)) return
    setSaving(true)
    try {
      const response = await fetch(`/api/admin/users?id=${encodeURIComponent(user.id)}`, { method: 'DELETE' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Failed to permanently delete user.')
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to permanently delete user.')
    } finally {
      setSaving(false)
    }
  }

  async function savePermissions() {
    if (!permissionsData?.selectedUser || !Object.keys(permissionChanges).length) return
    setSaving(true)
    try {
      const response = await fetch('/api/admin/permissions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: permissionsData.selectedUser.id,
          permissions: permissionChanges,
          reason: 'Updated from hierarchical Admin Console',
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Failed to save permissions.')
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save permissions.')
    } finally {
      setSaving(false)
    }
  }


  async function resetTestData() {
    const c = systemCounts
    const summary = c ? `${c.bookings} bookings, ${c.allocations} allocations, ${c.transfers} transfers, ${c.retailMarks} retail markers` : 'all test bookings and allocations'
    if (!window.confirm(`Reset test data?\n\nThis permanently deletes:\n• ${summary}\n\nProformas, users and real inventory are NOT touched. A record is written to the audit log. This cannot be undone.`)) return
    setResetting(true)
    setError('')
    try {
      const response = await fetch('/api/admin/reset-test-data', { method: 'POST' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Failed to reset test data.')
      setSystemCounts(payload.counts)
      window.alert(`Test data reset. Removed ${payload.removed.bookings} bookings, ${payload.removed.allocations} allocations, ${payload.removed.transfers} transfers and ${payload.removed.retailMarks} retail markers.`)
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Failed to reset test data.')
    } finally {
      setResetting(false)
    }
  }

  // Persist the KIA BE holidays list. The settings PUT merges per-key, so sending only this key
  // leaves any other stored settings untouched.
  async function persistHolidays(next: string[]) {
    const normalized = normalizeHolidayList(next)
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { [KIA_BE_HOLIDAYS_KEY]: normalized } }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Failed to save settings.')
      setHolidays(normalized)
      setSettingsData((current) => ({ ...(current || {}), [KIA_BE_HOLIDAYS_KEY]: normalized }))
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save settings.')
    } finally {
      setSaving(false)
    }
  }

  async function addHoliday() {
    const date = newHoliday.trim()
    if (!ISO_DATE_RE.test(date) || holidays.includes(date)) return
    await persistHolidays([...holidays, date])
    setNewHoliday('')
  }

  async function removeHoliday(date: string) {
    await persistHolidays(holidays.filter((item) => item !== date))
  }

  return (
    <MainLayout title="Admin Console" subtitle={capabilities?.authority === 'branch_admin' ? `${branchLabel(capabilities.branch)} administration` : 'Group-wide access governance'}>
      <div className="mx-auto max-w-[1600px] space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white/80 p-2 shadow-sm backdrop-blur">
          <div className="flex flex-wrap gap-1">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon
              const tone = toneFor(tab.key)
              const isActive = activeTab === tab.key
              return (
                <Button
                  key={tab.key}
                  variant="ghost"
                  onClick={() => router.replace(`/admin?tab=${tab.key}`)}
                  className={cn(
                    'gap-2 rounded-xl font-semibold transition-all',
                    isActive
                      ? cn('text-white shadow-md ring-1 hover:text-white', tone.active)
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  )}
                >
                  <Icon className={cn('h-4 w-4', isActive ? 'text-white' : tone.icon)} /> {tab.label}
                </Button>
              )
            })}
          </div>
          <div className="flex items-center gap-2 px-2">
            <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
              {capabilities?.authority === 'branch_admin' ? 'Branch Admin' : 'Developer'}
            </Badge>
            <Button variant="ghost" size="icon" onClick={() => void load()}><RefreshCw className="h-4 w-4" /></Button>
          </div>
        </div>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>}
        {loading ? (
          <div className="flex min-h-[420px] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" /></div>
        ) : (
          <>
            {activeTab === 'overview' && overview && (
              <div className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                  <StatCard label="Users" value={overview.summary.totalUsers} icon={Users} tone="indigo" />
                  <StatCard label="Active" value={overview.summary.activeUsers} icon={Check} tone="emerald" />
                  <StatCard label="Inactive" value={overview.summary.inactiveUsers} icon={Activity} tone="slate" />
                  <StatCard label="Administrators" value={overview.summary.administrators} icon={Shield} tone="violet" />
                  <StatCard label="Permission Exceptions" value={overview.summary.permissionExceptions} icon={KeyRound} tone="amber" />
                </div>
                <div className="grid gap-5 lg:grid-cols-2">
                  <Card className="overflow-hidden">
                    <CardHeader><SectionHeading icon={LayoutGrid} tone="blue" title="Branch Distribution" subtitle="Active vs. total users per branch" /></CardHeader>
                    <CardContent className="space-y-2.5">
                      {overview.branches.map((row) => {
                        const ratio = row.total > 0 ? Math.round((row.active / row.total) * 100) : 0
                        return (
                          <div key={row.branch || 'none'} className="rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3">
                            <div className="flex items-center justify-between">
                              <span className="flex items-center gap-2 font-semibold text-slate-700">
                                <span className="h-2 w-2 rounded-full bg-blue-500" />{branchLabel(row.branch)}
                              </span>
                              <span className="text-sm font-semibold text-slate-500"><span className="text-emerald-600">{row.active}</span> / {row.total}</span>
                            </div>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
                              <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500" style={{ width: `${ratio}%` }} />
                            </div>
                          </div>
                        )
                      })}
                    </CardContent>
                  </Card>
                  <Card className="overflow-hidden">
                    <CardHeader><SectionHeading icon={Activity} tone="rose" title="Recent Administrative Activity" subtitle="Latest changes across the console" /></CardHeader>
                    <CardContent className="space-y-2.5">
                      {overview.recentActivity.length ? overview.recentActivity.map((entry) => (
                        <div key={entry.id} className="rounded-xl border border-slate-100 border-l-[3px] border-l-rose-400 bg-white px-4 py-3">
                          <p className="font-semibold text-slate-800">{entry.action}</p>
                          <p className="mt-1 text-xs text-slate-500">{branchLabel(entry.branch)} · {formatIstDateTime(entry.createdAt)}</p>
                        </div>
                      )) : <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center text-sm text-slate-500">No administrative activity recorded yet.</p>}
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}

            {(activeTab === 'users' || activeTab === 'branch-admins') && usersData && (
              <Card>
                <CardHeader className="flex-row items-center justify-between gap-4">
                  <SectionHeading
                    icon={activeTab === 'branch-admins' ? UserCog : Users}
                    tone={activeTab === 'branch-admins' ? 'cyan' : 'blue'}
                    title={activeTab === 'branch-admins' ? 'Branch Administrators' : 'Users'}
                    subtitle="Authority is enforced by the server for every action."
                  />
                  <Button onClick={() => {
                    setCreateForm((current) => ({
                      ...current,
                      role: activeTab === 'branch-admins'
                        ? 'branch_admin'
                        : (usersData.actorCapabilities.assignableRoles.includes('viewer') ? 'viewer' : usersData.actorCapabilities.assignableRoles[0] || 'viewer'),
                      brand: capabilities?.branch || '',
                    }))
                    setCreateOpen(true)
                  }} className="gap-2">
                    <Plus className="h-4 w-4" /> Add {activeTab === 'branch-admins' ? 'Branch Admin' : 'User'}
                  </Button>
                </CardHeader>
                <CardContent>
                  <div className="mb-4 flex max-w-md items-center gap-2 rounded-xl border bg-white px-3">
                    <Search className="h-4 w-4 text-slate-400" />
                    <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search users..." className="border-0 shadow-none focus-visible:ring-0" />
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full text-sm">
                      <thead className="bg-gradient-to-r from-blue-50 to-slate-50 text-left text-xs font-bold uppercase tracking-wide text-blue-700/80">
                        <tr className="border-b-2 border-blue-100"><th className="p-3">User</th><th className="p-3">Role</th><th className="p-3">Branch</th><th className="p-3">Department</th><th className="p-3">Status</th><th className="p-3">Last Active</th><th className="p-3 text-right">Actions</th></tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredUsers.map((user) => (
                          <tr key={user.id} className="transition-colors even:bg-slate-50/40 hover:bg-blue-50/50">
                            <td className="p-3">
                              <div className="flex items-center gap-3">
                                <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-black ring-1 ring-inset', BADGE_TONES[ROLE_TONE[user.role] || 'slate'])}>{initialsOf(user.fullName)}</span>
                                <div><p className="font-semibold text-slate-900">{user.fullName}</p><p className="text-xs text-slate-500">{user.email}</p></div>
                              </div>
                            </td>
                            <td className="p-3"><RoleBadge role={user.role} /></td>
                            <td className="p-3 font-medium text-slate-600">{branchLabel(user.brand)}</td>
                            <td className="p-3 text-slate-600">{user.department || '-'}</td>
                            <td className="p-3"><Badge className={user.isActive ? 'bg-emerald-100 text-emerald-700 ring-1 ring-inset ring-emerald-200' : 'bg-slate-100 text-slate-500 ring-1 ring-inset ring-slate-200'}>{user.isActive ? '● Active' : '○ Inactive'}</Badge></td>
                            <td className="p-3"><LastSeenCell idleHours={user.idleHours} role={user.role} /></td>
                            <td className="p-3 text-right">
                              {user.capabilities.canManage ? (
                                <div className="flex justify-end gap-2">
                                  <Button size="sm" variant="outline" disabled={saving} onClick={() => openEditUser(user)}>Edit</Button>
                                  <Button size="sm" variant="outline" disabled={saving} onClick={() => void setUserActive(user, !user.isActive)}>
                                    {user.isActive ? 'Deactivate' : 'Reactivate'}
                                  </Button>
                                  {capabilities?.canPermanentlyDelete && (
                                    <Button size="sm" variant="outline" className="text-red-600" disabled={saving} onClick={() => void permanentlyDeleteUser(user)}>Delete</Button>
                                  )}
                                </div>
                              ) : <span className="text-xs font-medium text-slate-400">Managed by Developer</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {activeTab === 'access' && permissionsData && (
              <AccessControlPanel
                data={permissionsData}
                selectedUserId={selectedUserId}
                onSelectUser={setSelectedUserId}
                changes={permissionChanges}
                setChanges={setPermissionChanges}
                saving={saving}
                onSave={() => void savePermissions()}
                roleLabels={ROLE_LABELS}
              />
            )}

            {activeTab === 'access-map' && accessMatrix && (
              <AccessMap
                data={accessMatrix}
                roleLabels={ROLE_LABELS}
                onEditUser={(id) => { setSelectedUserId(id); router.replace('/admin?tab=access') }}
                onReload={() => void load()}
              />
            )}

            {activeTab === 'roles' && rolesData && (
              <RolesPanel data={rolesData} />
            )}

            {activeTab === 'audit' && auditData && (
              <Card>
                <CardHeader className="flex-row items-center justify-between gap-3">
                  <SectionHeading
                    icon={ShieldCheck}
                    tone="rose"
                    title={auditSource === 'kia' ? 'KIA Booking Activity' : 'Administrative Audit'}
                    subtitle={auditSource === 'kia'
                      ? 'Every booking lifecycle event — created, allocated, approved, payment confirmed, delivered.'
                      : 'User, permission and maintenance actions across the console.'}
                  />
                  <div className="inline-flex rounded-lg border border-slate-200 p-1">
                    {([['admin', 'Admin actions'], ['kia', 'Booking activity']] as const).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setAuditSource(value)}
                        className={cn(
                          'rounded-md px-3 py-1.5 text-xs font-bold transition',
                          auditSource === value ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-900',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full text-sm">
                      <thead className="bg-gradient-to-r from-rose-50 to-slate-50 text-left text-xs font-bold uppercase tracking-wide text-rose-700/80"><tr className="border-b-2 border-rose-100"><th className="p-3">Time</th><th className="p-3">Actor</th><th className="p-3">Action</th><th className="p-3">{auditSource === 'kia' ? 'Booking / Customer' : 'Target'}</th><th className="p-3">Branch</th><th className="p-3">{auditSource === 'kia' ? 'Detail' : 'Reason'}</th></tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {auditData.entries.length === 0 && (
                          <tr><td colSpan={6} className="p-6 text-center text-slate-400">No entries yet.</td></tr>
                        )}
                        {auditData.entries.map((entry) => (
                          <tr key={entry.id} className="transition-colors even:bg-slate-50/40 hover:bg-rose-50/40">
                            <td className="whitespace-nowrap p-3 text-slate-500">{formatIstDateTime(entry.createdAt)}</td>
                            <td className="p-3 font-semibold text-slate-800">{entry.actor?.fullName || 'System'}</td>
                            <td className="p-3"><ActionBadge action={entry.action} /></td>
                            <td className="p-3 text-slate-600">{entry.target?.fullName || '-'}</td>
                            <td className="p-3 font-medium text-slate-600">{branchLabel(entry.branch)}</td>
                            <td className="p-3 text-slate-500">{entry.reason || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
            {activeTab === 'sync-logs' && syncLogs && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
                    <RefreshCw className="h-5 w-5 text-indigo-600 animate-spin-slow" /> Data Freshness & Sync Monitor
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Real-time monitoring of data import status, row counts, and last sync timestamps across all brands.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                  {([
                    { brandKey: 'kia' as const, brandName: 'AM Kia', themeColor: 'border-l-indigo-600' },
                    { brandKey: 'hyundai' as const, brandName: 'AM Hyundai', themeColor: 'border-l-emerald-600' },
                    { brandKey: 'platinum' as const, brandName: 'AM Platinum', themeColor: 'border-l-amber-500' },
                  ] as const).map(({ brandKey, brandName, themeColor }) => {
                    const logs = syncLogs[brandKey] || []
                    return (
                      <Card key={brandKey} className={cn("border-l-4 shadow-sm", themeColor)}>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-base font-bold flex items-center justify-between">
                            {brandName}
                            <Badge variant="secondary" className="text-[10px] font-bold">
                              {logs.length} tables
                            </Badge>
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-3">
                            {logs.map((row) => {
                              const date = row.lastUpdated ? new Date(row.lastUpdated) : null
                              const isToday = date ? date.toDateString() === new Date().toDateString() : false
                              return (
                                <div key={row.table} className="rounded-xl border border-slate-100 bg-slate-50/50 p-3 hover:bg-slate-50 transition-colors">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-slate-800">{row.label}</span>
                                    <span className="text-[10px] font-black text-slate-500 bg-white px-1.5 py-0.5 rounded border">
                                      {row.rowCount.toLocaleString()} rows
                                    </span>
                                  </div>
                                  <div className="mt-1.5 flex items-center justify-between">
                                    <span className="text-[11px] font-semibold text-slate-500">
                                      {date ? formatIstDateTime(date) : 'Not available'}
                                    </span>
                                    {date ? (
                                      <span className={cn(
                                        "inline-block h-2 w-2 rounded-full",
                                        isToday ? "bg-emerald-500 animate-pulse" : "bg-amber-400"
                                      )} />
                                    ) : (
                                      <span className="inline-block h-2 w-2 rounded-full bg-slate-300" />
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              </div>
            )}


            {activeTab === 'system' && (
              <Card>
                <CardHeader>
                  <SectionHeading icon={Wrench} tone="rose" title="Maintenance · Reset Test Data" subtitle="Super-Admin-only. Wipes KIA test bookings and their allocations/transfers/activity, and clears the ‘retail’ stock markers created while testing. Proformas, users, permissions and real inventory are not touched." />
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                    {[
                      { label: 'Bookings', value: systemCounts?.bookings },
                      { label: 'Activity log', value: systemCounts?.activity },
                      { label: 'Allocations', value: systemCounts?.allocations },
                      { label: 'Transfers', value: systemCounts?.transfers },
                      { label: 'Retail markers', value: systemCounts?.retailMarks },
                    ].map((item) => (
                      <div key={item.label} className="rounded-xl border border-orange-200/70 bg-orange-50/40 p-4 text-center">
                        <p className="text-2xl font-black text-orange-700">{item.value ?? '—'}</p>
                        <p className="mt-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">{item.label}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4">
                    <div className="flex-1 min-w-[240px] text-sm font-semibold text-rose-800">
                      This is destructive and cannot be undone. A snapshot of the counts is written to the audit log.
                    </div>
                    <Button variant="destructive" onClick={() => void resetTestData()} disabled={resetting || !systemCounts}>
                      {resetting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wrench className="mr-2 h-4 w-4" />}
                      Reset Test Data
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {activeTab === 'system' && (
              <Card>
                <CardHeader className="flex-row items-center justify-between">
                  <SectionHeading icon={Activity} tone="amber" title="Email Delivery" subtitle="Every proforma-approval and quote email is logged here. Watch for failures so a bounced customer email doesn’t go unnoticed." />
                  {emailLogs && emailLogs.last24h.failed > 0 && (
                    <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-black text-rose-700">{emailLogs.last24h.failed} failed in last 24h</span>
                  )}
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      { label: 'Sent', value: emailLogs?.counts.sent, cls: 'text-emerald-600', tile: 'border-emerald-200 bg-emerald-50/60' },
                      { label: 'Failed', value: emailLogs?.counts.failed, cls: 'text-rose-600', tile: 'border-rose-200 bg-rose-50/60' },
                      { label: 'Pending', value: emailLogs?.counts.pending, cls: 'text-amber-600', tile: 'border-amber-200 bg-amber-50/60' },
                      { label: 'Total', value: emailLogs?.counts.total, cls: 'text-slate-900', tile: 'border-slate-200 bg-slate-50' },
                    ].map((item) => (
                      <div key={item.label} className={cn('rounded-xl border p-4 text-center', item.tile)}>
                        <p className={cn('text-2xl font-black', item.cls)}>{item.value ?? '—'}</p>
                        <p className="mt-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">{item.label}</p>
                      </div>
                    ))}
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full min-w-[720px] text-sm">
                      <thead className="bg-gradient-to-r from-amber-50 to-slate-50 text-left text-[11px] font-black uppercase tracking-wide text-amber-700/80">
                        <tr className="border-b-2 border-amber-100">
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">Type</th>
                          <th className="px-3 py-2">Recipient</th>
                          <th className="px-3 py-2">Subject</th>
                          <th className="px-3 py-2">When</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(emailLogs?.rows || []).slice(0, 30).map((row) => (
                          <tr key={row.id} className="align-top transition-colors even:bg-slate-50/40 hover:bg-amber-50/40">
                            <td className="px-3 py-2">
                              <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-black uppercase',
                                row.status === 'sent' ? 'bg-emerald-50 text-emerald-700'
                                  : row.status === 'failed' ? 'bg-rose-50 text-rose-700'
                                    : 'bg-amber-50 text-amber-700')}>{row.status}</span>
                            </td>
                            <td className="px-3 py-2 font-semibold text-slate-600">{row.emailType || '—'}</td>
                            <td className="px-3 py-2 font-semibold text-slate-800">{row.customerEmail}</td>
                            <td className="px-3 py-2 text-slate-600">
                              <div className="max-w-[280px] truncate">{row.subject}</div>
                              {row.error && <div className="mt-0.5 max-w-[280px] truncate text-[11px] font-semibold text-rose-600" title={row.error}>{row.error}</div>}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-slate-500">{formatIstDateTime(row.sentAt || row.createdAt)}</td>
                          </tr>
                        ))}
                        {!emailLogs?.rows.length && (
                          <tr><td colSpan={5} className="px-3 py-8 text-center font-semibold text-slate-400">No emails logged yet.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {activeTab === 'settings' && settingsData && (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <SectionHeading icon={Settings} tone="teal" title="KIA Business Excellence · Holidays" subtitle="Non-working days excluded from working-day counts and per-day averages, in addition to every Sunday. Changes apply immediately." />
                    {saving && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Add a holiday</Label>
                      <Input
                        type="date"
                        value={newHoliday}
                        onChange={(event) => setNewHoliday(event.target.value)}
                        onKeyDown={(event) => { if (event.key === 'Enter') void addHoliday() }}
                        className="h-11 w-52 rounded-xl border-slate-200 font-semibold"
                      />
                    </div>
                    <Button
                      className="h-11 rounded-xl px-5 font-bold"
                      onClick={() => void addHoliday()}
                      disabled={saving || !ISO_DATE_RE.test(newHoliday.trim()) || holidays.includes(newHoliday.trim())}
                    >
                      Add Holiday
                    </Button>
                  </div>

                  <div>
                    <p className="mb-2 text-[11px] font-black uppercase tracking-wider text-slate-500">
                      Configured Holidays ({holidays.length})
                    </p>
                    {holidays.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-4 text-sm text-slate-500">
                        No holidays configured. Only Sundays are treated as non-working days.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {holidays.map((date) => (
                          <span
                            key={date}
                            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1.5 pl-3.5 pr-1.5 text-sm font-bold text-slate-700 shadow-sm"
                          >
                            {formatHolidayLabel(date)}
                            <button
                              type="button"
                              aria-label={`Remove ${date}`}
                              onClick={() => void removeHoliday(date)}
                              disabled={saving}
                              className="grid h-6 w-6 place-items-center rounded-full text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Create User · Step {createStep} of 3</DialogTitle>
            <DialogDescription>Identity, authority, and branch access are reviewed before creation.</DialogDescription>
          </DialogHeader>
          {createStep === 1 && (
            <div className="grid gap-4 py-3">
              <div><Label>Full name</Label><Input value={createForm.fullName} onChange={(event) => setCreateForm((current) => ({ ...current, fullName: event.target.value }))} /></div>
              <div><Label>Email</Label><Input type="email" value={createForm.email} onChange={(event) => setCreateForm((current) => ({ ...current, email: event.target.value }))} /></div>
              <div><Label>Temporary password</Label><Input type="password" value={createForm.password} onChange={(event) => setCreateForm((current) => ({ ...current, password: event.target.value }))} /></div>
            </div>
          )}
          {createStep === 2 && (
            <div className="grid gap-4 py-3 max-h-[60vh] overflow-y-auto pr-2">
              <div>
                <Label>Role</Label>
                <Select value={createForm.role} onValueChange={(value) => setCreateForm((current) => ({ ...current, role: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{capabilities?.assignableRoles.map((role) => <SelectItem key={role} value={role}>{ROLE_LABELS[role] || role}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1.5 block">Branch(es)</Label>
                {capabilities?.authority === 'branch_admin'
                  ? <Input value={branchLabel(capabilities.branch)} disabled />
                  : (
                    <BranchSelector value={createForm.brand} onChange={(value) => setCreateForm((current) => ({ ...current, brand: value, dealers: [] }))} />
                  )}
              </div>
              <DealerSelector
                brand={capabilities?.authority === 'branch_admin' ? (capabilities.branch || '') : createForm.brand}
                value={createForm.dealers}
                onChange={(value) => setCreateForm((current) => ({ ...current, dealers: value }))}
              />
              <div><Label>Department</Label><Input value={createForm.department} onChange={(event) => setCreateForm((current) => ({ ...current, department: event.target.value }))} /></div>
            </div>
          )}
          {createStep === 3 && (
            <div className="space-y-3 rounded-xl bg-slate-50 p-4 text-sm">
              <p><strong>{createForm.fullName}</strong> · {createForm.email}</p>
              <p>Role: <strong>{ROLE_LABELS[createForm.role] || createForm.role}</strong></p>
              <p>Branch: <strong>{branchLabel(capabilities?.authority === 'branch_admin' ? capabilities.branch : createForm.brand)}</strong></p>
              <p className="text-slate-500">The server will apply the role template and enforce branch scope. Optional access changes can be made in the Access tab.</p>
            </div>
          )}
          <div className="flex justify-between pt-2">
            <Button variant="outline" disabled={createStep === 1 || saving} onClick={() => setCreateStep((step) => step - 1)}><ChevronLeft className="mr-1 h-4 w-4" /> Back</Button>
            {createStep < 3
              ? <Button onClick={() => setCreateStep((step) => step + 1)}>Next <ChevronRight className="ml-1 h-4 w-4" /></Button>
              : <Button disabled={saving} onClick={() => void createUser()}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create User</Button>}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editUser)} onOpenChange={(open) => !open && setEditUser(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>
              {capabilities?.authority === 'branch_admin'
                ? 'You can update profile and lifecycle fields for ordinary users in your branch.'
                : 'Update role, branch, and profile details.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-3 max-h-[60vh] overflow-y-auto pr-2">
            {capabilities?.authority === 'developer' ? (
              <div className="grid grid-cols-2 gap-4">
                <div><Label>Full name</Label><Input value={editForm.fullName} onChange={(event) => setEditForm((current) => ({ ...current, fullName: event.target.value }))} /></div>
                <div><Label>Email</Label><Input type="email" value={editForm.email} onChange={(event) => setEditForm((current) => ({ ...current, email: event.target.value }))} /></div>
              </div>
            ) : (
              <div><Label>Full name</Label><Input value={editForm.fullName} onChange={(event) => setEditForm((current) => ({ ...current, fullName: event.target.value }))} /></div>
            )}
            
            {capabilities?.authority === 'developer' && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Role</Label>
                  <Select value={editForm.role} onValueChange={(value) => setEditForm((current) => ({ ...current, role: value }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{capabilities.assignableRoles.map((role) => <SelectItem key={role} value={role}>{ROLE_LABELS[role] || role}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>New Password (optional override)</Label>
                  <Input type="password" placeholder="Leave blank to keep current" value={editForm.password} onChange={(event) => setEditForm((current) => ({ ...current, password: event.target.value }))} />
                </div>
              </div>
            )}

            {capabilities?.authority === 'developer' && (
              <div className="space-y-4">
                <div>
                  <Label className="mb-1.5 block">Branch(es)</Label>
                  <BranchSelector value={editForm.brand} onChange={(value) => setEditForm((current) => ({ ...current, brand: value, dealers: [] }))} />
                </div>
                <DealerSelector
                  brand={editForm.brand}
                  value={editForm.dealers}
                  onChange={(value) => setEditForm((current) => ({ ...current, dealers: value }))}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div><Label>Department</Label><Input value={editForm.department} onChange={(event) => setEditForm((current) => ({ ...current, department: event.target.value }))} /></div>
              <div><Label>Phone</Label><Input value={editForm.phoneNumber} onChange={(event) => setEditForm((current) => ({ ...current, phoneNumber: event.target.value }))} /></div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditUser(null)}>Cancel</Button>
            <Button disabled={saving} onClick={() => void updateUser()}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save Changes</Button>
          </div>
        </DialogContent>
      </Dialog>
    </MainLayout>
  )
}
