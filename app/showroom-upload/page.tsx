import React from 'react'
import { ShowroomUploadForm } from '@/features/showroom-upload/showroom-upload-form'

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
  const brand = params.brand
  const location = params.location
  const department = params.department || params.dept

  return (
    <ShowroomUploadForm
      initialBrand={brand}
      initialLocation={location}
      initialDepartment={department}
    />
  )
}
