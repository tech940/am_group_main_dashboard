// Role gate for the Call Analysis section. Hardcoded allowlist (NOT a permission), matching the
// Vehicle Tracker / CA pattern: call recordings and full customer-number logs are the most sensitive
// data in the app, and the requirement is exactly two roles. A permission key would be widenable via
// the Access Map and would drag the whole tiered resolver in; this cannot be widened by accident.
//
// Client-safe: no server-only imports, so the sidebar can import it directly.

export const CALL_ANALYSIS_VIEW_ROLES = ['md', 'developer', 'assistant_manager', 'ea', 'eba'] as const

export function canViewCallAnalysis(role?: string | null): boolean {
  return (CALL_ANALYSIS_VIEW_ROLES as readonly string[]).includes(String(role || '').toLowerCase().trim())
}
