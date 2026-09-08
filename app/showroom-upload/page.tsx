import React from 'react'
import { ShowroomUploadForm } from '@/features/showroom-upload/showroom-upload-form'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Showroom Live Camera Capture | AM Group',
  description: 'Capture and submit live showroom photos across AM Group dealerships.',
}

type Props = {
  searchParams: Promise<{ brand?: string }>
}

export default async function ShowroomUploadPage({ searchParams }: Props) {
  const { brand } = await searchParams
  return <ShowroomUploadForm initialBrand={brand} />
}
