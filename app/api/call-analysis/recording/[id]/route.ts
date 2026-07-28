import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canViewCallAnalysis } from '@/lib/callyzer/access'
import { getCallById } from '@/lib/callyzer/client'

export const dynamic = 'force-dynamic'
// Without these the function has no ceiling on either axis. The log contains a 111-minute call, and
// on Fluid the whole proxied transfer bills as Active CPU, so an uncapped stream is both a cost and
// a reliability problem.
export const maxDuration = 60

/** Refuse anything implausible for a phone call recording rather than streaming it blind. */
const MAX_RECORDING_BYTES = 120 * 1024 * 1024
/** Upstream must at least start responding promptly; a hung fetch would otherwise hold the function. */
const UPSTREAM_TIMEOUT_MS = 15_000

/**
 * Authenticated audio proxy for call recordings.
 *
 * ⚠️ WHY THIS EXISTS: Callyzer serves recordings from a PUBLIC, unauthenticated path —
 * media1.callyzer.co/public/<tenant>/<agent>/<date>/<agent>_<client>_<date>_<time>.mp3 — verified by
 * fetching a real customer recording with no credentials at all. The path is also guessable from a
 * phone number and a timestamp. Putting those URLs in our HTML would let anyone who views source
 * (or shares a link) hand out customer call audio permanently.
 *
 * So the browser only ever receives our own /api/call-analysis/recording/<call id>. Access is
 * re-checked per request, and the audio is streamed through. Range requests are forwarded so the
 * <audio> element can seek.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canViewCallAnalysis(appUser.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  if (!id) return NextResponse.json({ error: 'Missing call id' }, { status: 400 })

  try {
    // Resolve the upstream URL from the cached log rather than trusting anything client-supplied —
    // the client never sees or sends a URL, only an opaque call id.
    const call = await getCallById(id)
    if (!call || !call.recordingUrl) {
      return NextResponse.json({ error: 'Recording not available for this call' }, { status: 404 })
    }

    const range = request.headers.get('range')
    const upstream = await fetch(call.recordingUrl, {
      headers: range ? { Range: range } : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: 'Upstream recording unavailable' }, { status: 502 })
    }

    const headers = new Headers()
    headers.set('Content-Type', upstream.headers.get('content-type') || 'audio/mpeg')
    const len = upstream.headers.get('content-length')
    if (len) {
      // Reject oversized bodies before streaming rather than discovering the size mid-transfer.
      if (Number(len) > MAX_RECORDING_BYTES) {
        return NextResponse.json({ error: 'Recording is too large to stream' }, { status: 413 })
      }
      headers.set('Content-Length', len)
    }
    const contentRange = upstream.headers.get('content-range')
    if (contentRange) headers.set('Content-Range', contentRange)
    headers.set('Accept-Ranges', 'bytes')
    // Private: it may sit in the user's own browser cache, never in a shared/CDN cache.
    headers.set('Cache-Control', 'private, max-age=600')
    headers.set('Content-Disposition',
      `inline; filename="call-${call.callDate}-${call.clientNumber || 'unknown'}.mp3"`)

    return new NextResponse(upstream.body, { status: upstream.status, headers })
  } catch (error) {
    console.error('Recording proxy failed:', error)
    return NextResponse.json({ error: 'Failed to stream recording' }, { status: 500 })
  }
}
