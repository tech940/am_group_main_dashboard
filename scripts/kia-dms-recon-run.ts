/**
 * Rebuilds the KIA DMS reconciliation now (the same run the maintenance cron and the Re-check button
 * trigger). Writes ONLY kia_dms_recon_items / kia_dms_recon_state — never a booking, never a DMS feed.
 *
 *   npx tsx --tsconfig ./tsconfig.verify.json scripts/kia-dms-recon-run.ts [--if-stale]
 */
import 'dotenv/config'
import { runKiaDmsReconciliation } from '../lib/kia/dms-reconciliation/run'

runKiaDmsReconciliation({ onlyIfStale: process.argv.includes('--if-stale') })
  .then((result) => { console.log(JSON.stringify(result, null, 2)); process.exit(0) })
  .catch((error) => { console.error(error); process.exit(1) })
