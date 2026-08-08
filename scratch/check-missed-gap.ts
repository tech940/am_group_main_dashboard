import 'dotenv/config'
import { getCreSupabase } from '../lib/cre-calls/cre-supabase'

/** Why does the "Missed Incoming" KPI (v_call_activity.missed_calls) disagree with the
 *  Unanswered-Numbers tab total (direct call_log_entries count of missed/no_answer/rejected)? */
async function main() {
  const supabase = getCreSupabase()

  const countWhere = async (label: string, outcomes: string[]) => {
    const { count, error } = await supabase
      .from('call_log_entries')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null)
      .eq('direction', 'incoming')
      .in('outcome', outcomes)
    if (error) throw error
    console.log(`${label}: ${count}`)
    return count ?? 0
  }

  await countWhere('incoming outcome=missed              ', ['missed'])
  await countWhere('incoming outcome=no_answer           ', ['no_answer'])
  await countWhere('incoming outcome=rejected            ', ['rejected'])
  await countWhere('incoming all three (tab definition)  ', ['missed', 'no_answer', 'rejected'])

  // Rows the tab EXCLUDES for having no usable phone
  const { count: badPhone } = await supabase
    .from('call_log_entries')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null)
    .eq('direction', 'incoming')
    .in('outcome', ['missed', 'no_answer', 'rejected'])
    .or('phone.is.null,phone.eq.null,phone.eq.Unknown Phone')
  console.log(`of those, unusable phone (excluded by tab): ${badPhone}`)

  // What the KPI actually sums: v_call_activity.missed_calls
  const { data: viewRows, error: viewErr } = await supabase
    .from('v_call_activity')
    .select('missed_calls')
    .range(0, 9999)
  if (viewErr) throw viewErr
  const viewSum = (viewRows ?? []).reduce((s, r) => s + (Number(r.missed_calls) || 0), 0)
  console.log(`sum(v_call_activity.missed_calls) [KPI]    : ${viewSum} over ${viewRows?.length} view rows`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
