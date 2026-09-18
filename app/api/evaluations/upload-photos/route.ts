import { NextRequest, NextResponse } from 'next/server'
import { attachEvaluationPhotos } from '@/lib/evaluation/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const evaluationId = formData.get('evaluationId') as string
    if (!evaluationId) {
      return NextResponse.json({ success: false, error: 'Evaluation ID is required' }, { status: 400 })
    }

    const files = formData.getAll('photos') as File[]
    if (!files || files.length === 0) {
      return NextResponse.json({ success: false, error: 'No photos provided' }, { status: 400 })
    }

    const uploadedUrls: string[] = []

    for (let i = 0; i < Math.min(files.length, 6); i++) {
      const file = files[i]
      if (!file || typeof file === 'string' || !file.size) continue

      const ext = file.name.split('.').pop() || 'jpg'
      const filePath = `evaluations/${evaluationId}/${Date.now()}_${i}.${ext}`
      const arrayBuffer = await file.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      try {
        const { error } = await supabaseAdmin.storage
          .from('vehicle-evaluations')
          .upload(filePath, buffer, {
            contentType: file.type || 'image/jpeg',
            upsert: true,
          })

        if (!error) {
          const { data } = supabaseAdmin.storage
            .from('vehicle-evaluations')
            .getPublicUrl(filePath)
          if (data?.publicUrl) {
            uploadedUrls.push(data.publicUrl)
          }
        }
      } catch (uploadErr) {
        console.warn('[upload-photos] Supabase storage upload skipped or failed:', uploadErr)
      }
    }

    if (uploadedUrls.length > 0) {
      await attachEvaluationPhotos(evaluationId, uploadedUrls)
    }

    return NextResponse.json({
      success: true,
      photosCount: uploadedUrls.length,
      urls: uploadedUrls,
    })
  } catch (error: any) {
    console.error('[API evaluations/upload-photos] Error:', error)
    return NextResponse.json({ success: false, error: 'Failed to upload photos' }, { status: 500 })
  }
}
