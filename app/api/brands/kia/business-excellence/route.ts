import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { businessExcellenceData } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { env } from '@/config/env-config'
import { getCachedData, invalidateCache } from '@/lib/redis/cache-utils'
import { CACHE_KEYS, CACHE_TTL } from '@/lib/redis/client'

// Allow up to 60 seconds for processing large spreadsheets
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const brand = searchParams.get('brand')
    const sheetId = searchParams.get('sheetId')
    const skipCache = searchParams.get('skipCache') === 'true'

    if (!brand && !sheetId) {
      return NextResponse.json({ error: 'Brand or Sheet ID is required' }, { status: 400 })
    }

    // If sheetId is provided, return paginated data for that specific sheet
    if (sheetId) {
      const page = parseInt(searchParams.get('page') || '1')
      const limit = parseInt(searchParams.get('limit') || '10')
      const offset = (page - 1) * limit
      
      // Check if we need ALL rows (for analytics) or paginated rows (for display)
      const fetchAll = searchParams.get('fetchAll') === 'true'

      // Create cache key based on query parameters
      const cacheKey = `${CACHE_KEYS.BUSINESS_EXCELLENCE}:sheet:${sheetId}:${fetchAll ? 'all' : `page:${page}:limit:${limit}`}`

      // Fetch data with caching
      const result = await getCachedData(
        cacheKey,
        async () => {
          let queryResult;
          
          if (fetchAll) {
            // Fetch ALL rows without pagination for analytics calculations
            queryResult = await db.execute(sql`
              SELECT
                id, brand, sheet_name as "sheetName", headers,
                rows,
                jsonb_array_length(rows) as "totalRows",
                uploaded_at as "uploadedAt"
              FROM business_excellence_am_kia_new
              WHERE id = ${sheetId}
              LIMIT 1
            `)
          } else {
            // Use a raw SQL query to efficiently slice the JSONB array in the database
            // This ensures we only fetch the rows we need for pagination
            queryResult = await db.execute(sql`
              SELECT
                id, brand, sheet_name as "sheetName", headers,
                (SELECT jsonb_agg(elem) FROM (
                  SELECT jsonb_array_elements(rows) as elem
                  FROM business_excellence_am_kia_new
                  WHERE id = ${sheetId}
                  LIMIT ${limit} OFFSET ${offset}
                ) sub) as rows,
                jsonb_array_length(rows) as "totalRows",
                uploaded_at as "uploadedAt"
              FROM business_excellence_am_kia_new
              WHERE id = ${sheetId}
              LIMIT 1
            `)
          }

          if (!queryResult || queryResult.length === 0) {
            throw new Error('Sheet not found')
          }

          return queryResult[0]
        },
        skipCache ? 0 : (fetchAll ? CACHE_TTL.LONG : CACHE_TTL.MEDIUM)
      )

      return NextResponse.json(result)
    }

    // Otherwise, return metadata for all sheets of the brand (EXCLUDING 'rows' to save CPU/Memory)
    const cacheKey = `${CACHE_KEYS.BUSINESS_EXCELLENCE}:metadata:${brand}`
    
    const data = await getCachedData(
      cacheKey,
      async () => {
        return await db.select({
          id: businessExcellenceData.id,
          brand: businessExcellenceData.brand,
          sheetName: businessExcellenceData.sheetName,
          headers: businessExcellenceData.headers,
          uploadedAt: businessExcellenceData.uploadedAt,
        })
          .from(businessExcellenceData)
          .where(eq(businessExcellenceData.brand, brand!))
      },
      skipCache ? 0 : CACHE_TTL.MEDIUM
    )

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error fetching business excellence data:', error)
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    // Check if DATABASE_URL is configured
    if (!env.database.url) {
      return NextResponse.json(
        { error: 'DATABASE_URL is not configured in environment variables' },
        { status: 500 }
      )
    }

    const { brand, sheets } = await request.json()

    if (!brand || !sheets || !Array.isArray(sheets)) {
      return NextResponse.json({ error: 'Invalid data format' }, { status: 400 })
    }

    // Process sheets one by one inside a single transaction for stability with large data
    await db.transaction(async (tx) => {
      for (const sheet of sheets) {
        // Overwrite existing data for the same brand and sheet name
        await tx.delete(businessExcellenceData)
          .where(
            and(
              eq(businessExcellenceData.brand, brand),
              eq(businessExcellenceData.sheetName, sheet.name)
            )
          )

        await tx.insert(businessExcellenceData).values({
          brand: brand,
          sheetName: sheet.name,
          headers: sheet.columns,
          rows: sheet.data,
        })
      }
    })

    // Invalidate all caches for this brand after successful upload
    console.log(`🗑️ Invalidating cache for brand: ${brand}`)
    await invalidateCache(`${CACHE_KEYS.BUSINESS_EXCELLENCE}:metadata:${brand}`)
    
    // Note: Individual sheet caches will expire naturally based on TTL
    // or can be invalidated on next request with skipCache=true parameter

    return NextResponse.json({ success: true, message: 'Data saved successfully' })
  } catch (error) {
    console.error('Error saving business excellence data:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    return NextResponse.json(
      { error: `Failed to save data: ${errorMessage}` },
      { status: 500 }
    )
  }
}
