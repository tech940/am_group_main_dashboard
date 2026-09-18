import { notFound } from 'next/navigation'
import { ShowroomUploadForm } from '@/features/showroom-upload/showroom-upload-form'
import {
  getShowroomBrandConfig,
  getLocationsForBrand,
} from '@/lib/showroom-images/constants'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Showroom Live Camera Capture | AM Group',
  description: 'Capture and submit live showroom photos across AM Group dealerships.',
}

type Props = {
  searchParams: Promise<{
    brand?: string
    location?: string
    department?: string
    dept?: string
  }>
}

export default async function ShowroomUploadPage({ searchParams }: Props) {
  const params = await searchParams
  const rawBrand = params.brand
  const rawLocation = params.location
  const rawDepartment = params.department || params.dept

  // Require valid brand configuration
  const brandConfig = getShowroomBrandConfig(rawBrand)
  if (!brandConfig) {
    notFound()
  }

  // Require valid location for that specific brand
  const validLocations = getLocationsForBrand(brandConfig.key)
  if (!rawLocation || !validLocations.includes(rawLocation)) {
    notFound()
  }

  const department = rawDepartment?.toLowerCase() === 'service' ? 'service' : 'sales'

  return (
    <ShowroomUploadForm
      brand={brandConfig.key}
      location={rawLocation}
      department={department}
    />
  )
}

