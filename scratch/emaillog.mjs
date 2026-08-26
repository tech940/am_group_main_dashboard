import 'dotenv/config'
import postgres from 'postgres'
const sqlc = postgres(process.env.DATABASE_URL, { prepare:false, ssl:'require', max:1, idle_timeout:5, connect_timeout:20 })
const cols = await sqlc`select column_name from information_schema.columns where table_name='kia_email_logs' order by ordinal_position`
console.log('kia_email_logs cols:', cols.map(c=>c.column_name).join(', '))
console.log('\n--- anything to parts@amkia.in ---')
console.table(await sqlc`select * from kia_email_logs where recipient ilike '%parts@amkia.in%' order by created_at desc limit 5`.catch(()=>[]))
console.log('\n--- most recent 5 logs overall ---')
console.table(await sqlc`select * from kia_email_logs order by created_at desc limit 5`.catch(e=>{console.log(e.message);return []}))
await sqlc.end({timeout:5})
