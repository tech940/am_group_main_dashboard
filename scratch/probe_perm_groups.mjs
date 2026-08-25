import 'dotenv/config'
import postgres from 'postgres'

const url = (process.env.DATABASE_URL || '').replace(':6543', ':5432').replace(/([?&])pgbouncer=true&?/, '$1')
const sql = postgres(url, { max: 1, prepare: false, ssl: 'require' })

const groups = await sql`SELECT key, name, sort_order, is_active FROM permission_groups ORDER BY sort_order`
console.log(`permission_groups rows: ${groups.length}  (active ${groups.filter(g => g.is_active).length})`)

const inactive = groups.filter((g) => !g.is_active)
console.log(`INACTIVE group rows: ${inactive.length ? inactive.map(g => g.key).join(', ') : 'none'}`)

const dbKeys = new Set(groups.map((g) => g.key))
console.log('\nDB keys (active only), in sort order:')
for (const g of groups.filter(x => x.is_active)) console.log(`  ${String(g.sort_order).padStart(5)}  ${g.key}`)

const [{ n }] = await sql`SELECT COUNT(*)::int n FROM permissions WHERE is_active = true`
console.log(`\npermissions rows (active): ${n}`)

await sql.end()
