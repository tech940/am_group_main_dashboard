import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { env } from '@/config/env-config'

export async function GET() {
  try {
    // Check environment variables
    const checks = {
      databaseUrl: !!env.database.url,
      supabaseUrl: !!env.supabase.url,
      supabaseAnonKey: !!env.supabase.anonKey,
    }

    if (!env.database.url) {
      return NextResponse.json({
        status: 'error',
        checks,
        error: 'DATABASE_URL is not configured in environment variables'
      }, { status: 500 })
    }

    // Test database connection with a simple query
    await db.execute('SELECT 1')

    return NextResponse.json({
      status: 'ok',
      checks,
      message: 'Database connection successful'
    })
  } catch (error) {
    console.error('Database health check failed:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({
      status: 'error',
      error: errorMessage,
      hint: 'Please check your DATABASE_URL in .env file'
    }, { status: 500 })
  }
}
