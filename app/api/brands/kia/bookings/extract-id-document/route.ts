import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireBrandSectionApiAccess } from '@/lib/auth/brand-access'

// Uploads a customer ID document (PAN / Aadhaar / Employee ID) for a KIA booking and, for PAN &
// Aadhaar IMAGES, reads the number off the card with Groq vision. PDFs are stored but not OCR'd
// (the vision model can't read PDFs) — the client then asks the user to type the number manually.
// Modelled on ./verify-cost-sheet/route.ts (same Groq vision + supabaseAdmin upload pattern).

const ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf',
])
const MAX_FILE_SIZE = 15 * 1024 * 1024 // 15MB — ID cards are small
type DocType = 'pan' | 'aadhaar' | 'employee_id'

// Server-side extraction — never trust the model's formatting; pull the number out with a regex.
function extractPan(text: string): string | null {
  const match = String(text || '').toUpperCase().match(/[A-Z]{5}[0-9]{4}[A-Z]/)
  return match ? match[0] : null
}
function extractAadhaar(text: string): string | null {
  const match = String(text || '').match(/\d{4}\s?\d{4}\s?\d{4}/)
  if (!match) return null
  const digits = match[0].replace(/\D/g, '')
  return digits.length === 12 ? digits : null
}

async function ocrExtractText(base64: string, mimeType: string, apiKey: string): Promise<string> {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Extract all readable text from this identity card image. Do not summarize, just output the raw text exactly as printed.' },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
        ],
      }],
      max_tokens: 1000,
      temperature: 0,
    }),
  })
  if (!response.ok) {
    console.error('GROQ Vision API error (extract-id-document):', await response.text())
    return ''
  }
  const data = await response.json()
  return data.choices?.[0]?.message?.content || ''
}

export async function POST(request: Request) {
  const accessError = await requireBrandSectionApiAccess('kia', 'kia.bookings.view')
  if (accessError) return accessError
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const docType = String(formData.get('docType') || '') as DocType
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    if (!['pan', 'aadhaar', 'employee_id'].includes(docType)) {
      return NextResponse.json({ error: 'Invalid docType' }, { status: 400 })
    }
    const mimeType = file.type || 'application/octet-stream'
    if (!ALLOWED_TYPES.has(mimeType)) {
      return NextResponse.json({ error: 'Unsupported file type. Upload a PDF, JPG, PNG or WEBP.' }, { status: 400 })
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File is too large (max 15MB).' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const isPdf = mimeType === 'application/pdf'

    // 1. Store the document (service role → bypasses storage RLS; upload happens before the
    //    booking exists, so the filename is self-generated like the cost-sheet flow).
    const timestamp = Date.now()
    const randomStr = Math.random().toString(36).substring(7)
    const extension = file.name.split('.').pop() || (isPdf ? 'pdf' : 'jpg')
    const filePath = `kia-bookings/id-documents/${docType}_${timestamp}_${randomStr}.${extension}`
    const { error: uploadError } = await supabaseAdmin.storage
      .from('purchase-orders')
      .upload(filePath, buffer, { contentType: mimeType, upsert: false })
    if (uploadError) {
      console.error('Supabase upload error (extract-id-document):', uploadError)
      return NextResponse.json({ error: 'Failed to upload document: ' + uploadError.message }, { status: 500 })
    }
    const { data: urlData } = supabaseAdmin.storage.from('purchase-orders').getPublicUrl(filePath)

    // 2. OCR the number for PAN/Aadhaar images. PDFs and Employee ID skip OCR (manual entry).
    let number: string | null = null
    let pdfManual = false
    if (docType === 'employee_id') {
      // No number to read.
    } else if (isPdf) {
      pdfManual = true
    } else {
      const apiKey = process.env.GROQ_API_KEY
      if (apiKey) {
        try {
          const text = await ocrExtractText(buffer.toString('base64'), mimeType, apiKey)
          number = docType === 'pan' ? extractPan(text) : extractAadhaar(text)
        } catch (ocrError) {
          console.error('OCR failed (extract-id-document):', ocrError)
        }
      }
    }

    return NextResponse.json({
      ok: true,
      docType,
      number,
      pdfManual,
      url: urlData.publicUrl,
      path: filePath,
      filename: file.name,
    })
  } catch (error) {
    console.error('extract-id-document failed:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  }
}
