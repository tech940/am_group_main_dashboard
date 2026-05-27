import { getBrandAccess } from '@/lib/auth/brand-access'
import { forbidden, redirect } from 'next/navigation'

export const metadata = {
  title: 'Business Excellence | AM Kia',
  description: 'Business Excellence Index AM KIA (NEW)',
}

export default async function Page() {
  const access = await getBrandAccess('kia')

  if (!access.appUser) {
    redirect('/auth/login')
  }

  if (!access.allowed) {
    forbidden()
  }

  redirect('/brands/kia/business-excellence/overview')
}
