# Access Control & Sidebar Redesign — Implementation Plan

Goal: let an admin control **each user's access to every dashboard section**, and make
**adding a new sidebar section a single edit**. Approved direction: Deny wins · full
unification · UI-editable roles.

> ⚠️ This repo's Next.js (16.2.6) has breaking changes (see `AGENTS.md`). Read the relevant
> guide in `node_modules/next/dist/docs/` before writing route-guard / middleware code (Phases 1 & 3).
>
> 🎨 Do **not** change the existing UI color scheme (slate/indigo/white + navy sidebar). All
> changes are structural/behavioral.

## Core model

`effective = { ...roleDefaults, ...userOverrides }` — an explicit user override always wins,
**including Deny**. Brand no longer auto-grants; it contributes *view defaults* for the brand's
sections. `developer` (and `md`) remain absolute.

## Two server gates (important)

- `requireBrandApiAccess(brand)` — coarse, brand-membership only. Unchanged.
- `requirePermission(user, '<section>.view')` — fine-grained. **This is the one a per-section
  Deny flows through.** Phase 3 audits every section route to use it.

---

## Phase 1 — Registry + resolution + cutover (foundation)

1. **Extend registry** (`lib/permissions/registry.ts`): add `href`, `navLabel`, `icon`,
   `navHidden` to section entries; add a `BRAND_PRESENTATION` map (logos/colors/order) for the
   sidebar. `PERMISSIONS` still derives via `flatMap`.
2. **Fix resolution** (`lib/permissions/service.ts`): remove the brand short-circuits in
   `canUserAccessPermission` and the snapshot builders; grant brand *view defaults* per brand in
   `applyBranchRoleDefaults`; `effective` = role defaults overlaid by overrides (override wins).
   Bump `PERMISSION_CACHE_VERSION` v5 → v6.
3. **Cutover migration** (`scripts/migrate-brand-grants-to-overrides.ts`): for each active
   non-global user, freeze the *delta* — keys where old-effective was `true` but the new default
   is `false` — into explicit `user_permissions` allow-rows. Guarantees zero access loss; admins
   prune later. Verify script diffs old vs new effective for all users (must be empty).

## Phase 2 — Access panel redesign

Tri-state Allow/Inherit/Deny, section tree mirroring the sidebar, bulk (grant brand / reset to
role / copy from user), sticky diff bar. Extract to `features/admin/access-control-panel.tsx`.
API returns `roleDefaults`; add `copyFromUserId`. Existing colors only.

## Phase 3 — Sidebar + guards from registry

Rewrite `components/layout/sidebar.tsx` to build nav from registry + `BRAND_PRESENTATION`;
delete `brandNavigation`, `sidebarPermissionByHref`, and hardcoded role lists. Visibility =
`effective['<key>.view']`. Add `sectionForHref()` helper; audit section route guards to use
`requirePermission`. Retire `lib/kia/vehicle-tracker-access.ts` last.

## Phase 4 — UI-editable role defaults

Split structure-sync from role-defaults **seed** (insert-if-absent; never overwrite existing
role rows). Add `app/api/admin/roles/route.ts` + a Roles tab reusing the tri-state tree.
A role edit invalidates the permission cache for every user of that role.
