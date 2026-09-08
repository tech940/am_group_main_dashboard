import { redirect, forbidden } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { isPermissionDenied } from '@/lib/permissions/deny'
import { MainLayout } from '@/components/layout/main-layout'
import { ShowroomGalleryClient } from '@/features/showroom-images/showroom-gallery-client'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Showroom Images | AM Group Dashboard',
  description: 'View and inspect real-time showroom photos across all AM Group dealerships and brands.',
}

export default async function ShowroomImagesPage() {
  const appUser = await getAuthenticatedAppUser()

  if (!appUser) {
    redirect('/auth/login')
  }

  if (await isPermissionDenied(appUser, 'showroom_images.view')) {
    forbidden()
  }

  return (
    <MainLayout
      title="Showroom Images"
      subtitle="Real-time inspection of daily showroom condition and displays across all brands and dealerships."
    >
      <ShowroomGalleryClient initialUserBrand={appUser?.brand} />
    </MainLayout>
  )
}
