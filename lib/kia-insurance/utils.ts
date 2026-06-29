export function extractMobileFromRemarks(remarks: string | null | undefined): string {
  if (!remarks) return ''
  const m = remarks.match(/\[Mobile:\s*(\S+)\]/)
  return m ? m[1] : ''
}

export function sanitizeRemarks(remarks: string | null | undefined): string {
  if (!remarks) return ''
  return remarks.replace(/\[Mobile:\s*\S+\]\s*/g, '').trim()
}

export function parseDateForFilter(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
    const [d, m, y] = dateStr.split('/')
    return `${y}-${m.padStart(2, '0')}`
  }
  const ma = dateStr.match(/(\d{2})\s+(\w+)\s+(\d{4})/)
  if (ma) {
    const months: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 }
    const monthNum = months[ma[2]]
    if (monthNum) return `${ma[3]}-${String(monthNum).padStart(2, '0')}`
  }
  if (/^\d{4}-\d{2}/.test(dateStr)) return dateStr.substring(0, 7)
  return null
}

export const BASE_PATH = '/kia-insurance-dashboard'
