/**
 * Auto-deactivation policy, shared by the server sweep (lib/auth/user-deactivation.ts) and the
 * Admin → Users UI. Deliberately has no `server-only` marker so the client can read the threshold
 * instead of hardcoding a copy that silently drifts out of sync with the job.
 */

/** Idle window before a non-exempt account is automatically deactivated. */
export const AUTO_DEACTIVATION_IDLE_DAYS = 7

/**
 * Roles that are NEVER auto-deactivated, however long they stay idle.
 * `eba` and `ca` are distinct roles and are intentionally NOT exempt — do not confuse them with
 * `ea` / `accounts`.
 */
export const AUTO_DEACTIVATION_EXEMPT_ROLES = ['md', 'ea', 'accounts', 'developer'] as const
