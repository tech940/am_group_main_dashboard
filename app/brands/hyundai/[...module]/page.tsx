import { forbidden, redirect } from 'next/navigation'
import { getBrandAccess } from '@/lib/auth/brand-access'
import { getUserDealerScope } from '@/lib/auth/dealer-scope'
import { getBrandDealers } from '@/lib/dealers/registry'
import { requirePermission } from '@/lib/permissions/service'
import { HyundaiModulePlaceholder } from '@/features/hyundai/hyundai-module-placeholder'
import HyundaiBusinessExcellencePage from '@/features/hyundai/business-excellence-page'
import { HyundaiWarrantyClaimsPage } from '@/features/hyundai/warranty-claims-page'

type HyundaiModuleDefinition = {
  title: string
  permission: string
  component?: 'business-excellence' | 'warranty-claims'
  warrantySource?: 'ytp' | 'claim_list'
  report?: 'overview' | 'executive-dashboard' | 'ro-billing-report' | 'open-ro' | 'workshop-performance' | 'workshop-summary' | 'hyundai-complaints' | 'sot-analysis' | 'service-dashboard'
}

const HYUNDAI_MODULES: Record<string, HyundaiModuleDefinition> = {
  'business-excellence/overview': {
    title: 'Business Excellence',
    permission: 'hyundai.business_excellence.view',
    component: 'business-excellence',
    report: 'overview',
  },
  'business-excellence/repair-orders': {
    title: 'Repair Orders',
    permission: 'hyundai.business_excellence.view',
  },
  'business-excellence/open-ro': {
    title: 'Open RO',
    permission: 'hyundai.business_excellence.view',
    component: 'business-excellence',
    report: 'open-ro',
  },
  'business-excellence/ro-billing-report': {
    title: 'RO Billing Report',
    permission: 'hyundai.business_excellence.view',
    component: 'business-excellence',
    report: 'ro-billing-report',
  },
  'business-excellence/workshop-performance': {
    title: 'Workshop Performance',
    permission: 'hyundai.business_excellence.view',
    component: 'business-excellence',
    report: 'workshop-performance',
  },
  'business-excellence/workshop-summary': {
    title: 'Workshop Summary',
    permission: 'hyundai.business_excellence.view',
    component: 'business-excellence',
    report: 'workshop-summary',
  },
  'business-excellence/hyundai-complaints': {
    title: 'Hyundai Complaints',
    permission: 'hyundai.business_excellence.view',
    component: 'business-excellence',
    report: 'hyundai-complaints',
  },
  'business-excellence/executive-dashboard': {
    title: 'Executive Dashboard',
    permission: 'hyundai.business_excellence.view',
    component: 'business-excellence',
    report: 'executive-dashboard',
  },
  'business-excellence/service-dashboard': {
    title: 'Service Dashboard',
    permission: 'hyundai.business_excellence.view',
    component: 'business-excellence',
    report: 'service-dashboard',
  },
  'business-excellence/sot-analysis': {
    title: 'SOT Analysis',
    permission: 'hyundai.business_excellence.view',
    component: 'business-excellence',
    report: 'sot-analysis',
  },
  'service-appointment': {
    title: 'Service Appointment',
    permission: 'hyundai.service_appointment.view',
  },
  'demo-job-cards': {
    title: 'Demo Job Cards',
    permission: 'hyundai.demo_job_cards.view',
  },
  'demo-cars-list': {
    title: 'Demo Cars List',
    permission: 'hyundai.demo_cars_list.view',
  },
  'warranty-list': {
    title: 'Claim YTP',
    permission: 'hyundai.warranty_list.view',
    component: 'warranty-claims',
    warrantySource: 'ytp',
  },
  'warranty-claim-list': {
    title: 'Warranty Claim List',
    permission: 'hyundai.warranty_claim_list.view',
    component: 'warranty-claims',
    warrantySource: 'claim_list',
  },
  proforma: {
    title: 'Hyundai Proforma',
    permission: 'hyundai.proforma.view',
  },
}

export async function generateMetadata({ params }: { params: Promise<{ module: string[] }> }) {
  const { module } = await params
  const key = module.join('/')
  const definition = HYUNDAI_MODULES[key]

  return {
    title: definition ? `${definition.title} | AM Hyundai` : 'AM Hyundai',
  }
}

function searchParamsToString(searchParams: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      value.forEach((entry) => params.append(key, entry))
    } else if (value !== undefined) {
      params.set(key, value)
    }
  }
  return params.toString()
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ module: string[] }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const access = await getBrandAccess('hyundai')

  if (!access.appUser) {
    redirect('/auth/login')
  }

  if (!access.allowed) {
    forbidden()
  }

  const { module } = await params
  const key = module.join('/')

  if (key === 'business-excellence/repair-orders') {
    const queryString = searchParamsToString(await (searchParams || Promise.resolve({})))
    redirect(`/brands/hyundai/business-excellence/open-ro${queryString ? `?${queryString}` : ''}`)
  }

  const definition = HYUNDAI_MODULES[key]

  if (!definition) {
    forbidden()
  }

  // Enforce the per-section permission so an Access Map deny actually blocks direct access
  // (matches platinum/mg). Brand users get the section by default; only an explicit deny blocks.
  const permission = await requirePermission(access.appUser, definition.permission)
  if (!permission.allowed) {
    forbidden()
  }

  if (definition.component === 'business-excellence') {
    const dealerScope = getUserDealerScope(access.appUser, 'hyundai')
    const allowedDealers = dealerScope ? getBrandDealers('hyundai').filter((dealer) => dealerScope.includes(dealer.code)) : undefined
    return <HyundaiBusinessExcellencePage initialReport={definition.report || 'overview'} currentUserRole={access.appUser.role} allowedDealers={allowedDealers} />
  }

  if (definition.component === 'warranty-claims') {
    return <HyundaiWarrantyClaimsPage source={definition.warrantySource || 'claim_list'} />
  }

  return <HyundaiModulePlaceholder title={definition.title} />
}
