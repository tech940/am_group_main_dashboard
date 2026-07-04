import 'dotenv/config'
import { createServerClient } from '@supabase/ssr'

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  console.log('Supabase URL:', url)

  const client = createServerClient(url, anonKey, {
    cookies: {
      getAll() { return [] },
      setAll() {}
    }
  })

  console.log('Testing Supabase Auth connection...')
  const start = Date.now()
  try {
    const res = await Promise.race([
      client.auth.getUser('invalid-jwt-token'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout after 10000ms')), 10000))
    ])
    console.log(`Supabase getUser response in ${Date.now() - start}ms`, res)
  } catch (err: any) {
    console.error('Supabase test failed:', err.message)
  }
  process.exit(0)
}

main()
