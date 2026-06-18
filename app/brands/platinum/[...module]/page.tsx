import { forbidden, redirect } from 'next/navigation'
import { getBrandAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { PlatinumModulePlaceholder } from '@/features/platinum/platinum-module-placeholder'
import PlatinumBusinessExcellencePage from '@/features/platinum/business-excellence-page'
import { HyundaiWarrantyClaimsPage } from '@/features/hyundai/warranty-claims-page'

type PlatinumModuleDefinition = {
  title: string
  permission: string
  component?: 'business-excellence' | 'warranty-claims'
  warrantySource?: 'ytp' | 'claim_list'
  report?: 'overview' | 'executive-dashboard' | 'ro-billing-report' | 'workshop-performance' | 'open-ro' | 'platinum-complaints' | 'sot-analysis'
}

const PLATINUM_MODULES: Record<string, PlatinumModuleDefinition> = {
  'business-excellence/overview': {
    title: 'Business Excellence',
    permission: 'platinum.business_excellence.view',
    component: 'business-excellence',
    report: 'overview',
  },
  'business-excellence/executive-dashboard': {
    title: 'Executive Dashboard',
    permission: 'platinum.business_excellence.view',
    component: 'business-excellence',
    report: 'executive-dashboard',
  },
  'business-excellence/ro-billing-report': {
    title: 'RO Billing Report',
    permission: 'platinum.business_excellence.view',
    component: 'business-excellence',
    report: 'ro-billing-report',
  },
  'business-excellence/workshop-performance': {
    title: 'Workshop Performance',
    permission: 'platinum.business_excellence.view',
    component: 'business-excellence',
    report: 'workshop-performance',
  },
  'business-excellence/open-ro': {
    title: 'Open RO',
    permission: 'platinum.business_excellence.view',
    component: 'business-excellence',
    report: 'open-ro',
  },
  'business-excellence/platinum-complaints': {
    title: 'Platinum Complaints',
    permission: 'platinum.business_excellence.view',
    component: 'business-excellence',
    report: 'platinum-complaints',
  },
  'business-excellence/sot-analysis': {
    title: 'SOT Analysis',
    permission: 'platinum.business_excellence.view',
    component: 'business-excellence',
    report: 'sot-analysis',
  },
  'service-appointment': {
    title: 'Service Appointment',
    permission: 'platinum.service_appointment.view',
  },
  'demo-job-cards': {
    title: 'Demo Job Cards',
    permission: 'platinum.demo_job_cards.view',
  },
  'demo-cars-list': {
    title: 'Demo Cars List',
    permission: 'platinum.demo_cars_list.view',
  },
  proforma: {
    title: 'Platinum Proforma',
    permission: 'platinum.proforma.view',
  },
  'warranty-list': {
    title: 'Claim YTP',
    permission: 'platinum.warranty_list.view',
    component: 'warranty-claims',
    warrantySource: 'ytp',
  },
  'warranty-claim-list': {
    title: 'Warranty Claim List',
    permission: 'platinum.warranty_claim_list.view',
    component: 'warranty-claims',
    warrantySource: 'claim_list',
  },
}

export async function generateMetadata({ params }: { params: Promise<{ module: string[] }> }) {
  const { module } = await params
  const key = module.join('/')
  const definition = PLATINUM_MODULES[key]

  return {
    title: definition ? `${definition.title} | AM Platinum` : 'AM Platinum',
  }
}

export default async function Page({
  params,
}: {
  params: Promise<{ module: string[] }>
}) {
  const access = await getBrandAccess('platinum')

  if (!access.appUser) {
    redirect('/auth/login')
  }

  if (!access.allowed) {
    forbidden()
  }

  const { module } = await params
  const key = module.join('/')
  const definition = PLATINUM_MODULES[key]

  if (!definition) {
    forbidden()
  }

  const permission = await requirePermission(access.appUser, definition.permission)
  if (!permission.allowed) {
    forbidden()
  }

  if (definition.component === 'business-excellence') {
    return <PlatinumBusinessExcellencePage initialReport={definition.report || 'overview'} currentUserRole={access.appUser.role} />
  }

  if (definition.component === 'warranty-claims') {
    return <HyundaiWarrantyClaimsPage source={definition.warrantySource || 'claim_list'} brand="platinum" />
  }

  return <PlatinumModulePlaceholder title={definition.title} />
}
