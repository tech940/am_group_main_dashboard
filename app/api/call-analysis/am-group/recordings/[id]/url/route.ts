import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canViewCallAnalysis } from '@/lib/callyzer/access'
import { getCreSupabase } from '@/lib/cre-calls/cre-supabase'

export const dynamic = 'force-dynamic'

/**
 * Short-lived signed playback URL for one CRE call recording.
 *
 * `call_recordings.storage_path` points into the PRIVATE `recordings` bucket of the CRE Supabase
 * project. A public URL built from that path does not work — it 404s — and publishing one would
 * expose customer call audio to anyone holding the link, so nothing in this section may call
 * `getPublicUrl`. The only correct read is `createSignedUrl`.
 *
 * Why this is its own route rather than signing in the list endpoint:
 *  - the browser has no client for the CRE project (and must never get one — the credential is a
 *    service-role key), so signing has to happen server-side;
 *  - a URL signed while a page renders is stale before most rows are ever played. Signing on demand
 *    means the URL is always fresh at the moment of playback;
 *  - a page of 20 rows costs 20 storage calls to pre-sign, nearly all of them wasted.
 *
 * The path is looked up here from the row id. It is never accepted from the client: signing a
 * caller-supplied path would turn this into a read primitive for the entire bucket.
 */

/** Matches the handover doc. Long enough to start playback, short enough to be useless if leaked. */
const SIGNED_URL_TTL_SECONDS = 300

// Explicit param typing, not `RouteContext<'…'>` — that generic resolves against Next's GENERATED
// route types, which do not exist for a route added in the same pass, so it fails to compile.
// Every other dynamic route in this repo uses this shape.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!canViewCallAnalysis(appUser.role)) {
    return NextResponse.json({ error: 'You do not have access to Call Analysis.' }, { status: 403 })
  }

  const { id } = await params

  try {
    const supabase = getCreSupabase()
    const { data: row, error } = await supabase
      .from('call_recordings')
      .select('id, storage_path, upload_status, deleted_at')
      .eq('id', id)
      .maybeSingle()

    if (error) throw new Error(error.message)
    if (!row || row.deleted_at) {
      return NextResponse.json({ error: 'Recording not found' }, { status: 404 })
    }

    // Only an `uploaded` row has an object behind it. Signing a `pending` / `uploading` / `failed`
    // path returns a URL that 404s, which reads to the user as "the dashboard is broken".
    if (row.upload_status !== 'uploaded' || !row.storage_path) {
      return NextResponse.json(
        {
          error:
            row.upload_status === 'failed'
              ? 'This recording failed to upload from the handset, so there is no audio to play.'
              : 'This recording is still syncing from the handset. Audio appears once the upload completes.',
          uploadStatus: row.upload_status ?? null,
        },
        { status: 409 }
      )
    }

    const { data: signed, error: signError } = await supabase.storage
      .from('recordings')
      .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS)

    // No public-URL fallback on purpose: the bucket is private, so a public URL would 404 at best
    // and leak customer audio at worst. A failure to sign is reported as a failure.
    if (signError || !signed?.signedUrl) {
      throw new Error(signError?.message || 'Storage did not return a signed URL')
    }

    return NextResponse.json({ url: signed.signedUrl, expiresInSeconds: SIGNED_URL_TTL_SECONDS })
  } catch (error) {
    console.error('[AM-Group-Call-Recording-URL] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to sign recording URL' },
      { status: 500 }
    )
  }
}
