import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCallAnalysisApi } from '@/lib/call-analysis/access'
import { saveFeedback } from '@/lib/call-ai/read'
import { VERDICTS } from '@/lib/call-ai/types'

export const dynamic = 'force-dynamic'

const Body = z.object({
  verdictOk: z.boolean(),
  correctedVerdict: z.enum(VERDICTS).nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
}).refine((b) => b.verdictOk || Boolean(b.correctedVerdict) || Boolean(b.note), {
  message: 'Say what the verdict should be, or add a note.',
})

/** "This verdict is right / wrong". Kept forever; a corrected verdict replaces the AI's on screen. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireCallAnalysisApi()
  if ('denied' in access) return access.denied
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const raw = await request.text()
  if (raw.length > 4096) return NextResponse.json({ error: 'Too large' }, { status: 413 })
  let json: unknown
  try { json = JSON.parse(raw || '{}') } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = Body.safeParse(json)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid feedback' }, { status: 400 })

  try {
    const ok = await saveFeedback({
      reviewId: id,
      userId: access.appUser.id,
      userName: access.appUser.fullName || access.appUser.email || null,
      verdictOk: parsed.data.verdictOk,
      correctedVerdict: parsed.data.verdictOk ? null : parsed.data.correctedVerdict ?? null,
      note: parsed.data.note || null,
    })
    if (!ok) return NextResponse.json({ error: 'Only a finished review can be rated.' }, { status: 409 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[call-ai] feedback failed:', error)
    return NextResponse.json({ error: 'Could not save your feedback.' }, { status: 500 })
  }
}
