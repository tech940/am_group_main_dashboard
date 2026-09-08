import { NextRequest, NextResponse } from 'next/server'
import { uploadShowroomImages } from '@/lib/showroom-images/server'
import { type ShowroomBrandKey, isValidShowroomBrand } from '@/lib/showroom-images/constants'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const brand = formData.get('brand') as string
    const location = formData.get('location') as string
    const uploaderName = (formData.get('uploaderName') as string) || null

    if (!brand || !isValidShowroomBrand(brand)) {
      return NextResponse.json(
        { error: 'Valid brand selection is required (e.g. kia, hyundai, tata, mg, platinum, two_wheelers).' },
        { status: 400 }
      )
    }

    if (!location || !location.trim()) {
      return NextResponse.json({ error: 'Dealership location is required.' }, { status: 400 })
    }

    // Collect all uploaded photos
    const rawFiles = formData.getAll('photos') as File[]
    const fallbackFiles = formData.getAll('images') as File[]
    const allFiles = [...rawFiles, ...fallbackFiles].filter((f) => f && typeof f === 'object' && 'arrayBuffer' in f && f.size > 0)

    if (allFiles.length === 0) {
      return NextResponse.json({ error: 'Please capture at least one showroom photo.' }, { status: 400 })
    }

    const processedFiles: Array<{ buffer: Buffer; mimeType: string; size: number }> = []

    for (const file of allFiles) {
      const arrayBuffer = await file.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      processedFiles.push({
        buffer,
        mimeType: file.type || 'image/webp',
        size: file.size,
      })
    }

    const result = await uploadShowroomImages({
      brand: brand as ShowroomBrandKey,
      location: location.trim(),
      uploaderName,
      files: processedFiles,
    })

    return NextResponse.json({
      success: true,
      message: `${result.totalImages} showroom photos successfully uploaded for ${brand.toUpperCase()} - ${location}.`,
      session: result,
    })
  } catch (error) {
    console.error('Error in /api/showroom-upload:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to upload showroom photos.' },
      { status: 500 }
    )
  }
}
