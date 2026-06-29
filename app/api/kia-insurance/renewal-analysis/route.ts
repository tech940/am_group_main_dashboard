import { NextResponse } from 'next/server'
import { fetchAll } from '@/lib/kia-insurance/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const rows = await fetchAll('kia_insurance')
    const valid = rows.filter((r: any) => r.vinno && r.create_date)
    const yearMap: Record<string, Set<string>> = {}
    for (const r of valid) {
      const yr = r.create_date.substring(0, 4)
      if (!yearMap[yr]) yearMap[yr] = new Set()
      yearMap[yr].add(r.vinno)
    }
    const years = Object.keys(yearMap).sort()
    const analysis: any[] = []
    const allPrevVins = new Set<string>()
    for (const yr of years) {
      const currentVins = yearMap[yr]
      const prevYear = String(Number(yr) - 1)
      const prevVins = yearMap[prevYear] || new Set()
      const rollover = [...currentVins].filter(v => prevVins.has(v))
      const renewal = [...currentVins].filter(v => !prevVins.has(v) && allPrevVins.has(v))
      const newCustomers = [...currentVins].filter(v => !prevVins.has(v) && !allPrevVins.has(v))
      const lapsed = [...prevVins].filter(v => !currentVins.has(v))
      analysis.push({
        year: yr,
        total: currentVins.size,
        rollover, rolloverCount: rollover.length,
        renewal, renewalCount: renewal.length,
        newCustomers, newCustomersCount: newCustomers.length,
        lapsed, lapsedCount: lapsed.length,
      })
      currentVins.forEach(v => allPrevVins.add(v))
    }
    return NextResponse.json({ analysis, totalVins: new Set(valid.map((r: any) => r.vinno)).size })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
