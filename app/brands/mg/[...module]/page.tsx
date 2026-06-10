import { forbidden, redirect } from 'next/navigation'
import { getBrandAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { MgModulePlaceholder } from '@/features/mg/mg-module-placeholder'

type MgModuleDefinition = {
  title: string
  permission: string
}

const MG_MODULES: Record<string, MgModuleDefinition> = {
  'business-excellence/overview': {
    title: 'Business Excellence',
    permission: 'mg.business_excellence.view',
  },
  'business-excellence/executive-dashboard': {
    title: 'Executive Dashboard',
    permission: 'mg.business_excellence.view',
  },
  'business-excellence/ro-billing-report': {
    title: 'RO Billing Report',
    permission: 'mg.business_excellence.view',
  },
  'business-excellence/workshop-performance': {
    title: 'Workshop Performance',
    permission: 'mg.business_excellence.view',
  },
  'business-excellence/open-ro': {
    title: 'Open RO',
    permission: 'mg.business_excellence.view',
  },
  'business-excellence/mg-complaints': {
    title: 'MG Complaints',
    permission: 'mg.business_excellence.view',
  },
  'service-appointment': {
    title: 'Service Appointment',
    permission: 'mg.service_appointment.view',
  },
  'demo-job-cards': {
    title: 'Demo Job Cards',
    permission: 'mg.demo_job_cards.view',
  },
  'demo-cars-list': {
    title: 'Demo Cars List',
    permission: 'mg.demo_cars_list.view',
  },
}

export async function generateMetadata({ params }: { params: Promise<{ module: string[] }> }) {
  const { module } = await params
  const key = module.join('/')
  const definition = MG_MODULES[key]

  return {
    title: definition ? `${definition.title} | AM MG` : 'AM MG',
  }
}

export default async function Page({ params }: { params: Promise<{ module: string[] }> }) {
  const access = await getBrandAccess('mg')

  if (!access.appUser) {
    redirect('/auth/login')
  }

  if (!access.allowed) {
    forbidden()
  }

  const { module } = await params
  const key = module.join('/')
  const definition = MG_MODULES[key]

  if (!definition) {
    forbidden()
  }

  const permission = await requirePermission(access.appUser, definition.permission)
  if (!permission.allowed) {
    forbidden()
  }

  return <MgModulePlaceholder title={definition.title} />
}
