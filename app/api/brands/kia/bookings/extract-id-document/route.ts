import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireBrandSectionApiAccess } from '@/lib/auth/brand-access'

// Uploads a customer ID document (PAN / Aadhaar / Employee ID) for a KIA booking and, for PAN &
// Aadhaar IMAGES, reads the number off the card with Groq vision. PDFs are stored but not OCR'd
// (the vision model can't read PDFs) — the client then asks the user to type the number manually.
//
// IMPORTANT: the original (full-res) file is stored, but the image sent to Groq is DOWNSCALED with
// sharp first. Groq's vision API rejects base64 images above ~4MB ("invalid image data"), so a
// normal phone photo of a card would otherwise fail silently. Resizing also normalizes HEIC/PNG/etc
// to JPEG, which the model reads reliably.

const ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf',
])
const MAX_FILE_SIZE = 15 * 1024 * 1024 // 15MB — ID cards are small
type DocType = 'pan' | 'aadhaar' | 'employee_id'

// Server-side extraction — never trust the model's formatting; pull the number out with a regex.
function extractPan(text: string): string | null {
  // Cards/OCR sometimes space the characters (e.g. "ABCDE 1234 F"), so strip whitespace first.
  const cleaned = String(text || '').toUpperCase().replace(/\s+/g, '')
  const match = cleaned.match(/[A-Z]{5}[0-9]{4}[A-Z]/)
  return match ? match[0] : null
}
function extractAadhaar(text: string): string | null {
  const t = String(text || '')
  // Prefer the printed 4-4-4 grouping, bounded so we don't grab digits out of a longer number.
  const grouped = t.match(/(?<!\d)\d{4}\s?\d{4}\s?\d{4}(?!\d)/)
  if (grouped) return grouped[0].replace(/\D/g, '')
  // Else a standalone 12-digit token.
  const contiguous = t.match(/(?<!\d)\d{12}(?!\d)/)
  return contiguous ? contiguous[0] : null
}

// Downscale + re-encode to JPEG so the payload stays comfortably under Groq's ~4MB image limit.
async function toGroqImage(buffer: Buffer, mimeType: string): Promise<{ base64: string; mime: string }> {
  try {
    const out = await sharp(buffer, { failOn: 'none' })
      .rotate() // honour EXIF orientation (phone photos)
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer()
    return { base64: out.toString('base64'), mime: 'image/jpeg' }
  } catch (error) {
    console.error('sharp resize failed, sending original image:', error)
    return { base64: buffer.toString('base64'), mime: mimeType }
  }
}

async function groqVision(prompt: string, base64: string, mime: string, apiKey: string): Promise<string> {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
        ],
      }],
      max_tokens: 300,
      temperature: 0,
    }),
  })
  if (!response.ok) {
    console.error('GROQ Vision API error (extract-id-document):', response.status, (await response.text()).slice(0, 300))
    return ''
  }
  const data = await response.json()
  return data.choices?.[0]?.message?.content || ''
}

// Two passes: a targeted "read the number" prompt, then an "extract all text" fallback if it misses.
async function ocrIdNumber(buffer: Buffer, mimeType: string, apiKey: string, docType: 'pan' | 'aadhaar'): Promise<string | null> {
  const { base64, mime } = await toGroqImage(buffer, mimeType)
  const extract = docType === 'pan' ? extractPan : extractAadhaar
  const targeted = docType === 'pan'
    ? 'This is an Indian PAN card (Income Tax Department). Read the 10-character PAN number — 5 uppercase letters, then 4 digits, then 1 uppercase letter (e.g. ABCDE1234F). Reply with ONLY the PAN and nothing else.'
    : 'This is an Indian Aadhaar card. Read the 12-digit Aadhaar number (three groups of four digits, e.g. 9183 0074 6619). Reply with ONLY the 12 digits and nothing else.'

  const pass1 = await groqVision(targeted, base64, mime, apiKey)
  let number = extract(pass1)
  if (number) return number

  const pass2 = await groqVision('Extract ALL text printed on this identity card, exactly as shown. Output raw text only, no commentary.', base64, mime, apiKey)
  number = extract(pass2)
  if (!number) {
    console.warn(`[extract-id ${docType}] no number read. pass1="${pass1.slice(0, 60)}" pass2="${pass2.slice(0, 160)}"`)
  }
  return number
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

    // 1. Store the ORIGINAL document (service role → bypasses storage RLS; upload happens before the
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
          number = await ocrIdNumber(buffer, mimeType, apiKey, docType)
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
