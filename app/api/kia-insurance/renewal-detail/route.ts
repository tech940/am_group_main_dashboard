import { NextResponse } from 'next/server'
import { fetchAll } from '@/lib/kia-insurance/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const rows = await fetchAll('kia_insurance')
    const valid = rows.filter((r: any) => r.vinno && r.create_date)
    const vinLatest: Record<string, any> = {}
    for (const r of valid) {
      const key = r.vinno
      if (!vinLatest[key] || r.create_date > vinLatest[key].create_date) {
        vinLatest[key] = r
      }
    }
    const vinMonths: Record<string, Set<string>> = {}
    for (const r of valid) {
      if (!vinMonths[r.vinno]) vinMonths[r.vinno] = new Set()
      vinMonths[r.vinno].add(r.create_date.substring(0, 7))
    }
    const today = new Date()
    const currentYm = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
    const detail: any[] = []
    for (const [vin, monthsSet] of Object.entries(vinMonths)) {
      const sortedMonths = [...monthsSet].sort()
      const lastMonth = sortedMonths[sortedMonths.length - 1]
      const [ly, lm] = lastMonth.split('-').map(Number)
      const expectedRenewalYm = `${ly + 1}-${String(lm).padStart(2, '0')}`
      const lastRecord = vinLatest[vin]
      const isOverdue = expectedRenewalYm < currentYm
      let status = 'Current'
      if (sortedMonths.length === 1) status = 'New'
      else if (isOverdue) status = 'Overdue'
      else status = 'Active'
      detail.push({
        vin, customer: lastRecord.customer_name || '-',
        model: lastRecord.model || '-',
        policyNo: lastRecord.policyno || '-',
        lastInsurance: lastRecord.insurancecompany || '-',
        lastPremium: Number(lastRecord.grosspremium) || 0,
        lastDate: lastRecord.create_date,
        monthsActive: sortedMonths.length,
        firstSeen: sortedMonths[0],
        lastSeen: lastMonth, status,
      })
    }
    detail.sort((a: any, b: any) => {
      const order: Record<string, number> = { Overdue: 0, New: 1, Active: 2, Current: 3 }
      return (order[a.status] || 9) - (order[b.status] || 9)
    })
    return NextResponse.json({
      detail,
      summary: {
        total: detail.length,
        overdue: detail.filter((d: any) => d.status === 'Overdue').length,
        new: detail.filter((d: any) => d.status === 'New').length,
        active: detail.filter((d: any) => d.status === 'Active').length,
        current: detail.filter((d: any) => d.status === 'Current').length,
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
