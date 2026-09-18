import { NextResponse } from 'next/server'
import { isCallAiAdmin, requireCallAnalysisApi } from '@/lib/call-analysis/access'
import { writeState } from '@/lib/call-ai/queue'
import { pipelineStatus } from '@/lib/call-ai/read'

export const dynamic = 'force-dynamic'

async function admin() {
  const access = await requireCallAnalysisApi()
  if ('denied' in access) return access
  if (!isCallAiAdmin(access.appUser.role)) {
    return { denied: NextResponse.json({ error: 'Only the MD or a developer can see the AI pipeline.' }, { status: 403 }) }
  }
  return access
}

/** Pipeline health for the MD / developers: backlog, failures, last run, today's audio and cost. */
export async function GET() {
  const access = await admin()
  if ('denied' in access) return access.denied
  try {
    return NextResponse.json(await pipelineStatus(), { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('[call-ai] status failed:', error)
    return NextResponse.json({ error: 'Could not load the AI pipeline status.' }, { status: 500 })
  }
}

/** `{ "enabled": false }` pauses the pipeline without a redeploy; `true` resumes it. */
export async function PATCH(request: Request) {
  const access = await admin()
  if ('denied' in access) return access.denied
  const body = await request.json().catch(() => null)
  if (typeof (body as { enabled?: unknown } | null)?.enabled !== 'boolean') {
    return NextResponse.json({ error: 'Send { "enabled": true | false }.' }, { status: 400 })
  }
  try {
    await writeState({ enabled: (body as { enabled: boolean }).enabled })
    return NextResponse.json(await pipelineStatus())
  } catch (error) {
    console.error('[call-ai] toggle failed:', error)
    return NextResponse.json({ error: 'Could not change the AI pipeline.' }, { status: 500 })
  }
}
