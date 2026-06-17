import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { hyundaiWarrantyClaimActions, hyundaiWarrantyClaimEvidence } from '@/lib/db/schema'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requirePermission } from '@/lib/permissions/service'
import { canAccessBrand } from '@/lib/auth/brand-access'
import {
  findWarrantySourceRecord,
  getWarrantyRequirement,
  hyundaiWarrantyBaseCacheKey,
  claimListActionJoinSql,
  ytpActionJoinSql,
  type HyundaiWarrantySource,
} from '@/lib/hyundai/warranty-claims'
import { isAllowedHyundaiWarrantyDealer } from '@/lib/hyundai/warranty-dealers'
import {
  deleteWarrantyEvidence,
  uploadWarrantyEvidence,
  WARRANTY_ALLOWED_IMAGE_TYPES,
  WARRANTY_MAX_FILE_BYTES,
  WARRANTY_MAX_FILES,
} from '@/lib/hyundai/warranty-storage'
import { invalidateCache } from '@/lib/redis/cache-utils'

type RawRow = Record<string, unknown>

function sourceFrom(value: unknown): HyundaiWarrantySource {
  return String(value || '') === 'ytp' ? 'ytp' : 'claim_list'
}

function permissionKey(source: HyundaiWarrantySource, action: 'view' | 'edit') {
  return `hyundai.${source === 'ytp' ? 'warranty_list' : 'warranty_claim_list'}.${action}`
}

function resultRows(result: unknown) {
  return Array.isArray(result) ? result as RawRow[] : []
}

function dateKey(value: unknown) {
  if (!value) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

export async function GET(request: Request) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(request.url)
  const source = sourceFrom(searchParams.get('source'))
  const recordKey = String(searchParams.get('recordKey') || '').trim()
  const sourceRowId = String(searchParams.get('sourceRowId') || '').trim()
  const isBrandUser = canAccessBrand(appUser, 'hyundai')
  if (!isBrandUser) {
    const permission = await requirePermission(appUser, permissionKey(source, 'view'))
    if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })
  }
  if (!recordKey && !sourceRowId) {
    return NextResponse.json({ error: 'recordKey or sourceRowId is required' }, { status: 400 })
  }

  const record = await findWarrantySourceRecord(source, { sourceRowId, recordKey })
  if (!record) return NextResponse.json({ error: 'Source record was not found or has changed' }, { status: 404 })
  const dealerCode = String(record.source_dealer_code || '').trim().toUpperCase()
  if (!isAllowedHyundaiWarrantyDealer(dealerCode)) {
    return NextResponse.json({ error: 'This dealer is not available in Hyundai warranty' }, { status: 403 })
  }

  const resolvedRowId = String(record.id)
  const actions = source === 'claim_list'
    ? resultRows(await db.execute(sql`
        SELECT a.id, a.requirement_code, a.status_snapshot, a.business_date_snapshot, a.remark,
          a.docket_number, a.created_by_name, a.created_by_email, a.created_by_role, a.created_at
        FROM hyundai_warranty_claim_actions a
        INNER JOIN hyundai_warranty_claim_list l ON ${claimListActionJoinSql}
        WHERE l.id::text = ${resolvedRowId}
        ORDER BY a.created_at DESC
      `))
    : resultRows(await db.execute(sql`
        SELECT a.id, a.requirement_code, a.status_snapshot, a.business_date_snapshot, a.remark,
          a.docket_number, a.created_by_name, a.created_by_email, a.created_by_role, a.created_at
        FROM hyundai_warranty_claim_actions a
        INNER JOIN hyundai_warranty_claim_ytp y ON ${ytpActionJoinSql}
        WHERE y.id::text = ${resolvedRowId}
        ORDER BY a.created_at DESC
      `))
  const actionIds = actions.map((action) => String(action.id))
  const evidence = actionIds.length > 0 ? resultRows(await db.execute(sql`
    SELECT id, action_id, original_name, content_type, size_bytes, created_at
    FROM hyundai_warranty_claim_evidence
    WHERE action_id IN (${sql.join(actionIds.map((id) => sql`${id}::uuid`), sql`, `)})
    ORDER BY created_at
  `)) : []
  const evidenceByAction = new Map<string, RawRow[]>()
  evidence.forEach((item) => {
    const key = String(item.action_id)
    evidenceByAction.set(key, [...(evidenceByAction.get(key) || []), {
      ...item,
      size_bytes: Number(item.size_bytes || 0),
      previewUrl: `/api/brands/hyundai/warranty-claims/evidence/${item.id}`,
    }])
  })
  return NextResponse.json({
    actions: actions.map((action) => ({
      ...action,
      evidence: evidenceByAction.get(String(action.id)) || [],
    })),
  })
}

export async function POST(request: Request) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const formData = await request.formData()
  const source = sourceFrom(formData.get('source'))
  const isBrandUser = canAccessBrand(appUser, 'hyundai')
  if (!isBrandUser) {
    const permission = await requirePermission(appUser, permissionKey(source, 'edit'))
    if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })
  }

  const recordKey = String(formData.get('recordKey') || '').trim()
  const sourceRowId = String(formData.get('sourceRowId') || '').trim()
  const remark = String(formData.get('remark') || '').trim()
  const docketNumber = String(formData.get('docketNumber') || '').trim()
  const files = formData.getAll('files').filter((value): value is File => value instanceof File && value.size > 0)
  if ((!recordKey && !sourceRowId) || !remark) {
    return NextResponse.json({ error: 'Record and remarks are required' }, { status: 400 })
  }
  if (files.length > WARRANTY_MAX_FILES) return NextResponse.json({ error: `Maximum ${WARRANTY_MAX_FILES} images allowed` }, { status: 400 })
  if (files.some((file) => !WARRANTY_ALLOWED_IMAGE_TYPES.has(file.type))) {
    return NextResponse.json({ error: 'Only JPEG, PNG, and WebP images are allowed' }, { status: 400 })
  }
  if (files.some((file) => file.size > WARRANTY_MAX_FILE_BYTES)) {
    return NextResponse.json({ error: 'Each image must be 10MB or smaller' }, { status: 400 })
  }

  const record = await findWarrantySourceRecord(source, { sourceRowId, recordKey })
  if (!record) return NextResponse.json({ error: 'Source record was not found or has changed' }, { status: 404 })
  const dealerCode = String(record.source_dealer_code || '').trim().toUpperCase()
  if (!isAllowedHyundaiWarrantyDealer(dealerCode)) {
    return NextResponse.json({ error: 'This dealer is not available in Hyundai warranty' }, { status: 403 })
  }
  const canonicalRecordKey = record.recordKey
  const status = String(source === 'ytp' ? record.r_o_status || '' : record.status || '').trim()
  const businessDate = dateKey(source === 'ytp' ? record.r_o_date : record.claim_date)
  const requirement = getWarrantyRequirement(source, status, businessDate)
  if (requirement.requiresDocket && !docketNumber) {
    return NextResponse.json({ error: 'Official docket number is required' }, { status: 400 })
  }
  if (requirement.requiresDocket && files.length === 0) {
    return NextResponse.json({ error: 'At least one docket proof image is required' }, { status: 400 })
  }

  const actionId = randomUUID()
  const uploadedPaths: string[] = []
  try {
    for (const [index, file] of files.entries()) {
      uploadedPaths.push(await uploadWarrantyEvidence(actionId, file, index))
    }
    await db.transaction(async (tx) => {
      await tx.insert(hyundaiWarrantyClaimActions).values({
        id: actionId,
        sourceType: source,
        recordKey: canonicalRecordKey,
        requirementCode: requirement.code || 'general_remark',
        statusSnapshot: status,
        businessDateSnapshot: businessDate || null,
        remark,
        docketNumber: docketNumber || null,
        createdBy: appUser.id,
        createdByName: appUser.fullName,
        createdByEmail: appUser.email,
        createdByRole: appUser.role,
      })
      if (files.length > 0) {
        await tx.insert(hyundaiWarrantyClaimEvidence).values(files.map((file, index) => ({
          actionId,
          storagePath: uploadedPaths[index],
          originalName: file.name,
          contentType: file.type,
          sizeBytes: file.size,
          uploadedBy: appUser.id,
        })))
      }
    })
    await invalidateCache(hyundaiWarrantyBaseCacheKey(source))
    return NextResponse.json({
      id: actionId,
      message: 'Remarks saved successfully',
      sourceRowId: String(record.id),
      remarkCount: null,
      latestRemark: {
        remark,
        docketNumber: docketNumber || null,
        createdByName: appUser.fullName,
        createdByRole: appUser.role,
        createdAt: new Date().toISOString(),
      },
    }, { status: 201 })
  } catch (error) {
    await deleteWarrantyEvidence(uploadedPaths)
    console.error('Failed to save Hyundai warranty action:', error)
    return NextResponse.json({ error: 'Failed to save remarks' }, { status: 500 })
  }
}
