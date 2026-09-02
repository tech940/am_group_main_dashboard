import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { optimizeImage } from '@/lib/images/optimize'

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedAppUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json({ error: 'File size exceeds 25MB limit' }, { status: 400 })
    }

    // Optimize image (raster images converted to WebP, PDFs pass through)
    const optimized = await optimizeImage(Buffer.from(await file.arrayBuffer()), file.type, {
      filename: file.name,
    })

    const timestamp = Date.now()
    const randomStr = Math.random().toString(36).substring(7)
    const extension = optimized.contentType === 'image/webp' ? 'webp' : (file.name.split('.').pop() || 'bin')
    const filename = `fuel_slip_${timestamp}_${randomStr}.${extension}`
    const filePath = `fuel-slips/${filename}`

    const { error } = await supabaseAdmin.storage
      .from('purchase-orders')
      .upload(filePath, optimized.buffer, {
        contentType: optimized.contentType,
        upsert: false,
      })

    if (error) {
      console.error('Error uploading fuel slip:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const { data: urlData } = supabaseAdmin.storage
      .from('purchase-orders')
      .getPublicUrl(filePath)

    return NextResponse.json({
      url: urlData.publicUrl,
      path: filePath,
      name: file.name,
      message: 'Fuel slip uploaded successfully',
    })
  } catch (error) {
    console.error('Error in fuel slip upload:', error)
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
