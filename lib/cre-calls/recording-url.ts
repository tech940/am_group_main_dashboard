import 'server-only'

import { getCreSupabase } from './cre-supabase'

/**
 * Finding and signing CRE call recordings — shared by the playback route and the AI Call Review worker.
 *
 * `call_recordings.storage_path` points into the PRIVATE `recordings` bucket of the CRE Supabase project. A
 * public URL built from it 404s, and publishing one would expose customer audio to anyone holding the link, so
 * nothing may call `getPublicUrl`. The path is always looked up server-side from an id — a caller-supplied path
 * would turn signing into a read primitive for the whole bucket.
 */

export type RecordingRef = { id: string; storage_path: string | null; upload_status: string | null; deleted_at: string | null }

const REF_COLUMNS = 'id, storage_path, upload_status, deleted_at'

/**
 * The recording behind an id that may be a recording id, a call id from `v_calls_with_numbers`, or a
 * `call_log_entries` id — the Recordings tab has used all three.
 */
export async function resolveRecordingRef(id: string): Promise<RecordingRef | null> {
  const supabase = getCreSupabase()

  const direct = await supabase.from('call_recordings').select(REF_COLUMNS).eq('id', id).maybeSingle()
  if (direct.error) throw new Error(direct.error.message)
  if (direct.data) return direct.data as RecordingRef

  const viewEntry = await supabase.from('v_calls_with_numbers').select('id, recording_id').eq('id', id).maybeSingle()
  if (viewEntry.data?.recording_id) {
    const rec = await supabase.from('call_recordings').select(REF_COLUMNS).eq('id', viewEntry.data.recording_id).maybeSingle()
    if (rec.error) throw new Error(rec.error.message)
    return (rec.data as RecordingRef | null) ?? null
  }

  const logEntry = await supabase.from('call_log_entries').select('id, recording_id, deleted_at').eq('id', id).maybeSingle()
  if (logEntry.error) throw new Error(logEntry.error.message)
  if (logEntry.data?.recording_id) {
    const rec = await supabase.from('call_recordings').select(REF_COLUMNS).eq('id', logEntry.data.recording_id).maybeSingle()
    if (rec.error) throw new Error(rec.error.message)
    return (rec.data as RecordingRef | null) ?? null
  }
  if (logEntry.data) {
    const rec = await supabase.from('call_recordings').select(REF_COLUMNS).eq('call_id', logEntry.data.id).maybeSingle()
    if (rec.error) throw new Error(rec.error.message)
    return (rec.data as RecordingRef | null) ?? null
  }
  return null
}

/** Bucket-relative key: stored paths sometimes carry a leading "recordings/". */
export function bucketPath(storagePath: string): string {
  return storagePath.replace(/^recordings\//, '')
}

/** One short-lived signed URL. Throws when storage refuses — there is deliberately no public-URL fallback. */
export async function signRecordingPath(storagePath: string, ttlSeconds: number): Promise<string> {
  const { data, error } = await getCreSupabase().storage.from('recordings').createSignedUrl(bucketPath(storagePath), ttlSeconds)
  if (error || !data?.signedUrl) throw new Error(error?.message || 'Storage did not return a signed URL')
  return data.signedUrl
}

/** Many at once (one storage call). Returns stored path → URL; paths storage could not sign are absent. */
export async function signRecordingPaths(storagePaths: string[], ttlSeconds: number): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (storagePaths.length === 0) return out
  const keys = storagePaths.map(bucketPath)
  const { data, error } = await getCreSupabase().storage.from('recordings').createSignedUrls(keys, ttlSeconds)
  if (error) throw new Error(error.message)
  for (const item of data ?? []) {
    if (!item.signedUrl || item.error || !item.path) continue
    const index = keys.indexOf(item.path)
    if (index >= 0) out.set(storagePaths[index], item.signedUrl)
  }
  return out
}
