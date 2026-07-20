import 'dotenv/config'
import { db } from '../lib/db'
import { vendors, approvalsCommonData } from '../lib/db/schema'
import { eq, isNull } from 'drizzle-orm'

async function main() {
  console.log('Fetching all common vendors from approvalsCommonData...')
  const commonVendors = await db
    .select()
    .from(approvalsCommonData)
    .where(eq(approvalsCommonData.category, 'vendor'))

  console.log(`Found ${commonVendors.length} common vendors in approvalsCommonData.`)

  console.log('Fetching existing vendors from vendors table...')
  const existingVendors = await db.select().from(vendors)
  console.log(`Found ${existingVendors.length} existing vendors in vendors table.`)

  // Migrate common vendors to vendors table if missing
  let migratedCount = 0
  for (const cv of commonVendors) {
    const cvName = String(cv.value || '').trim()
    if (!cvName) continue

    const alreadyExists = existingVendors.some(
      (ev) => ev.name.trim().toLowerCase() === cvName.toLowerCase()
    )

    if (!alreadyExists) {
      const [inserted] = await db
        .insert(vendors)
        .values({
          name: cvName,
          gstNumber: null, // GST is now optional
          email: null,
          phone: null,
          address: null,
        })
        .returning()
      existingVendors.push(inserted)
      migratedCount++
    }
  }
  console.log(`Migrated ${migratedCount} new vendors from approvalsCommonData to vendors table.`)

  // Now, assign vendor codes sequentially
  console.log('Assigning sequential vendor codes starting from V-001...')
  let codeCounter = 1
  let updatedCount = 0

  // Sort by createdAt so the sequence follows insertion order
  existingVendors.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

  for (const vendor of existingVendors) {
    let code = vendor.vendorCode
    if (!code) {
      // Find a unique code that is not used yet
      while (true) {
        const potentialCode = `V-${String(codeCounter).padStart(3, '0')}` // e.g. V-001
        const codeUsed = existingVendors.some((ev) => ev.vendorCode === potentialCode)
        if (!codeUsed) {
          code = potentialCode
          break
        }
        codeCounter++
      }
      
      await db
        .update(vendors)
        .set({ vendorCode: code })
        .where(eq(vendors.id, vendor.id))
      
      vendor.vendorCode = code
      updatedCount++
      codeCounter++
    }
  }

  console.log(`Auto-assigned vendor codes to ${updatedCount} vendors.`)
  console.log('Migration completed successfully!')
}

main()
