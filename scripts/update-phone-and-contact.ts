import { getCreSupabase } from '../lib/cre-calls/cre-supabase'

function extractPhoneAndName(fileName: string | null, currentPhone: string | null, currentContact: string | null) {
  let phone = currentPhone && currentPhone !== 'null' ? currentPhone : null
  let contactName = currentContact && currentContact !== 'null' ? currentContact : null

  if (!fileName) return { phone, contactName }

  // 1. Extract phone inside parentheses: CXM Sir(00919484320905)_20260805122059.mp3 or 7006783295(7006783295)_...
  if (!phone) {
    const parenMatch = fileName.match(/\(([+0-9]{10,14})\)/)
    if (parenMatch) {
      let p = parenMatch[1].replace(/^\+?0*/, '')
      if (p.length === 12 && p.startsWith('91')) p = p.slice(2)
      if (p.length >= 10) phone = p.slice(-10)
    }
  }

  // 2. Extract standalone digits: 7006783295...
  if (!phone) {
    const numMatch = fileName.match(/(\b\d{10,12}\b)/)
    if (numMatch) {
      let p = numMatch[1]
      if (p.length === 12 && p.startsWith('91')) p = p.slice(2)
      if (p.length === 10) phone = p
    }
  }

  // 3. Extract contact name from filename: "Call recording [NAME]_[DATE]_[TIME].m4a" or "[NAME]([NUM])_..."
  if (!contactName) {
    if (fileName.startsWith('Call recording ')) {
      const namePart = fileName
        .replace('Call recording ', '')
        .replace(/\.m4a|\.mp3|\.wav/gi, '')
        .split(/_\d{6}/)[0]
        .trim()
      if (namePart && !/^\+?\d+$/.test(namePart)) {
        contactName = namePart.replace(/_/g, ' ').trim()
      }
    } else if (fileName.includes('(')) {
      const namePart = fileName.split('(')[0].trim()
      if (namePart && !/^\d+$/.test(namePart)) {
        contactName = namePart
      }
    }
  }

  return { phone, contactName }
}

async function updateDbRows() {
  const supabase = getCreSupabase()
  const { data: recs } = await supabase.from('call_recordings').select('*')

  let updatedCount = 0
  for (const r of recs) {
    const { phone, contactName } = extractPhoneAndName(r.file_name, r.phone, r.contact_name)
    
    const updates: Record<string, any> = {}
    if (phone && phone !== r.phone) updates.phone = phone
    if (contactName && contactName !== r.contact_name) updates.contact_name = contactName

    if (Object.keys(updates).length > 0) {
      console.log(`Updating [${r.id}] file: "${r.file_name}" ->`, updates)
      const { error } = await supabase.from('call_recordings').update(updates).eq('id', r.id)
      if (error) console.error('Failed update:', error)
      else updatedCount++
    }
  }

  console.log(`\nUpdated ${updatedCount} rows in Supabase call_recordings table.`)
}

updateDbRows().catch(console.error)
