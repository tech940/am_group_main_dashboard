import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { businessExcellenceData } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { sheetId, rowData } = body

    if (!sheetId || !rowData) {
      return NextResponse.json(
        { error: 'Missing required fields: sheetId and rowData' },
        { status: 400 }
      )
    }

    // Fetch the existing sheet data
    const [sheet] = await db
      .select()
      .from(businessExcellenceData)
      .where(eq(businessExcellenceData.id, sheetId))
      .limit(1)

    if (!sheet) {
      return NextResponse.json(
        { error: 'Sheet not found' },
        { status: 404 }
      )
    }

    // Add the new row to the existing rows
    const updatedRows = [...(sheet.rows || []), rowData]

    // Update the sheet with the new row
    await db
      .update(businessExcellenceData)
      .set({
        rows: updatedRows,
        uploadedAt: new Date()
      })
      .where(eq(businessExcellenceData.id, sheetId))

    return NextResponse.json({
      success: true,
      message: 'Row added successfully',
      totalRows: updatedRows.length
    })
  } catch (error) {
    console.error('Error adding row:', error)
    return NextResponse.json(
      { error: 'Failed to add row to sheet' },
      { status: 500 }
    )
  }
}

// Made with Bob
