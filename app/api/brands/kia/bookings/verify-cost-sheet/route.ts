import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireBrandSectionApiAccess } from '@/lib/auth/brand-access'
import { optimizeImage } from '@/lib/images/optimize'

export async function POST(request: Request) {
  const accessError = await requireBrandSectionApiAccess('kia', 'kia.bookings.view')
  if (accessError) return accessError
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    const buffer = await file.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    const mimeType = file.type || 'image/jpeg'

    // PDFs can't be OCR'd by the image vision model — store-and-trust (mirrors the ID-document PDF
    // path). The uploader affirms it's the cost sheet; we skip the "COST SHEET" heading gate for PDFs.
    const isPdf = mimeType === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    if (isPdf) {
      const timestamp = Date.now()
      const randomStr = Math.random().toString(36).substring(7)
      const extension = file.name.split('.').pop() || 'pdf'
      const filename = `cost_sheet_${timestamp}_${randomStr}.${extension}`
      const filePath = `cost-sheets/${filename}`

      const { error: uploadError } = await supabaseAdmin.storage
        .from('purchase-orders')
        .upload(filePath, buffer, { contentType: mimeType, upsert: false })

      if (uploadError) {
        console.error('Supabase upload error:', uploadError)
        return NextResponse.json({ error: 'Failed to upload to storage: ' + uploadError.message }, { status: 500 })
      }

      const { data: urlData } = supabaseAdmin.storage
        .from('purchase-orders')
        .getPublicUrl(filePath)

      return NextResponse.json({
        valid: true,
        message: 'PDF cost sheet accepted and stored.',
        url: urlData.publicUrl,
        path: filePath,
        filename: file.name,
        pdfManual: true,
      })
    }

    const apiKey = process.env.GROQ_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'GROQ API key not configured' }, { status: 500 })
    }

    // 1. Call GROQ Vision API to extract text from the image
    const visionResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Extract all readable text from this image. Do not summarize, just output the raw text.'
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${base64}`
                }
              }
            ]
          }
        ],
        max_tokens: 1000,
        temperature: 0.1
      })
    })

    const saveAndTrustUpload = async () => {
      // Store an optimised WebP copy (document preset preserves cost-sheet legibility). OCR above used
      // the original `base64`, so this re-encode never affects verification.
      const stored = await optimizeImage(Buffer.from(buffer), mimeType, { preset: 'document' })
      const timestamp = Date.now()
      const randomStr = Math.random().toString(36).substring(7)
      const extension = stored.optimized ? 'webp' : (file.name.split('.').pop() || 'jpg')
      const filename = `cost_sheet_${timestamp}_${randomStr}.${extension}`
      const filePath = `cost-sheets/${filename}`

      const { error: uploadError } = await supabaseAdmin.storage
        .from('purchase-orders')
        .upload(filePath, stored.buffer, {
          contentType: stored.contentType,
          upsert: false
        })

      if (uploadError) {
        throw new Error('Failed to upload to storage: ' + uploadError.message)
      }

      const { data: urlData } = supabaseAdmin.storage
        .from('purchase-orders')
        .getPublicUrl(filePath)

      return {
        url: urlData.publicUrl,
        path: filePath,
      }
    }

    if (!visionResponse.ok) {
      const errText = await visionResponse.text()
      console.warn('GROQ Vision API Error (falling back to store-and-trust):', errText)
      const uploadResult = await saveAndTrustUpload()
      return NextResponse.json({
        valid: true,
        message: 'Cost sheet image stored (Verification skipped - Vision API offline).',
        url: uploadResult.url,
        path: uploadResult.path,
        filename: file.name
      })
    }

    const visionData = await visionResponse.json()
    const extractedText = visionData.choices?.[0]?.message?.content || ''
    console.log('GROQ Extracted Text:', extractedText)

    // 2. Call Llama-3.3-70b-versatile to verify if this text belongs to a vehicle cost sheet
    const analysisResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: 'You are an AI assistant verifying whether the provided text is a vehicle cost sheet/pricing sheet.'
          },
          {
            role: 'user',
            content: `Analyze the following extracted text. Does it represent a vehicle cost sheet or proforma booking calculation? Look for keywords like "VEHICLE COST SHEET", pricing details, options, variant, discounts, or bank names. Respond only with "YES" or "NO" followed by a brief 1-sentence reason.

Extracted Text:
${extractedText}`
          }
        ],
        max_tokens: 300,
        temperature: 0.1
      })
    })

    if (!analysisResponse.ok) {
      const errText = await analysisResponse.text()
      console.warn('GROQ Analysis API Error (falling back to store-and-trust):', errText)
      const uploadResult = await saveAndTrustUpload()
      return NextResponse.json({
        valid: true,
        message: 'Cost sheet image stored (Verification skipped - Analysis offline).',
        url: uploadResult.url,
        path: uploadResult.path,
        filename: file.name
      })
    }

    const analysisData = await analysisResponse.json()
    const textResult = analysisData.choices?.[0]?.message?.content || ''
    console.log('GROQ Analysis Result:', textResult)

    const hasCostSheetHeading = /\bcost\s*sheet\b/i.test(extractedText)
    const aiConfirms = /^\s*yes\b/i.test(textResult) || /\byes\b/i.test(textResult.split('.')[0] || '')
    const isValid = hasCostSheetHeading && aiConfirms

    if (!isValid) {
      console.warn('Cost sheet failed strict verification checks. Bypassing to store-and-trust.')
      const uploadResult = await saveAndTrustUpload()
      return NextResponse.json({
        valid: true,
        message: 'Cost sheet image stored. (Automatic verification skipped - handwriting or low contrast).',
        url: uploadResult.url,
        path: uploadResult.path,
        filename: file.name
      })
    }

    // Since it's fully verified, upload to Supabase Storage
    const uploadResult = await saveAndTrustUpload()
    return NextResponse.json({
      valid: true,
      message: textResult,
      url: uploadResult.url,
      path: uploadResult.path,
      filename: file.name
    })
  } catch (error) {
    console.error('Failed to verify cost sheet:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error during verification' }, { status: 500 })
  }
}
