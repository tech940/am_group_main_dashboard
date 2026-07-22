import fs from 'fs'
import path from 'path'

const parsedJsonPath = path.join(__dirname, 'parsed-transactions.json')
const mockDataPath = path.join(__dirname, '../lib/scrap-erp/mock-data.ts')

const rawData = fs.readFileSync(parsedJsonPath, 'utf8')
const transactions = JSON.parse(rawData)

console.log(`Loaded ${transactions.length} parsed transactions.`)

// Read mock-data.ts
let mockDataContent = fs.readFileSync(mockDataPath, 'utf8')

// Replace INITIAL_SCRAP_TRANSACTIONS definition
const newTxDefinition = `export const INITIAL_SCRAP_TRANSACTIONS: ScrapTransaction[] = ${JSON.stringify(transactions, null, 2)}`

const regex = /export const INITIAL_SCRAP_TRANSACTIONS: ScrapTransaction\[\] = \[\s*[\s\S]*?\n\]/
if (regex.test(mockDataContent)) {
  mockDataContent = mockDataContent.replace(regex, newTxDefinition)
  fs.writeFileSync(mockDataPath, mockDataContent, 'utf8')
  console.log(`Successfully updated INITIAL_SCRAP_TRANSACTIONS in ${mockDataPath}`)
} else {
  console.error(`Could not find regex match for INITIAL_SCRAP_TRANSACTIONS`)
}
