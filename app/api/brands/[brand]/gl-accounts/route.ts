import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { glAccounts } from '@/lib/db/schema'
import { asc, eq, or } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ brand: string }> }
) {
  try {
    const { brand } = await context.params
    const normalizedBrand = String(brand || '').trim().toLowerCase()

    const appUser = await getAuthenticatedAppUser()
    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const rows = await db
      .select()
      .from(glAccounts)
      .where(
        or(
          eq(glAccounts.appliesTo, 'both'),
          eq(glAccounts.appliesTo, normalizedBrand)
        )
      )
      .orderBy(asc(glAccounts.glCode))

    return NextResponse.json({ rows })
  } catch (error) {
    console.error('Error fetching GL accounts:', error)
    return NextResponse.json(
      {
        error: 'Failed to fetch GL accounts',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ brand: string }> }
) {
  try {
    const { brand } = await context.params
    const normalizedBrand = String(brand || '').trim().toLowerCase()

    const appUser = await getAuthenticatedAppUser()
    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const { glCode, glName, tallyGroup, accountNature, accountType, monthlyBudget } = body

    if (!glName || !glName.trim()) {
      return NextResponse.json({ error: 'GL Name is required.' }, { status: 400 })
    }

    let finalGlCode = (glCode || '').trim()
    if (!finalGlCode) {
      const existing = await db
        .select({ glCode: glAccounts.glCode })
        .from(glAccounts)

      let maxNum = 0
      existing.forEach(row => {
        const match = row.glCode.match(/^GL-(\d+)$/i)
        if (match) {
          const num = parseInt(match[1], 10)
          if (num > maxNum) {
            maxNum = num
          }
        }
      })
      finalGlCode = `GL-${String(maxNum + 1).padStart(3, '0')}`
    }

    // Insert new GL category
    const [newGl] = await db
      .insert(glAccounts)
      .values({
        glCode: finalGlCode.toUpperCase(),
        glName: glName.trim(),
        tallyGroup: (tallyGroup || 'Indirect Expenses').trim(),
        accountNature: (accountNature || 'Expense').trim(),
        accountType: (accountType || 'Indirect').trim(),
        appliesTo: normalizedBrand,
        monthlyBudget: String(monthlyBudget || '0.00'),
        isActive: true,
      })
      .returning()

    return NextResponse.json({ success: true, row: newGl })
  } catch (error) {
    console.error('Error creating GL account:', error)
    const errMsg = error instanceof Error ? error.message : 'Unknown error'
    if (errMsg.includes('unique') || errMsg.includes('duplicate')) {
      return NextResponse.json({ error: 'A GL Account with this code already exists.' }, { status: 400 })
    }
    return NextResponse.json(
      { error: 'Failed to create GL account', details: errMsg },
      { status: 500 }
    )
  }
}
