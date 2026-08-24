import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireBankSanctionsApiAccess } from '@/lib/bank-sanctions/api-guard'

export const dynamic = 'force-dynamic'

/**
 * Sanction-letter PDF upload.
 *
 * ⚠️ AUTHENTICATED, unlike app/api/brands/kia/approvals/upload — that route is deliberately open
 * because its submitters have no login. Bank sanction users are all logged-in staff, and these
 * documents are the bank's sanction letters, so the same four-role gate as the rest of the section
 * applies here. Do not copy the approvals route's openness "for consistency".
 */
export async function POST(request: NextRequest) {
  try {
    const gate = await requireBankSanctionsApiAccess()
    if (gate.response) return gate.response

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    if (file.size > 15 * 1024 * 1024) {
      return NextResponse.json({ error: 'File size exceeds 15MB limit' }, { status: 400 })
    }
    // The sheet accepted PDFs only; keep that contract — a sanction letter is a PDF.
    if (file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Only PDF files are accepted' }, { status: 400 })
    }

    const filename = `sanction_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.pdf`
    const filePath = `bank-sanctions/${filename}`

    const { error } = await supabaseAdmin.storage
      .from('purchase-orders')
      .upload(filePath, Buffer.from(await file.arrayBuffer()), {
        contentType: 'application/pdf',
        upsert: false,
      })
    if (error) {
      console.error('Bank sanction upload failed:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const { data: urlData } = supabaseAdmin.storage.from('purchase-orders').getPublicUrl(filePath)
    return NextResponse.json({ url: urlData.publicUrl, path: filePath })
  } catch (error) {
    console.error('POST /api/bank-sanctions/upload failed:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
