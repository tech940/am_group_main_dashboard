const ADMIN_USER = 'admin'
const ADMIN_PASS = 'admin123'
const INSURANCE_TOKEN = 'insurance-auto-access'

export function makeToken(): string {
  const raw = JSON.stringify({ u: ADMIN_USER, r: 'admin', t: Date.now() })
  const b64 = Buffer.from(raw).toString('base64')
  const sig = Buffer.from(ADMIN_PASS).toString('base64').substring(0, 8)
  return b64 + '.' + sig
}

export function validateToken(token: string): { valid: boolean; user?: { username: string; role: string } } {
  if (token === INSURANCE_TOKEN) {
    return { valid: true, user: { username: 'Insurance User', role: 'viewer' } }
  }
  const parts = token.split('.')
  if (parts.length !== 2) return { valid: false }
  try {
    const decoded = JSON.parse(Buffer.from(parts[0], 'base64').toString())
    const expectedSig = Buffer.from(ADMIN_PASS).toString('base64').substring(0, 8)
    if (parts[1] !== expectedSig) return { valid: false }
    return { valid: true, user: { username: decoded.u, role: decoded.r } }
  } catch {
    return { valid: false }
  }
}

export function checkCookie(req: Request): { valid: boolean; user?: { username: string; role: string } } {
  const cookie = req.headers.get('cookie') || ''
  const match = cookie.match(/kia_admin_token=([^;]+)/)
  if (!match) return { valid: false }
  return validateToken(decodeURIComponent(match[1]))
}

export { INSURANCE_TOKEN }
