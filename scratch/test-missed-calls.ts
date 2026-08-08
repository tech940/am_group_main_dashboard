import 'dotenv/config';
import { getCreSupabase } from '../lib/cre-calls/cre-supabase';

async function testMissedCalls() {
  const supabase = getCreSupabase();

  const { data: missedCalls, error } = await supabase
    .from('call_log_entries')
    .select('id, phone, contact_name, direction, outcome, started_at, cre_id')
    .is('deleted_at', null)
    .eq('direction', 'incoming')
    .in('outcome', ['missed', 'rejected', 'no_answer'])
    .order('started_at', { ascending: false });

  if (error) {
    console.error('Error fetching missed calls:', error);
    return;
  }

  const validMissed = (missedCalls || []).filter(c => c.phone && c.phone !== 'null' && c.phone !== 'Unknown Phone');
  const phones = Array.from(new Set(validMissed.map(c => c.phone)));

  console.log(`Found ${validMissed.length} missed incoming calls across ${phones.length} unique phone numbers.`);

  let answeredCalls: any[] = [];
  if (phones.length > 0) {
    const { data: ans } = await supabase
      .from('call_log_entries')
      .select('id, phone, direction, outcome, started_at, cre_id, duration_seconds')
      .is('deleted_at', null)
      .in('phone', phones.slice(0, 200))
      .eq('outcome', 'answered');
    answeredCalls = ans || [];
  }

  let connectedLaterCount = 0;
  let remainedMissingCount = 0;

  const callerMap = new Map<string, { totalMissed: number; connectedLater: boolean }>();

  for (const missed of validMissed) {
    const p = missed.phone;
    const missedTime = new Date(missed.started_at).getTime();
    
    // Check if there is an answered call after missed call timestamp
    const hasCallback = answeredCalls.some(a => a.phone === p && new Date(a.started_at).getTime() > missedTime);
    
    if (hasCallback) {
      connectedLaterCount++;
    } else {
      remainedMissingCount++;
    }

    const callerEntry = callerMap.get(p) || { totalMissed: 0, connectedLater: false };
    callerEntry.totalMissed++;
    if (hasCallback) callerEntry.connectedLater = true;
    callerMap.set(p, callerEntry);
  }

  const totalCallers = callerMap.size;
  let connectedLaterCallers = 0;
  let remainedMissingCallers = 0;

  for (const info of callerMap.values()) {
    if (info.connectedLater) connectedLaterCallers++;
    else remainedMissingCallers++;
  }

  console.log('--- MISSED INCOMING RECOVERY METRICS ---');
  console.log(`Total Missed Calls: ${validMissed.length}`);
  console.log(`Connected Later: ${connectedLaterCount} (${Math.round((connectedLaterCount / Math.max(1, validMissed.length)) * 100)}%)`);
  console.log(`Remained Missing: ${remainedMissingCount} (${Math.round((remainedMissingCount / Math.max(1, validMissed.length)) * 100)}%)`);
  console.log('--- CALLERS METRICS ---');
  console.log(`Total Unique Missed Callers: ${totalCallers}`);
  console.log(`Callers Connected Later: ${connectedLaterCallers}`);
  console.log(`Callers Still Unconnected: ${remainedMissingCallers}`);
}

testMissedCalls().catch(console.error);
