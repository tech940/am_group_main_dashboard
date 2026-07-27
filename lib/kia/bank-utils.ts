const BANK_NAME_MAP: Record<string, string> = {
  // J&K variations
  'j & k bank': 'J&K Bank',
  'j&k bank': 'J&K Bank',
  'jk bank': 'J&K Bank',
  'j&k': 'J&K Bank',
  'jk': 'J&K Bank',
  'j and k bank': 'J&K Bank',

  // Grameen variations
  'jk grameen bank': 'JK GRAMEEN',
  'jk grameen': 'JK GRAMEEN',
  'jk grameen bank jagti': 'JK GRAMEEN',
  'grameen bank jagti': 'JK GRAMEEN',

  // SBI variations
  'sbi': 'SBI',
  'state bank of india': 'SBI',
  'sbi g nagar': 'SBI',

  // BOB variations
  'bob': 'BANK OF BARODA',
  'bank of baroda': 'BANK OF BARODA',

  // BOI variations
  'boi': 'BANK OF INDIA',
  'bank of india': 'BANK OF INDIA',

  // BOM variations
  'bom': 'BOM',

  // PNB / Punjabi Nation Bank variations
  'pnb': 'PNB BANK',
  'pnb bank': 'PNB BANK',
  'punjab national bank': 'PNB BANK',
  'punjabi nation bank': 'PNB BANK',
  'punjabi national bank': 'PNB BANK',

  // Canara variations
  'canara': 'CANARA',
  'canara bank': 'CANARA',

  // HDFC variations
  'hdfc': 'HDFC',
  'hdfc bank': 'HDFC',

  // ICICI variations
  'icici': 'ICICI',
  'icici bank': 'ICICI',

  // IDBI variations
  'idbi': 'IDBI',
  'idbi bank': 'IDBI',

  // Devika variations
  'devika urban co-operative bank ltd': 'DEVIKA URBAN CO.BANK',
  'devika urban co.bank': 'DEVIKA URBAN CO.BANK',

  // Union variations
  'union bank': 'Union Bank',
  'union bank of india': 'Union Bank',

  // UCO variations
  'uco': 'UCO Bank',
  'uco bank': 'UCO Bank',

  // Cash variations
  'cash': 'CASH',
}

export function normalizeBankName(name?: string | null): string {
  if (!name) return ''
  const clean = name.trim().toLowerCase().replace(/\s+/g, ' ')
  
  if (BANK_NAME_MAP[clean]) {
    return BANK_NAME_MAP[clean]
  }
  
  if (clean.startsWith('sbi ')) {
    return 'SBI'
  }
  
  // fallback to UPPERCASE for exact matches on other uppercase options
  const upper = name.trim().toUpperCase()
  if (['AU BANK', 'AXIS BANK', 'BANDHAN BANK', 'BOM', 'BAJAJ FINSERV', 'CAPITAL BANK', 'CENTRAL BANK', 'CHOLAMANDALAM', 'FEDERAL BANK', 'INDIAN BANK', 'INDIAN OVERSEAS', 'INDUSIND BANK', 'KOTAK MAHINDRA', 'LIC', 'M&M', 'MARBLE MARKET', 'POWER GRID', 'PUNJAB & SIND BANK', 'RBI', 'SOUTH INDIAN BANK', 'TATA CAPITAL', 'YES BANK'].includes(upper)) {
    // Map to match FINANCE_BANK_OPTIONS exactly
    if (upper === 'BAJAJ FINSERV') return 'Bajaj Finserv'
    if (upper === 'CAPITAL BANK') return 'Capital Bank'
    if (upper === 'CENTRAL BANK') return 'Central Bank'
    if (upper === 'FEDERAL BANK') return 'Federal Bank'
    if (upper === 'INDIAN BANK') return 'Indian Bank'
    if (upper === 'INDIAN OVERSEAS') return 'Indian Overseas'
    if (upper === 'INDUSIND BANK') return 'IndusInd Bank'
    if (upper === 'KOTAK MAHINDRA') return 'Kotak Mahindra'
    if (upper === 'SOUTH INDIAN BANK') return 'South Indian Bank'
    if (upper === 'TATA CAPITAL') return 'Tata Capital'
    if (upper === 'YES BANK') return 'YES Bank'
    if (upper === 'PUNJAB & SIND BANK') return 'Punjab & Sind Bank'
    return upper
  }
  
  // Return title cased or trimmed original
  return name.trim().replace(/\b\w/g, c => c.toUpperCase())
}
