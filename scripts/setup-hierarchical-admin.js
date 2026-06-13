const fs = require('fs')
const path = require('path')
const postgres = require('postgres')
require('dotenv').config({ quiet: true })

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured')
  const db = postgres(process.env.DATABASE_URL, {
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
    max: 1,
    prepare: false,
  })

  try {
    const file = path.join(__dirname, 'setup-hierarchical-admin.sql')
    const statements = fs.readFileSync(file, 'utf8')
      .split(/;\s*(?=(?:ALTER|CREATE|UPDATE)\s)/i)
      .map((statement) => statement.trim())
      .filter(Boolean)
    for (const statement of statements) await db.unsafe(statement.replace(/;\s*$/, ''))
    console.log('Hierarchical admin schema and role migration are ready.')
  } finally {
    await db.end()
  }
}

main().catch((error) => {
  console.error('Failed to setup hierarchical admin:', error)
  process.exit(1)
})
