import { Suspense } from 'react'
import { forbidden, redirect } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { isSuperAdminRole } from '@/lib/auth/roles'
import { InsuranceClient } from './insurance-client'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Insurance Analysis | AM Group Dashboard',
  description: 'Executive Hyundai Insurance and Platinum Insurance analytics workspace',
}

type SearchParamsInput = Record<string, string | string[] | undefined>

export default async function InsurancePage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>
}) {
  const appUser = await getAuthenticatedAppUser()

  if (!appUser) {
    redirect('/auth/login')
  }

  // Insurance Analysis is restricted strictly to MD and Developer roles
  if (!isSuperAdminRole(appUser.role)) {
    forbidden()
  }

  const resolvedSearchParams = await searchParams

  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500">Loading Insurance Analysis...</div>}>
      <InsuranceClient initialSearchParams={resolvedSearchParams} />
    </Suspense>
  )
}
