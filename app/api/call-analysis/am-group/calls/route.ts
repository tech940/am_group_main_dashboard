import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canViewCallAnalysis } from '@/lib/callyzer/access'
import { getCreSupabase } from '@/lib/cre-calls/cre-supabase'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!canViewCallAnalysis(appUser.role)) {
    return NextResponse.json({ error: 'You do not have access to Call Analysis.' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 25))
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')
  const agent = searchParams.get('agent')
  const search = (searchParams.get('search') || '').trim().toLowerCase()
  const recordingsOnly = searchParams.get('recordingsOnly') === 'true'

  try {
    const supabase = getCreSupabase()

    // 1. Fetch profiles map
    const profilesRes = await supabase.from('user_profiles').select('id, full_name')
    const profileMap = new Map((profilesRes.data || []).map((p: any) => [p.id, p.full_name]))

    // 2. Fetch call recordings query
    let query = supabase.from('call_recordings').select('*', { count: 'exact' })

    if (startDate) {
      query = query.gte('recorded_at', `${startDate}T00:00:00.000Z`)
    }
    if (endDate) {
      query = query.lte('recorded_at', `${endDate}T23:59:59.999Z`)
    }
    if (agent && agent !== 'all') {
      query = query.eq('cre_id', agent)
    }
    if (recordingsOnly) {
      query = query.not('storage_path', 'is', null)
    }

    const { data: rawRows, count, error } = await query
      .order('recorded_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1)

    if (error) {
      throw new Error(`Failed to fetch call recordings log: ${error.message}`)
    }

    const total = count || 0

    // 3. Generate signed audio URLs for rows with storage_path
    const rows = await Promise.all(
      (rawRows || []).map(async (row: any) => {
        let audioUrl: string | null = null
        if (row.storage_path) {
          try {
            const { data: signedData } = await supabase.storage
              .from('recordings')
              .createSignedUrl(row.storage_path, 3600) // 1 hour token
            if (signedData?.signedUrl) {
              audioUrl = signedData.signedUrl
            } else {
              const { data: pubData } = supabase.storage.from('recordings').getPublicUrl(row.storage_path)
              audioUrl = pubData.publicUrl
            }
          } catch (e) {
            console.error(`Failed to sign URL for ${row.storage_path}:`, e)
          }
        }

        const creName = profileMap.get(row.cre_id) || profileMap.get(row.created_by) || 'CRE Agent'

        return {
          id: row.id,
          phone: row.phone || 'Unknown Phone',
          contactName: row.contact_name || null,
          creId: row.cre_id,
          creName,
          durationSeconds: Number(row.duration_seconds) || 0,
          callType: row.call_type || 'outgoing',
          recordedAt: row.recorded_at || row.created_at,
          uploadStatus: row.upload_status || 'uploaded',
          storagePath: row.storage_path || null,
          audioUrl,
          deviceModel: row.device_model || null,
          simSlot: row.sim_slot || null,
          importSource: row.import_source || null,
          localUri: row.local_uri || null,
        }
      })
    )

    return NextResponse.json({
      rows,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    })
  } catch (error) {
    console.error('[AM-Group-Call-Log] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load call recordings log' },
      { status: 500 }
    )
  }
}
