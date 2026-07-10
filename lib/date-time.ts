const ISO_TIMEZONE_SUFFIX_PATTERN = /(Z|[+-]\d{2}:\d{2})$/i
const POSTGRES_SHORT_TIMEZONE_SUFFIX_PATTERN = /([+-]\d{2})$/
const SPACE_SEPARATED_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/

export const INDIA_TIME_ZONE = 'Asia/Kolkata'
const INDIA_OFFSET_MINUTES = 330

function normalizeTimestampInput(value: string) {
  const trimmed = value.trim()

  if (!trimmed) {
    return trimmed
  }

  const withIsoSeparator = SPACE_SEPARATED_TIMESTAMP_PATTERN.test(trimmed)
    ? trimmed.replace(' ', 'T')
    : trimmed

  const withExpandedTimezone = ISO_TIMEZONE_SUFFIX_PATTERN.test(withIsoSeparator)
    ? withIsoSeparator
    : withIsoSeparator.replace(POSTGRES_SHORT_TIMEZONE_SUFFIX_PATTERN, '$1:00')

  if (ISO_TIMEZONE_SUFFIX_PATTERN.test(withExpandedTimezone)) {
    return withExpandedTimezone
  }

  return `${withExpandedTimezone}Z`
}

export function parseAppDate(value: Date | string | null | undefined) {
  if (!value) {
    return null
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime())
  }

  const parsed = new Date(normalizeTimestampInput(value))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function serializeAppDate(value: Date | string | null | undefined) {
  const parsed = parseAppDate(value)
  return parsed ? parsed.toISOString() : null
}

export function formatRelativeTimeFromNow(value: Date | string | null | undefined, now = new Date()) {
  const timestamp = parseAppDate(value)

  if (!timestamp) {
    return 'Just now'
  }

  const diffMs = Math.max(0, now.getTime() - timestamp.getTime())

  if (diffMs < 60_000) {
    return 'Just now'
  }

  if (diffMs < 3_600_000) {
    const minutes = Math.floor(diffMs / 60_000)
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  }

  if (diffMs < 86_400_000) {
    const hours = Math.floor(diffMs / 3_600_000)
    return `${hours} hour${hours === 1 ? '' : 's'} ago`
  }

  if (diffMs < 172_800_000) {
    return 'Yesterday'
  }

  const days = Math.floor(diffMs / 86_400_000)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export function formatIndiaDateTime(
  value: Date | string | null | undefined,
  options?: Intl.DateTimeFormatOptions
) {
  const timestamp = parseAppDate(value)

  if (!timestamp) {
    return undefined
  }

  return new Intl.DateTimeFormat('en-IN', {
    timeZone: INDIA_TIME_ZONE,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    ...options,
  }).format(timestamp)
}

/**
 * "07 Jul 2026, 11:02 am IST" — India Standard Time with an explicit IST suffix. Use this for
 * every "last updated / data freshness / source updated" label so the timezone is unambiguous
 * (a bare toLocaleString renders in UTC during SSR and in the visitor's zone in the browser).
 * Returns '-' when the value is empty/invalid.
 */
export function formatIstDateTime(value: Date | string | null | undefined): string {
  const timestamp = parseAppDate(value)
  if (!timestamp) return '-'
  return `${new Intl.DateTimeFormat('en-IN', {
    timeZone: INDIA_TIME_ZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(timestamp)} IST`
}

export function getIndiaDatePart(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: INDIA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const partMap = new Map(parts.map((part) => [part.type, part.value]))
  return `${partMap.get('year') || ''}${partMap.get('month') || ''}${partMap.get('day') || ''}`
}

export function parseIndiaLocalDateTime(dateValue: string | null | undefined, timeValue?: string | null) {
  if (!dateValue) {
    return null
  }

  const [year, month, day] = dateValue.split('-').map(Number)
  const [hour = 0, minute = 0, second = 0] = (timeValue || '00:00').split(':').map(Number)

  if ([year, month, day, hour, minute, second].some((part) => Number.isNaN(part))) {
    return null
  }

  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second) - (INDIA_OFFSET_MINUTES * 60 * 1000)
  return new Date(utcMs)
}

export function serializeUtcTimestampFields<T extends Record<string, unknown>>(
  record: T,
  keys: Array<keyof T>
) {
  return keys.reduce((accumulator, key) => {
    const value = accumulator[key]

    if (value == null) {
      return accumulator
    }

    const serialized = serializeAppDate(value as Date | string | null | undefined)
    if (serialized) {
      accumulator[key] = serialized as T[keyof T]
    }

    return accumulator
  }, { ...record })
}
