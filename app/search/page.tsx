import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { redirect } from 'next/navigation'
import { SearchPageClient } from '@/features/search/search-page-client'

export const metadata = {
  title: 'Search Sections | AM Group',
  description: 'Search and navigate across all dashboard sections',
}

export default async function SearchPage() {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) redirect('/auth/login')

  return <SearchPageClient />
}
