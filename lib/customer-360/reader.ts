import 'server-only'
import { CUSTOMER_BRANDS, type CustomerBrand } from './brands'
import { listSalesOnlyCustomers, getSalesOnlyCustomerProfile } from './sales-only-reader'
import {
  listKiaCustomers, getKiaCustomerProfile,
  type KiaCustomerListFilters, type KiaCustomerListResult, type KiaCustomerProfile,
} from '@/lib/kia/customer-profile/reader'
import { parseCustomerKey } from '@/lib/kia/customer-profile/identity'

/**
 * CUSTOMER 360 — the brand dispatcher.
 *
 * One seam, so the page and both API routes never branch on brand themselves. KIA has a purpose-built
 * reader that joins the enquiry, booking, workshop, insurance and complaint feeds; every other brand
 * currently reaches only its sales feed. See brands.ts for why.
 */

export async function listCustomers(
  brand: CustomerBrand,
  filters: KiaCustomerListFilters = {},
): Promise<KiaCustomerListResult> {
  if (brand === 'kia') return listKiaCustomers(filters)
  return listSalesOnlyCustomers(CUSTOMER_BRANDS[brand], filters)
}

export async function getCustomerProfile(
  brand: CustomerBrand,
  rawKey: string,
  options: { serviceGapMonths?: number | null; dealerScope?: string[] | null } = {},
): Promise<KiaCustomerProfile | null> {
  if (brand === 'kia') {
    const key = parseCustomerKey(rawKey)
    if (!key) return null
    return getKiaCustomerProfile(key, options)
  }
  return getSalesOnlyCustomerProfile(CUSTOMER_BRANDS[brand], rawKey, {
    dealerScope: options.dealerScope ?? null,
  })
}
