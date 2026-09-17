/**
 * H Promise query keys. NOT a client module: the page (a server component) seeds the query cache under these
 * same keys, so the register arrives already loaded.
 */
export const hpKeys = {
  all: ['h-promise'] as const,
  vehicles: (view: 'live' | 'deleted') => ['h-promise', 'vehicles', view] as const,
  vehicle: (id: string) => ['h-promise', 'vehicle', id] as const,
  previews: (id: string) => ['h-promise', 'previews', id] as const,
  meta: ['h-promise', 'meta'] as const,
  bonuses: ['h-promise', 'bonuses'] as const,
  settingsHistory: ['h-promise', 'settings-history'] as const,
}

/** The tabs of the one H Promise page. Shared with the server pages, which pick the opening tab. */
export type HpTab = 'vehicles' | 'overdue' | 'approvals' | 'payments' | 'insights' | 'bonus' | 'deleted'

export const HP_TABS: readonly HpTab[] = ['vehicles', 'overdue', 'approvals', 'payments', 'insights', 'bonus', 'deleted']

export function isHpTab(value: unknown): value is HpTab {
  return typeof value === 'string' && (HP_TABS as readonly string[]).includes(value)
}
