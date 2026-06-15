require('dotenv').config({ quiet: true })
const dns = require('node:dns')
dns.setDefaultResultOrder('ipv4first')

const postgres = require('postgres')
const { databaseUrlCandidates } = require('./db-url')
const { pickDatabaseUrl } = require('./db-url')

async function main() {
  console.log('[db-test] candidates:', databaseUrlCandidates().map((url) => {
    const endpoint = new URL(url)
    return `${endpoint.hostname}:${endpoint.port}`
  }))

  await pickDatabaseUrl(postgres, '[db-test]')
  console.log('[db-test] connection OK')
}

main().catch((error) => {
  console.error('[db-test] fatal', error.message)
  process.exit(1)
})
