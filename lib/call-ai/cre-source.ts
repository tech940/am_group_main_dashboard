import 'server-only'

import { getCreSupabase } from '@/lib/cre-calls/cre-supabase'
import { loadCreDirectory, type CreDirectory } from '@/lib/cre-calls/directory'
import { signRecordingPaths } from '@/lib/cre-calls/recording-url'

/**
 * Everything AI Call Review reads from the CRE Supabase project, behind one interface so the verifier can run
 * the whole pipeline against a fake. READ ONLY — this module never writes to that project.
 */

export type CreRecording = {
  id: string
  call_id: string | null
  cre_id: string | null
  branch_id: string | null
  call_type: string | null
  duration_seconds: number | null
  recorded_at: string | null
  uploaded_at: string | null
  updated_at: string
  deleted_at: string | null
  upload_status: string | null
  storage_path: string | null
  format: string | null
  mime_type: string | null
  size_bytes: number | null
  phone: string | null
  /** The name saved on the handset. Display only — never sent to any model. */
  contact_name: string | null
}

export type CreSource = {
  loadDirectory(): Promise<CreDirectory>
  /** Uploaded, not-deleted recordings changed at/after `sinceAt`, keyset-paged on (updated_at, id). */
  listChanged(sinceAt: string, after: { at: string; id: string } | null, limit: number): Promise<CreRecording[]>
  /** Uploaded, not-deleted recordings RECORDED in [fromIso, toIso) — the nightly safety sweep. */
  listRecorded(fromIso: string, toIso: string, afterId: string | null, limit: number): Promise<CreRecording[]>
  /** Recordings soft-deleted after `sinceAt`, oldest first. */
  listDeleted(sinceAt: string, limit: number): Promise<Array<{ id: string; deleted_at: string }>>
  getByIds(ids: string[]): Promise<CreRecording[]>
  signPaths(paths: string[], ttlSeconds: number): Promise<Map<string, string>>
  /** Fetch the audio behind a signed URL, refusing anything over `maxBytes`. */
  download(url: string, maxBytes: number, timeoutMs: number): Promise<Uint8Array>
}

export const RECORDING_COLUMNS =
  'id, call_id, cre_id, branch_id, call_type, duration_seconds, recorded_at, uploaded_at, updated_at, deleted_at, upload_status, storage_path, format, mime_type, size_bytes, phone, contact_name'

/** PostgREST logical-filter values must be double-quoted when they contain `.`, `:`, `,` or `+`. */
function q(value: string): string {
  return `"${value.replace(/"/g, '')}"`
}

export class DownloadError extends Error {
  constructor(message: string, public readonly permanent: boolean) {
    super(message)
    this.name = 'DownloadError'
  }
}

export function supabaseCreSource(): CreSource {
  const supabase = () => getCreSupabase()
  return {
    loadDirectory: () => loadCreDirectory(),

    async listChanged(sinceAt, after, limit) {
      let query = supabase()
        .from('call_recordings')
        .select(RECORDING_COLUMNS)
        .eq('upload_status', 'uploaded')
        .is('deleted_at', null)
        .not('storage_path', 'is', null)
        .gte('updated_at', sinceAt)
      if (after) query = query.or(`updated_at.gt.${q(after.at)},and(updated_at.eq.${q(after.at)},id.gt.${after.id})`)
      const { data, error } = await query.order('updated_at', { ascending: true }).order('id', { ascending: true }).limit(limit)
      if (error) throw new Error(`CRE listChanged: ${error.message}`)
      return (data ?? []) as CreRecording[]
    },

    async listRecorded(fromIso, toIso, afterId, limit) {
      let query = supabase()
        .from('call_recordings')
        .select(RECORDING_COLUMNS)
        .eq('upload_status', 'uploaded')
        .is('deleted_at', null)
        .not('storage_path', 'is', null)
        .gte('recorded_at', fromIso)
        .lt('recorded_at', toIso)
      if (afterId) query = query.gt('id', afterId)
      const { data, error } = await query.order('id', { ascending: true }).limit(limit)
      if (error) throw new Error(`CRE listRecorded: ${error.message}`)
      return (data ?? []) as CreRecording[]
    },

    async listDeleted(sinceAt, limit) {
      const { data, error } = await supabase()
        .from('call_recordings')
        .select('id, deleted_at')
        .not('deleted_at', 'is', null)
        .gt('deleted_at', sinceAt)
        .order('deleted_at', { ascending: true })
        .limit(limit)
      if (error) throw new Error(`CRE listDeleted: ${error.message}`)
      return (data ?? []) as Array<{ id: string; deleted_at: string }>
    },

    async getByIds(ids) {
      if (ids.length === 0) return []
      const out: CreRecording[] = []
      for (let i = 0; i < ids.length; i += 100) {
        const { data, error } = await supabase().from('call_recordings').select(RECORDING_COLUMNS).in('id', ids.slice(i, i + 100))
        if (error) throw new Error(`CRE getByIds: ${error.message}`)
        out.push(...((data ?? []) as CreRecording[]))
      }
      return out
    },

    signPaths: (paths, ttlSeconds) => signRecordingPaths(paths, ttlSeconds),

    async download(url, maxBytes, timeoutMs) {
      let response: Response
      try {
        response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
      } catch (error) {
        throw new DownloadError(`Audio download failed: ${error instanceof Error ? error.message : String(error)}`, false)
      }
      if (response.status === 404 || response.status === 400) throw new DownloadError(`Audio file not found (${response.status})`, true)
      if (!response.ok || !response.body) throw new DownloadError(`Audio download returned ${response.status}`, false)
      const declared = Number(response.headers.get('content-length'))
      if (Number.isFinite(declared) && declared > maxBytes) throw new DownloadError(`Audio is ${declared} bytes, over the ${maxBytes} limit`, true)

      // Stream with a running cap, so a missing or lying content-length cannot exhaust memory.
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let total = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > maxBytes) {
          await reader.cancel().catch(() => {})
          throw new DownloadError(`Audio exceeded the ${maxBytes}-byte limit`, true)
        }
        chunks.push(value)
      }
      const bytes = new Uint8Array(total)
      let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
      return bytes
    },
  }
}
