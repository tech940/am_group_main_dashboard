import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { discountApprovalsEmployees } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const branch = searchParams.get('branch')
    
    if (!branch) {
      return NextResponse.json({ error: 'Branch query parameter is required' }, { status: 400 })
    }

    const rows = await db
      .select()
      .from(discountApprovalsEmployees)
      .where(eq(discountApprovalsEmployees.branch, branch.toLowerCase()))
      .orderBy(discountApprovalsEmployees.name)

    const salesExecutives = rows.filter(r => r.role === 'sales_executive').map(r => r.name)
    const teamLeaders = rows.filter(r => r.role === 'team_leader').map(r => r.name)

    return NextResponse.json({
      salesExecutives,
      teamLeaders
    })
  } catch (error) {
    console.error('Error fetching employees:', error)
    return NextResponse.json({ error: 'Failed to fetch employees' }, { status: 500 })
  }
}
