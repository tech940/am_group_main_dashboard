import { supabaseAdmin } from '@/lib/supabase/admin'

export async function fetchAll(table: string) {
  const all: any[] = []
  let from = 0
  const size = 1000
  while (true) {
    const promise = supabaseAdmin.from(table).select('*').range(from, from + size - 1)
    const timeout = new Promise<{ data: null; error: Error }>((_, rej) =>
      setTimeout(() => rej(new Error('Supabase query timed out after 8s')), 8000)
    )
    const result = await Promise.race([promise, timeout])
    const { data, error } = result as any
    if (error) throw error
    if (!data?.length) break
    all.push(...data)
    from += size
    if (data.length < size) break
  }
  return all
}
