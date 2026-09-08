import { NextRequest, NextResponse } from 'next/server'
import { uploadShowroomImages } from '@/lib/showroom-images/server'
import { type ShowroomBrandKey, isValidShowroomBrand } from '@/lib/showroom-images/constants'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const brand = formData.get('brand') as string
    const location = formData.get('location') as string
    const department = (formData.get('department') as string) || 'sales'
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

    // Parse photo metadata manifest if supplied
    let manifest: Array<{ category?: string; slot?: number }> = []
    const manifestStr = formData.get('manifest') as string
    if (manifestStr) {
      try {
        manifest = JSON.parse(manifestStr)
      } catch {
        // ignore parse error
      }
    }

    // Collect all uploaded photos
    const rawFiles = formData.getAll('photos') as File[]
    const fallbackFiles = formData.getAll('images') as File[]
    const allFiles = [...rawFiles, ...fallbackFiles].filter((f) => f && typeof f === 'object' && 'arrayBuffer' in f && f.size > 0)

    if (allFiles.length === 0) {
      return NextResponse.json({ error: 'Please capture at least one showroom photo.' }, { status: 400 })
    }

    const processedFiles: Array<{
      buffer: Buffer
      category?: string
      categorySlot?: number
      mimeType: string
      size: number
    }> = []

    for (let i = 0; i < allFiles.length; i++) {
      const file = allFiles[i]
      const arrayBuffer = await file.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      const meta = manifest[i] || {}

      processedFiles.push({
        buffer,
        category: meta.category || (file.name.includes('tv') ? 'tv' : file.name.includes('bathroom') ? 'bathroom' : 'vehicles'),
        categorySlot: meta.slot || ((i % 2) + 1),
        mimeType: file.type || 'image/webp',
        size: file.size,
      })
    }

    const result = await uploadShowroomImages({
      brand: brand as ShowroomBrandKey,
      location: location.trim(),
      department: department.trim().toLowerCase(),
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
