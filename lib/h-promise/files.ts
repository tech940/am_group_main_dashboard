import 'server-only'

import { randomUUID } from 'node:crypto'
import { and, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { tataHPromiseFiles } from '@/lib/db/schema'
import { HPromiseError, type HPromiseActor } from './access'
import { canOpenFileKind, canUploadFileKind, type HPromiseCapabilities } from './access-shared'
import { FILE_KIND_POLICY, isFileKind, type FileKind } from './constants'
import { recordHPromiseEvent, type Tx } from './events'
import { removeHPromiseObjects, signHPromisePath, storeHPromiseFile } from './storage'
import type { HpUploadResult } from './types'

/**
 * Files, in two steps.
 *
 *   1. STAGE — one file per request (Vercel refuses bodies over 4.5 MB). The file is checked, stored under the
 *      uploader's own folder, and gets a row with attached_at NULL. Nothing points at it yet.
 *   2. ATTACH — the form that uses it is saved; inside that form's transaction the staged row is bound to the
 *      vehicle (or booking) and the file it replaces is marked superseded. If the form fails, the staged file
 *      stays unattached and the sweep removes it a day later.
 *
 * ⚠️ Only the person who staged a file can attach it: the attach UPDATE is keyed on uploaded_by. A staged
 * file id seen in someone else's request is useless to them.
 */

export async function stageUpload(input: {
  actor: HPromiseActor
  caps: HPromiseCapabilities
  kind: FileKind
  bytes: Buffer
  originalName: string | null
}): Promise<HpUploadResult> {
  const { actor, caps, kind, bytes } = input
  if (!canUploadFileKind(caps, kind)) {
    throw new HPromiseError(`You cannot upload a ${FILE_KIND_POLICY[kind].label.toLowerCase()}.`, 403)
  }
  const fileId = randomUUID()
  const stored = await storeHPromiseFile({ bytes, kind, folder: `u-${actor.id}`, fileId })
  try {
    await db.insert(tataHPromiseFiles).values({
      id: fileId,
      kind,
      storagePath: stored.path,
      contentType: stored.contentType,
      sizeBytes: stored.sizeBytes,
      sha256: stored.sha256,
      originalName: input.originalName ? input.originalName.slice(0, 120) : null,
      source: 'upload',
      uploadedBy: actor.id,
      uploadedByName: actor.name,
    })
  } catch (error) {
    await removeHPromiseObjects([stored.path])
    throw error
  }
  // The uploader sees what they just sent, whatever its kind: it is their own file.
  const previewUrl = stored.contentType.startsWith('image/') ? await signHPromisePath(stored.path) : null
  return { fileId, kind, contentType: stored.contentType, sizeBytes: stored.sizeBytes, previewUrl }
}

export type AttachedFile = { kind: FileKind; fileId: string; replaced: boolean }

/**
 * Binds staged files to a vehicle or booking. Call INSIDE the form's transaction.
 * `files` is `{kind: stagedFileId}`; kinds outside `allowed` are refused.
 */
export async function attachStagedFiles(
  tx: Tx,
  input: {
    actor: HPromiseActor
    vehicleId: string
    bookingId?: string | null
    files: Partial<Record<FileKind, string | undefined>>
    allowed: readonly FileKind[]
  },
): Promise<AttachedFile[]> {
  const attached: AttachedFile[] = []
  const now = new Date()
  for (const [kind, fileId] of Object.entries(input.files) as Array<[FileKind, string | undefined]>) {
    if (!fileId) continue
    if (!input.allowed.includes(kind)) {
      throw new HPromiseError(`A ${FILE_KIND_POLICY[kind]?.label.toLowerCase() ?? 'file'} cannot be attached here.`, 400)
    }
    const bookingId = input.bookingId ?? null
    // Supersede first: the unique index allows one current file per slot.
    const replaced = await tx
      .update(tataHPromiseFiles)
      .set({ supersededAt: now, supersededBy: fileId })
      .where(and(
        eq(tataHPromiseFiles.vehicleId, input.vehicleId),
        eq(tataHPromiseFiles.kind, kind),
        isNotNull(tataHPromiseFiles.attachedAt),
        isNull(tataHPromiseFiles.supersededAt),
        bookingId ? eq(tataHPromiseFiles.bookingId, bookingId) : isNull(tataHPromiseFiles.bookingId),
      ))
      .returning({ id: tataHPromiseFiles.id })
    const bound = await tx
      .update(tataHPromiseFiles)
      .set({ vehicleId: input.vehicleId, bookingId, attachedAt: now })
      .where(and(
        eq(tataHPromiseFiles.id, fileId),
        eq(tataHPromiseFiles.kind, kind),
        eq(tataHPromiseFiles.uploadedBy, input.actor.id),
        isNull(tataHPromiseFiles.attachedAt),
      ))
      .returning({ id: tataHPromiseFiles.id })
    if (bound.length === 0) {
      throw new HPromiseError(`The ${FILE_KIND_POLICY[kind].label.toLowerCase()} upload has expired. Upload it again.`, 400)
    }
    attached.push({ kind, fileId, replaced: replaced.length > 0 })
  }
  return attached
}

/** History-friendly summary of what a form attached: `{files: {rc: 'added', insurance_copy: 'replaced'}}`. */
export function describeAttached(attached: AttachedFile[]): Record<string, unknown> {
  if (attached.length === 0) return {}
  return { files: Object.fromEntries(attached.map((file) => [file.kind, file.replaced ? 'replaced' : 'added'])) }
}

/** Current file kinds on a vehicle (not booking files). */
export async function currentFileKinds(vehicleId: string, writer: Tx | typeof db = db): Promise<Set<FileKind>> {
  const rows = await writer
    .select({ kind: tataHPromiseFiles.kind })
    .from(tataHPromiseFiles)
    .where(and(
      eq(tataHPromiseFiles.vehicleId, vehicleId),
      isNotNull(tataHPromiseFiles.attachedAt),
      isNull(tataHPromiseFiles.supersededAt),
      isNull(tataHPromiseFiles.bookingId),
    ))
  return new Set(rows.map((row) => row.kind).filter(isFileKind))
}

/** Retire a vehicle's current files of these kinds (a withdrawn sale takes its paperwork with it). */
export async function supersedeKinds(tx: Tx, vehicleId: string, kinds: readonly FileKind[]): Promise<number> {
  if (kinds.length === 0) return 0
  const rows = await tx
    .update(tataHPromiseFiles)
    .set({ supersededAt: new Date() })
    .where(and(
      eq(tataHPromiseFiles.vehicleId, vehicleId),
      inArray(tataHPromiseFiles.kind, [...kinds]),
      isNotNull(tataHPromiseFiles.attachedAt),
      isNull(tataHPromiseFiles.supersededAt),
      isNull(tataHPromiseFiles.bookingId),
    ))
    .returning({ id: tataHPromiseFiles.id })
  return rows.length
}

/**
 * A signed URL for one file, after checking this person may open it. Opening a personal document is itself
 * recorded in the vehicle's history (owner decision: full change history, and who looked at a PAN matters).
 */
export async function openFile(actor: HPromiseActor, caps: HPromiseCapabilities, fileId: string, download: boolean): Promise<string> {
  const [file] = await db.select().from(tataHPromiseFiles).where(eq(tataHPromiseFiles.id, fileId)).limit(1)
  if (!file || !isFileKind(file.kind)) throw new HPromiseError('That file was not found.', 404)

  const ownStaged = !file.attachedAt && file.uploadedBy === actor.id
  if (!ownStaged) {
    if (!file.attachedAt) throw new HPromiseError('That file was not found.', 404)
    if (!canOpenFileKind(caps, file.kind)) throw new HPromiseError('You cannot open this document.', 403)
  }

  const policy = FILE_KIND_POLICY[file.kind]
  const extension = file.storagePath.split('.').pop() ?? 'bin'
  const url = await signHPromisePath(file.storagePath, download ? `${policy.label.replace(/[^A-Za-z0-9]+/g, '-')}.${extension}` : undefined)
  if (!url) throw new HPromiseError('That file could not be opened. It may have been removed from storage.', 404)

  if (!ownStaged && policy.sensitivity !== 'normal' && file.vehicleId) {
    await recordHPromiseEvent(db, {
      vehicleId: file.vehicleId,
      subject: 'file',
      subjectId: file.id,
      action: download ? 'document_downloaded' : 'document_viewed',
      actor,
      changes: { kind: file.kind },
    })
  }
  return url
}

let lastSweep = 0
const SWEEP_EVERY_MS = 30 * 60 * 1000

/**
 * Removes uploads that were staged more than a day ago and never attached (a form that was abandoned).
 * Cheap and bounded: at most once per half hour per server instance, 100 files at a time.
 */
export async function sweepStaleStagedFiles(): Promise<number> {
  if (Date.now() - lastSweep < SWEEP_EVERY_MS) return 0
  lastSweep = Date.now()
  const stale = await db
    .select({ id: tataHPromiseFiles.id, path: tataHPromiseFiles.storagePath })
    .from(tataHPromiseFiles)
    .where(and(isNull(tataHPromiseFiles.attachedAt), lt(tataHPromiseFiles.uploadedAt, sql`now() - interval '24 hours'`)))
    .limit(100)
  if (stale.length === 0) return 0
  const removed = await db
    .delete(tataHPromiseFiles)
    .where(and(inArray(tataHPromiseFiles.id, stale.map((row) => row.id)), isNull(tataHPromiseFiles.attachedAt)))
    .returning({ path: tataHPromiseFiles.storagePath })
  await removeHPromiseObjects(removed.map((row) => row.path))
  return removed.length
}
