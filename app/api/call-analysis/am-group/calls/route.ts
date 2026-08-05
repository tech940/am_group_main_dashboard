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
  const branch = searchParams.get('branch')
  const callStatus = searchParams.get('callStatus')
  const search = (searchParams.get('search') || '').trim().toLowerCase()
  const recordingsOnly = searchParams.get('recordingsOnly') === 'true'
  const pendingOnly = searchParams.get('pendingOnly') === 'true'

  try {
    const supabase = getCreSupabase()

    // 1. Fetch profiles and branch map
    const [profilesRes, branchesRes] = await Promise.all([
      supabase.from('user_profiles').select('id, full_name, branch_id'),
      supabase.from('branch_directory').select('id, display_name'),
    ])

    const profileMap = new Map((profilesRes.data || []).map((p: any) => [p.id, p.full_name]))
    const profileBranchMap = new Map((profilesRes.data || []).map((p: any) => [p.id, p.branch_id]))
    const branchMap = new Map((branchesRes.data || []).map((b: any) => [b.id, b.display_name]))

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
    if (branch && branch !== 'all') {
      query = query.eq('branch_id', branch)
    }
    if (recordingsOnly) {
      query = query.not('storage_path', 'is', null)
    } else if (pendingOnly) {
      query = query.is('storage_path', null)
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
        const bId = row.branch_id || profileBranchMap.get(row.cre_id) || 'general'
        const branchName = branchMap.get(bId) || 'General Branch'
        const durationSec = Number(row.duration_seconds) || 0
        const rawType = (row.call_type || 'outgoing').toLowerCase()

        let statusLabel = 'Connected Outgoing'
        let statusBadgeClass = 'bg-blue-50 text-blue-700 border-blue-200'

        if (rawType === 'missed' || (rawType === 'incoming' && durationSec === 0)) {
          statusLabel = 'Missed Incoming'
          statusBadgeClass = 'bg-rose-50 text-rose-700 border-rose-200'
        } else if (rawType === 'incoming' && durationSec > 0) {
          statusLabel = 'Connected Incoming'
          statusBadgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-200'
        } else if (rawType === 'outgoing' && durationSec > 0) {
          statusLabel = 'Connected Outgoing'
          statusBadgeClass = 'bg-[#004e5a]/10 text-[#004e5a] border-[#004e5a]/20'
        } else {
          statusLabel = 'Missed Outgoing (Not Answered)'
          statusBadgeClass = 'bg-amber-50 text-amber-700 border-amber-200'
        }

        return {
          id: row.id,
          phone: row.phone || 'Unknown Phone',
          contactName: row.contact_name || null,
          creId: row.cre_id,
          creName,
          branchId: bId,
          branchName,
          durationSeconds: durationSec,
          callType: row.call_type || 'outgoing',
          statusLabel,
          statusBadgeClass,
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
