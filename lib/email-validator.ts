/**
 * Validates email address format and blocks common domain typos (e.g. @gmai.com, @gamil.com).
 */
export function validateEmailDomain(email: string): { valid: boolean; error?: string } {
  const trimmed = (email || '').trim().toLowerCase()

  if (!trimmed) {
    return { valid: false, error: 'Email Address is required.' }
  }

  // Basic email structure regex: local-part@domain.tld
  const basicEmailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
  if (!basicEmailRegex.test(trimmed)) {
    if (!trimmed.includes('@')) {
      return { valid: false, error: 'Email address must contain an "@" symbol (e.g. name@gmail.com).' }
    }
    const parts = trimmed.split('@')
    if (parts.length === 2 && !parts[1].includes('.')) {
      return { valid: false, error: 'Email address is missing a domain extension like .com (e.g. name@gmail.com).' }
    }
    return { valid: false, error: 'Please enter a valid email address format (e.g. name@gmail.com).' }
  }

  const parts = trimmed.split('@')
  if (parts.length !== 2) {
    return { valid: false, error: 'Invalid email format.' }
  }

  const domain = parts[1].toLowerCase()

  // Common typo domains to block explicitly
  const invalidDomainTypos: Record<string, string> = {
    'gmai.com': 'gmail.com',
    'gamil.com': 'gmail.com',
    'gmal.com': 'gmail.com',
    'gmaill.com': 'gmail.com',
    'gmaiil.com': 'gmail.com',
    'gmai.co': 'gmail.com',
    'gmai.in': 'gmail.com',
    'gmai.org': 'gmail.com',
    'gmai.net': 'gmail.com',
    'gmaill.co': 'gmail.com',
    'gmaill.in': 'gmail.com',
    'gmai.co.in': 'gmail.com',
    'gmaild.com': 'gmail.com',
    'yaho.com': 'yahoo.com',
    'yahooo.com': 'yahoo.com',
    'yaho.co.in': 'yahoo.com',
    'yaho.in': 'yahoo.com',
    'outlok.com': 'outlook.com',
    'outloook.com': 'outlook.com',
    'outluk.com': 'outlook.com',
    'hotmial.com': 'hotmail.com',
    'hotmali.com': 'hotmail.com',
    'hotmai.com': 'hotmail.com',
    'iclou.com': 'icloud.com',
    'iclaud.com': 'icloud.com',
  }

  if (domain in invalidDomainTypos) {
    const correctDomain = invalidDomainTypos[domain]
    return {
      valid: false,
      error: `Invalid email domain "@${domain}". Did you mean "@${correctDomain}"?`,
    }
  }

  const domainParts = domain.split('.')
  const tld = domainParts[domainParts.length - 1]

  if (!tld || tld.length < 2) {
    return { valid: false, error: 'Email domain has an invalid TLD extension.' }
  }

  return { valid: true }
}
