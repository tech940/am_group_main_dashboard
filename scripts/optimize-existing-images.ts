/**
 * One-time backfill: re-encode images ALREADY in Supabase Storage to WebP and re-point every DB
 * reference at the smaller object. Companion to the new-upload optimiser (lib/images/optimize.ts).
 *
 * SAFETY MODEL (read before running with --apply):
 *  - DRY-RUN BY DEFAULT. Without --apply it downloads + optimises to MEASURE savings but writes
 *    nothing to storage or the DB.
 *  - DEDUPE BY PHYSICAL OBJECT. The same stored object is referenced from several places
 *    (petty-cash billFiles[] ↔ attachments; PO vendorImages[] ↔ grnImages[]; tracker url/path pairs).
 *    Each object is downloaded/optimised/uploaded at most once; a row is updated once with all its
 *    columns rewritten together, so no reference is ever left pointing at a deleted original.
 *  - NON-DESTRUCTIVE. Originals are NEVER deleted unless you pass --delete-originals, and that is only
 *    allowed on a FULL run (no --only / --limit) so every reference has provably been re-pointed first.
 *  - IDEMPOTENT. Objects already ending .webp (and any .pdf/.svg/.gif) are skipped, so re-runs are safe.
 *
 * Flags:
 *   --apply             actually upload WebP + update DB references (default: dry-run)
 *   --delete-originals  after re-pointing, remove the old objects (full run only; implies --apply)
 *   --skip-documents    skip KYC / cost-sheet / invoice images (kia_bookings.metadata)
 *   --only=<table>      restrict to one source: purchase_orders | petty_cash | vehicle_tracker | warranty | kia_bookings
 *   --limit=<n>         cap the number of unique objects processed
 *   --verbose           log every object
 *
 * Run:  npx tsx --tsconfig ./tsconfig.verify.json scripts/optimize-existing-images.ts            (dry-run)
 *       npx tsx --tsconfig ./tsconfig.verify.json scripts/optimize-existing-images.ts --apply --skip-documents
 */
import * as dotenv from 'dotenv'
import * as path from 'path'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  purchaseOrders,
  pettyCashExpenses,
  pettyCashExpenseAttachments,
  kiaVehicleTracker,
  hyundaiWarrantyClaimEvidence,
  kiaBookings,
} from '../lib/db/schema'
import { optimizeImage, type ImagePreset } from '../lib/images/optimize'

// Load env BEFORE we build any client (see the ordering note in the header — we construct the
// Supabase client ourselves rather than importing lib/supabase/admin, which reads env at import time).
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

const BUCKET_PO = 'purchase-orders'
const BUCKET_PETTY = 'petty-cash'
const BUCKET_WARRANTY = 'hyundai-warranty-claims'

type Source = 'purchase_orders' | 'petty_cash' | 'vehicle_tracker' | 'warranty' | 'kia_bookings'

const args = process.argv.slice(2)
const has = (f: string) => args.includes(f)
const val = (f: string) => {
  const hit = args.find((a) => a.startsWith(`${f}=`))
  return hit ? hit.split('=')[1] : undefined
}
const APPLY = has('--apply') || has('--delete-originals')
const DELETE_ORIGINALS = has('--delete-originals')
const SKIP_DOCUMENTS = has('--skip-documents')
const VERBOSE = has('--verbose')
const ONLY = val('--only') as Source | undefined
const LIMIT = val('--limit') ? Math.max(1, parseInt(val('--limit')!, 10)) : Infinity

// Extensions we never bother downloading (already-webp is idempotency; the rest aren't raster photos).
const SKIP_EXT = new Set(['webp', 'pdf', 'svg', 'gif'])
const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', heif: 'image/heif',
}

let supabase: SupabaseClient

// ---- object-level dedupe + measurement -------------------------------------------------------------

type Outcome = { migrated: boolean; newObjectPath?: string; bucket: string; oldObjectPath: string }
const objectCache = new Map<string, Outcome>()
const migratedOriginals: Array<{ bucket: string; objectPath: string }> = []
const failures: string[] = []
let scanned = 0
let bytesBefore = 0
let bytesAfter = 0

function extensionOf(objectPath: string): string {
  const base = objectPath.split('?')[0]
  const ext = base.split('.').pop() || ''
  return ext.toLowerCase()
}

/** Turn a stored reference (a bare path OR a public/signed URL) into a canonical {bucket, objectPath}. */
function parseObjectRef(rawValue: string, defaultBucket: string): { bucket: string; objectPath: string; wasUrl: boolean } | null {
  const value = String(rawValue || '').trim()
  if (!value) return null
  if (/^https?:\/\//i.test(value)) {
    const m = value.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+)$/)
    if (!m) return null
    return { bucket: m[1], objectPath: decodeURIComponent(m[2].split('?')[0]), wasUrl: true }
  }
  return { bucket: defaultBucket, objectPath: value.replace(/^\/+/, ''), wasUrl: false }
}

function withWebpExtension(objectPath: string): string {
  return objectPath.replace(/\.[a-zA-Z0-9]+$/, '') + '.webp'
}

function publicUrl(bucket: string, objectPath: string): string {
  return supabase.storage.from(bucket).getPublicUrl(objectPath).data.publicUrl
}

/** Download → optimise → (apply) upload the WebP. Memoised per physical object; tallies savings once. */
async function ensureMigrated(bucket: string, objectPath: string, category: 'general' | 'document'): Promise<Outcome> {
  const key = `${bucket}::${objectPath}`
  const cached = objectCache.get(key)
  if (cached) return cached

  const miss: Outcome = { migrated: false, bucket, oldObjectPath: objectPath }
  if (objectCache.size >= LIMIT) {
    // Respect --limit on the number of UNIQUE objects touched.
    objectCache.set(key, miss)
    return miss
  }

  try {
    const { data, error } = await supabase.storage.from(bucket).download(objectPath)
    if (error || !data) {
      failures.push(`download ${key}: ${error?.message || 'no data'}`)
      objectCache.set(key, miss)
      return miss
    }
    const original = Buffer.from(await data.arrayBuffer())
    const mime = (data.type && data.type.startsWith('image/')) ? data.type : (MIME_BY_EXT[extensionOf(objectPath)] || 'application/octet-stream')

    const preset: ImagePreset = category === 'document' ? 'document' : 'default'
    const result = await optimizeImage(original, mime, { preset })

    scanned += 1
    if (!result.optimized) {
      if (VERBOSE) console.log(`  skip (no gain) ${key} (${original.byteLength}b)`)
      objectCache.set(key, miss)
      return miss
    }

    bytesBefore += result.originalBytes
    bytesAfter += result.finalBytes
    const newObjectPath = withWebpExtension(objectPath)

    if (APPLY) {
      const up = await supabase.storage.from(bucket).upload(newObjectPath, result.buffer, {
        contentType: 'image/webp',
        upsert: true,
      })
      if (up.error) {
        failures.push(`upload ${bucket}::${newObjectPath}: ${up.error.message}`)
        objectCache.set(key, miss)
        return miss
      }
    }

    const outcome: Outcome = { migrated: true, newObjectPath, bucket, oldObjectPath: objectPath }
    objectCache.set(key, outcome)
    migratedOriginals.push({ bucket, objectPath })
    const pct = Math.round((1 - result.finalBytes / result.originalBytes) * 100)
    if (VERBOSE) console.log(`  ${APPLY ? 'migrated' : 'would migrate'} ${key} → ${newObjectPath} (${result.originalBytes}→${result.finalBytes}b, -${pct}%)`)
    return outcome
  } catch (err) {
    failures.push(`process ${key}: ${err instanceof Error ? err.message : String(err)}`)
    objectCache.set(key, miss)
    return miss
  }
}

/** Rewrite one stored reference string, migrating its object if eligible. Returns the (possibly) new value. */
async function migrateValue(rawValue: unknown, defaultBucket: string, category: 'general' | 'document'): Promise<{ changed: boolean; value: string | null }> {
  if (typeof rawValue !== 'string' || !rawValue.trim()) return { changed: false, value: (rawValue as string) ?? null }
  const ref = parseObjectRef(rawValue, defaultBucket)
  if (!ref) return { changed: false, value: rawValue }
  if (SKIP_EXT.has(extensionOf(ref.objectPath))) return { changed: false, value: rawValue }
  const outcome = await ensureMigrated(ref.bucket, ref.objectPath, category)
  if (!outcome.migrated || !outcome.newObjectPath) return { changed: false, value: rawValue }
  const newValue = ref.wasUrl ? publicUrl(ref.bucket, outcome.newObjectPath) : outcome.newObjectPath
  return { changed: true, value: newValue }
}

async function migrateArray(arr: unknown, bucket: string, category: 'general' | 'document'): Promise<{ changed: boolean; value: string[] }> {
  const list = Array.isArray(arr) ? (arr as unknown[]) : []
  let changed = false
  const next: string[] = []
  for (const el of list) {
    const r = await migrateValue(el, bucket, category)
    next.push((r.value as string) ?? (el as string))
    if (r.changed) changed = true
  }
  return { changed, value: next }
}

// ---- per-source processors -------------------------------------------------------------------------

async function run() {
  const rawUrl = process.env.DATABASE_URL
  if (!rawUrl) throw new Error('DATABASE_URL is not set')
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supaUrl || !supaKey) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are required')
  supabase = createClient(supaUrl, supaKey, { auth: { persistSession: false, autoRefreshToken: false } })

  // Dedicated DIRECT (5432) connection — not the app pool with its 12s statement timeout.
  const url = new URL(rawUrl)
  if (url.port === '6543') { url.port = '5432'; url.searchParams.delete('pgbouncer') }
  const client = postgres(url.toString(), { ssl: { rejectUnauthorized: false }, max: 2 })
  const db = drizzle(client)

  if (DELETE_ORIGINALS && (ONLY || LIMIT !== Infinity)) {
    throw new Error('--delete-originals is only allowed on a FULL run (remove --only / --limit)')
  }

  console.log(`\n=== optimize-existing-images (${APPLY ? (DELETE_ORIGINALS ? 'APPLY + DELETE' : 'APPLY') : 'DRY-RUN'}) ===`)
  console.log(`only=${ONLY ?? 'all'} limit=${LIMIT === Infinity ? '∞' : LIMIT} skipDocuments=${SKIP_DOCUMENTS}\n`)

  const wants = (s: Source) => !ONLY || ONLY === s

  try {
    // 1. Purchase orders — 4 jsonb arrays of paths + 3 quotation URL columns (mostly PDFs → skipped).
    if (wants('purchase_orders')) {
      const rows = await db.select({
        id: purchaseOrders.id,
        supportingImages: purchaseOrders.supportingImages,
        vendorImages: purchaseOrders.vendorImages,
        billImages: purchaseOrders.billImages,
        grnImages: purchaseOrders.grnImages,
        quotation1Url: purchaseOrders.quotation1Url,
        quotation2Url: purchaseOrders.quotation2Url,
        quotation3Url: purchaseOrders.quotation3Url,
      }).from(purchaseOrders)
      let touched = 0
      for (const row of rows) {
        const si = await migrateArray(row.supportingImages, BUCKET_PO, 'general')
        const vi = await migrateArray(row.vendorImages, BUCKET_PO, 'general')
        const bi = await migrateArray(row.billImages, BUCKET_PO, 'general')
        const gi = await migrateArray(row.grnImages, BUCKET_PO, 'general')
        const q1 = await migrateValue(row.quotation1Url, BUCKET_PO, 'general')
        const q2 = await migrateValue(row.quotation2Url, BUCKET_PO, 'general')
        const q3 = await migrateValue(row.quotation3Url, BUCKET_PO, 'general')
        if (si.changed || vi.changed || bi.changed || gi.changed || q1.changed || q2.changed || q3.changed) {
          touched += 1
          if (APPLY) {
            await db.update(purchaseOrders).set({
              supportingImages: si.value, vendorImages: vi.value, billImages: bi.value, grnImages: gi.value,
              quotation1Url: q1.value, quotation2Url: q2.value, quotation3Url: q3.value,
            }).where(eq(purchaseOrders.id, row.id))
          }
        }
      }
      console.log(`purchase_orders: ${rows.length} rows scanned, ${touched} ${APPLY ? 'updated' : 'would update'}`)
    }

    // 2. Petty cash — expenses.billFiles[] (URLs) + attachments (path/url + size/mime).
    if (wants('petty_cash')) {
      const exp = await db.select({ id: pettyCashExpenses.id, billFiles: pettyCashExpenses.billFiles }).from(pettyCashExpenses)
      let expTouched = 0
      for (const row of exp) {
        const bf = await migrateArray(row.billFiles, BUCKET_PETTY, 'general')
        if (bf.changed) {
          expTouched += 1
          if (APPLY) await db.update(pettyCashExpenses).set({ billFiles: bf.value }).where(eq(pettyCashExpenses.id, row.id))
        }
      }
      const att = await db.select({
        id: pettyCashExpenseAttachments.id,
        filePath: pettyCashExpenseAttachments.filePath,
        fileUrl: pettyCashExpenseAttachments.fileUrl,
      }).from(pettyCashExpenseAttachments)
      let attTouched = 0
      for (const row of att) {
        const fp = await migrateValue(row.filePath, BUCKET_PETTY, 'general')
        const fu = await migrateValue(row.fileUrl, BUCKET_PETTY, 'general')
        if (fp.changed || fu.changed) {
          attTouched += 1
          if (APPLY) {
            const set: Record<string, unknown> = {}
            if (fp.changed) set.filePath = fp.value
            if (fu.changed) set.fileUrl = fu.value
            // Refresh mime; size we intentionally leave (byte count would require re-reading — the app's
            // fresh uploads set it correctly, and a stale size here is cosmetic).
            set.mimeType = 'image/webp'
            await db.update(pettyCashExpenseAttachments).set(set).where(eq(pettyCashExpenseAttachments.id, row.id))
          }
        }
      }
      console.log(`petty_cash: expenses ${expTouched} / attachments ${attTouched} ${APPLY ? 'updated' : 'would update'}`)
    }

    // 3. Vehicle tracker — out/in url+path pairs (same object per pair; dedupe handles it).
    if (wants('vehicle_tracker')) {
      const rows = await db.select({
        id: kiaVehicleTracker.id,
        outPhotoUrl: kiaVehicleTracker.outPhotoUrl,
        outPhotoPath: kiaVehicleTracker.outPhotoPath,
        inPhotoUrl: kiaVehicleTracker.inPhotoUrl,
        inPhotoPath: kiaVehicleTracker.inPhotoPath,
      }).from(kiaVehicleTracker)
      let touched = 0
      for (const row of rows) {
        const ou = await migrateValue(row.outPhotoUrl, BUCKET_PO, 'general')
        const op = await migrateValue(row.outPhotoPath, BUCKET_PO, 'general')
        const iu = await migrateValue(row.inPhotoUrl, BUCKET_PO, 'general')
        const ip = await migrateValue(row.inPhotoPath, BUCKET_PO, 'general')
        if (ou.changed || op.changed || iu.changed || ip.changed) {
          touched += 1
          if (APPLY) {
            await db.update(kiaVehicleTracker).set({
              outPhotoUrl: ou.value ?? row.outPhotoUrl, outPhotoPath: op.value,
              inPhotoUrl: iu.value, inPhotoPath: ip.value,
            }).where(eq(kiaVehicleTracker.id, row.id))
          }
        }
      }
      console.log(`vehicle_tracker: ${rows.length} rows scanned, ${touched} ${APPLY ? 'updated' : 'would update'}`)
    }

    // 4. Hyundai/Platinum warranty evidence — private bucket, storagePath (+ contentType/sizeBytes).
    if (wants('warranty')) {
      const rows = await db.select({
        id: hyundaiWarrantyClaimEvidence.id,
        storagePath: hyundaiWarrantyClaimEvidence.storagePath,
      }).from(hyundaiWarrantyClaimEvidence)
      let touched = 0
      for (const row of rows) {
        const sp = await migrateValue(row.storagePath, BUCKET_WARRANTY, 'general')
        if (sp.changed && sp.value) {
          touched += 1
          if (APPLY) {
            await db.update(hyundaiWarrantyClaimEvidence)
              .set({ storagePath: sp.value, contentType: 'image/webp' })
              .where(eq(hyundaiWarrantyClaimEvidence.id, row.id))
          }
        }
      }
      console.log(`warranty: ${rows.length} rows scanned, ${touched} ${APPLY ? 'updated' : 'would update'}`)
    }

    // 5. KIA bookings metadata — KYC/cost-sheet/invoice (category 'document'; skippable).
    if (wants('kia_bookings') && !SKIP_DOCUMENTS) {
      const rows = await db.select({ id: kiaBookings.id, metadata: kiaBookings.metadata }).from(kiaBookings)
      let touched = 0
      for (const row of rows) {
        const md = row.metadata as Record<string, unknown> | null
        if (!md || typeof md !== 'object') continue
        const next: Record<string, unknown> = { ...md }
        let changed = false
        for (const key of ['panCardUrl', 'aadhaarCardUrl', 'employeeIdUrl', 'costSheet']) {
          const r = await migrateValue(next[key], BUCKET_PO, 'document')
          if (r.changed) { next[key] = r.value; changed = true }
        }
        const av = next.accountsVerification
        if (av && typeof av === 'object') {
          const nextAv: Record<string, unknown> = { ...(av as Record<string, unknown>) }
          for (const key of ['invoiceDocumentUrl', 'invoiceDocumentPath']) {
            const r = await migrateValue(nextAv[key], BUCKET_PO, 'document')
            if (r.changed) { nextAv[key] = r.value; changed = true }
          }
          if (changed) next.accountsVerification = nextAv
        }
        if (changed) {
          touched += 1
          if (APPLY) await db.update(kiaBookings).set({ metadata: next }).where(eq(kiaBookings.id, row.id))
        }
      }
      console.log(`kia_bookings: ${rows.length} rows scanned, ${touched} ${APPLY ? 'updated' : 'would update'}`)
    } else if (wants('kia_bookings')) {
      console.log('kia_bookings: skipped (--skip-documents)')
    }

    // 6. Optional destructive phase — delete the now-orphaned originals (full run only).
    if (DELETE_ORIGINALS && migratedOriginals.length) {
      console.log(`\nDeleting ${migratedOriginals.length} original objects...`)
      const byBucket = new Map<string, string[]>()
      for (const o of migratedOriginals) {
        if (!byBucket.has(o.bucket)) byBucket.set(o.bucket, [])
        byBucket.get(o.bucket)!.push(o.objectPath)
      }
      for (const [bucket, paths] of byBucket) {
        for (let i = 0; i < paths.length; i += 100) {
          const chunk = paths.slice(i, i + 100)
          const { error } = await supabase.storage.from(bucket).remove(chunk)
          if (error) failures.push(`delete ${bucket} (${chunk.length}): ${error.message}`)
        }
      }
    }

    // ---- summary ----
    const savedPct = bytesBefore ? Math.round((1 - bytesAfter / bytesBefore) * 100) : 0
    console.log('\n---------------------------------------------')
    console.log(`unique objects re-encoded : ${migratedOriginals.length}`)
    console.log(`objects downloaded        : ${scanned}`)
    console.log(`size  ${(bytesBefore / 1_048_576).toFixed(1)} MB → ${(bytesAfter / 1_048_576).toFixed(1)} MB  (-${savedPct}%, ${((bytesBefore - bytesAfter) / 1_048_576).toFixed(1)} MB saved)`)
    if (!APPLY) console.log('DRY-RUN — nothing was written. Re-run with --apply to migrate.')
    if (failures.length) {
      console.log(`\n${failures.length} failure(s):`)
      failures.slice(0, 40).forEach((f) => console.log('  - ' + f))
    }
    console.log('---------------------------------------------\n')
  } finally {
    await client.end()
  }
  process.exit(failures.length ? 1 : 0)
}

run().catch((e) => { console.error(e); process.exit(1) })
