import { forbidden, redirect } from 'next/navigation'
import { ServiceAppointmentPage } from '@/features/kia/service-appointment-page'
import { getBrandAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'

export const metadata = {
  title: 'Service Appointment | AM Kia',
  description: 'AM Kia service appointment register and calendar',
}

export default async function Page() {
  const access = await getBrandAccess('kia')

  if (!access.appUser) {
    redirect('/auth/login')
  }

  if (!access.allowed) {
    forbidden()
  }

  const permission = await requirePermission(access.appUser, 'kia.service_appointment.view')
  if (!permission.allowed) {
    forbidden()
  }

  return <ServiceAppointmentPage />
}
