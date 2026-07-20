import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { optimizeImage } from '@/lib/images/optimize'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (file.size > 15 * 1024 * 1024) {
      return NextResponse.json({ error: 'File size exceeds 15MB limit' }, { status: 400 })
    }

    // Re-encode raster images to WebP before storing (PDFs pass through unchanged).
    const optimized = await optimizeImage(Buffer.from(await file.arrayBuffer()), file.type)
    const timestamp = Date.now()
    const randomStr = Math.random().toString(36).substring(7)
    const extension = optimized.optimized ? 'webp' : (file.name.split('.').pop() || 'bin')
    const filename = `approval_${timestamp}_${randomStr}.${extension}`
    const filePath = `approvals/${filename}`

    const { error } = await supabaseAdmin.storage
      .from('purchase-orders')
      .upload(filePath, optimized.buffer, {
        contentType: optimized.contentType,
        upsert: false,
      })

    if (error) {
      console.error('Error uploading file:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const { data: urlData } = supabaseAdmin.storage
      .from('purchase-orders')
      .getPublicUrl(filePath)

    return NextResponse.json({
      url: urlData.publicUrl,
      path: filePath,
      message: 'File uploaded successfully',
    })
  } catch (error) {
    console.error('Error in public approvals upload:', error)
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
