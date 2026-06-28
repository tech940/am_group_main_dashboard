import 'server-only'

import { db } from '@/lib/db'
import { userActivityEvents } from '@/lib/db/schema'

type ActivityActor = {
  id?: string | null
  supabaseId?: string | null
  email?: string | null
  brand?: string | null
}

export type UserActivityInput = {
  actor?: ActivityActor | null
  eventType: string
  routePath?: string | null
  routeQuery?: string | null
  pageTitle?: string | null
  sectionKey?: string | null
  brand?: string | null
  module?: string | null
  sessionId?: string | null
  metadata?: Record<string, unknown>
  request?: Request | null
}

function normalizeText(value: string | null | undefined) {
  const text = String(value || '').trim()
  return text || null
}

function pathParts(pathname: string | null | undefined) {
  return String(pathname || '')
    .split('?')[0]
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
}

function inferBrand(pathname: string | null | undefined) {
  const [, brands, brand] = pathParts(pathname)
  if (brands !== 'brands') return null
  return normalizeText(brand)
}

function inferModule(pathname: string | null | undefined) {
  const parts = pathParts(pathname)
  if (parts[0] === 'brands') return normalizeText(parts[2] || null)
  return normalizeText(parts[0] || null)
}

function inferSectionKey(pathname: string | null | undefined) {
  const parts = pathParts(pathname)
  if (parts[0] === 'brands') {
    return normalizeText(parts.slice(2).join('/') || null)
  }
  return normalizeText(parts.join('/') || null)
}

function getHeader(request: Request | null | undefined, key: string) {
  return request?.headers.get(key) || null
}

function getIpAddress(request: Request | null | undefined) {
  const forwarded = getHeader(request, 'x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]?.trim() || null
  return getHeader(request, 'x-real-ip')
    || getHeader(request, 'cf-connecting-ip')
    || null
}

export async function logUserActivity(input: UserActivityInput) {
  const routePath = normalizeText(input.routePath)
  const routeQuery = normalizeText(input.routeQuery)
  const inferredBrand = inferBrand(routePath)
  const inferredModule = inferModule(routePath)
  const inferredSectionKey = inferSectionKey(routePath)

  await db.insert(userActivityEvents).values({
    userId: input.actor?.id || null,
    supabaseId: normalizeText(input.actor?.supabaseId),
    email: normalizeText(input.actor?.email),
    sessionId: normalizeText(input.sessionId),
    eventType: input.eventType,
    routePath,
    routeQuery,
    pageTitle: normalizeText(input.pageTitle),
    brand: normalizeText(input.brand) || inferredBrand || normalizeText(input.actor?.brand),
    module: normalizeText(input.module) || inferredModule,
    sectionKey: normalizeText(input.sectionKey) || inferredSectionKey,
    metadata: input.metadata || {},
    ipAddress: getIpAddress(input.request),
    userAgent: normalizeText(getHeader(input.request, 'user-agent')),
  })
}
