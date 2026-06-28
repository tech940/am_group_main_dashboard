import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { db } from '@/lib/db'
import { pettyCashExpenseAttachments } from '@/lib/db/schema'
import { canAccessPettyCash } from '@/lib/petty-cash/access'

const BUCKET_NAME = 'petty-cash'
const MAX_FILE_SIZE = 100 * 1024 * 1024
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

function getExtension(fileName: string) {
  const extension = fileName.split('.').pop()?.toLowerCase()
  return extension && /^[a-z0-9]+$/.test(extension) ? extension : 'bin'
}

export async function POST(request: NextRequest) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccessPettyCash(appUser.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'Storage service role key is not configured' }, { status: 500 })
    }

    const formData = await request.formData()
    const file = formData.get('file')
    const entity = String(formData.get('entity') || 'expense')
    const expenseId = formData.get('expenseId')

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 })
    }

    if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File must be between 1 byte and 100 MB' }, { status: 400 })
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: 'Only PDF and image files are allowed' }, { status: 400 })
    }

    const extension = getExtension(file.name)
    const folder = entity === 'request' ? 'requests' : 'expenses'
    const filePath = `${folder}/${appUser.id}/${Date.now()}-${crypto.randomUUID()}.${extension}`
    const { error } = await supabaseAdmin.storage.from(BUCKET_NAME).upload(filePath, file, {
      contentType: file.type,
      upsert: false,
    })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const { data } = supabaseAdmin.storage.from(BUCKET_NAME).getPublicUrl(filePath)

    if (typeof expenseId === 'string' && expenseId) {
      await db.insert(pettyCashExpenseAttachments).values({
        expenseId,
        fileName: file.name,
        filePath,
        fileUrl: data.publicUrl,
        fileSize: file.size,
        mimeType: file.type,
        uploadedBy: appUser.id,
      })
    }

    return NextResponse.json({
      url: data.publicUrl,
      path: filePath,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
    })
  } catch (error) {
    console.error('POST /api/petty-cash/upload failed:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 })
  }
}
