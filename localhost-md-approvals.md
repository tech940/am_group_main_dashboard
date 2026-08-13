# Design Taste — MD Approvals (localhost:3000/md-approvals)

> **Capture caveat**: derived from source code (`app/md-approvals/md-approvals-client.tsx`, `app/globals.css`, shared UI components), not a live screenshot — the page sits behind authentication and the embedded browser session could not hold a login. All values are exact from code; rendered-surface percentages are approximations and marked `~approx`.

## Design Map

### Colors
| Role | Value | Source |
|---|---|---|
| Accent (themeable) | `#4B49AC` via `var(--dashboard-primary)` (default theme; dark theme swaps to `#191C24`/`#AF1763`) | globals.css:7-77 |
| Accent dark (hover) | `#373482` via `var(--dashboard-primary-dark)` | globals.css:8 |
| Accent tint (selection) | `rgba(75,73,172,0.12)` row selection; `0.06`–`0.08` for icon chips | md-approvals-client.tsx:881,491 |
| Page/card neutrals | white cards on the app shell; borders `slate-200/80`; text `slate-400 → slate-800` ramp | CARD const, line 108 |
| Verdict colors | rose-50/200/700 (reject/failure), amber-50/200/800 (hold/aging), emerald-50/200/800 (success) | lines 618-661, 812-824, 908-915 |
| One filled surface | table header banner: `linear-gradient(135deg, primary → primary-dark)`, white 9px caps text | HEADER_BANNER, line 104 |

### Typography
- Family: **Inter** everywhere (app/layout.tsx:2). No display face, no serif.
- Scale is *tiny and heavy*: page headline number `text-3xl` (30px) `font-black`; table body `text-xs` (12px); buttons `text-xs`/`text-[11px]` `font-black`; row action buttons `text-[11px]`; micro-labels `text-[9px]`–`text-[10px]` `font-black uppercase tracking-[0.1em]`–`[0.14em]`.
- Weight distribution: 700 (`font-bold`) for data, 900 (`font-black`) for anything clickable or labelling, 600 (`font-semibold`) for secondary metadata. Regular (400) is effectively absent.
- Numbers: `tabular-nums` on amounts (line 900).

### Spacing & Layout
- Page rhythm: `space-y-5` (20px) between every major block; cards pad `p-5` (20px); table cells `px-4 py-3` (16/12px).
- KPI grid: 1 → 2 (`sm`) → 4 (`xl`) columns, `gap-3` (12px).
- Controls row: single wrapping flex line, `gap-2` (8px), filters pushed right with `ml-auto`.
- Control height is locked: every input/button/select is `h-10` (40px); row-level actions drop to `py-1.5`.

### Radii
- Cards & table shell: `rounded-3xl` (24px). Controls & pills: `rounded-xl` (12px). In-row buttons: `rounded-lg` (8px). Count badges & stage chips: `rounded-full`.
- Strict 3-tier hierarchy: the bigger the surface, the bigger the radius — never mixed within a tier.

### Shadows & Effects
- Cards: `shadow-xs` (near-flat); elevation is expressed by borders, not shadows.
- Single exception: the sticky bulk-action bar wears `shadow-[0_18px_40px_-12px_rgba(5,91,101,0.35)]` — a heavy, *hardcoded tropical-teal* shadow that does not follow the theme token (a leak; every other accent reference is `var(--dashboard-primary)`).
- Motion: 150ms color transitions and spinners only; no entrance animation anywhere (`~approx`: confirmed in code, not visually).

### Grid / structure
- Work-queue anatomy top-to-bottom: headline card → source tabs with count badges → 4 KPI cards → outcome panels (conditional) → filter row → sticky bulk bar (conditional) → full-width table.
- Table: 7 columns, whole-row click = select, right-aligned action cluster per row.

## Taste DNA

**1. Authority comes from weight, not size**
- **Trigger**: an executive queue where 7 columns of money data must fit one screen without scrolling per row.
- **Decision**: shrink type to 9–12px but push weights to 700–900 with wide letter-spaced uppercase micro-labels; the only large glyphs on the page are the two numbers an MD actually scans (the "waiting on you" 30px counter and amounts).
- **Reason**: at this density, larger type would cost rows-per-screen; heavy weight at small sizes keeps scannability without sacrificing density. The alternative — 14px comfortable type — was rejected because triage speed beats reading comfort here.
- **Evidence**: `text-[9px] font-black uppercase tracking-[0.12em]` table headers; `text-[10px] ... tracking-[0.14em]` eyebrow; 30px `font-black` counter (lines 495-499, 836).

**2. One filled surface per screen**
- **Trigger**: a page full of white cards risks the accent color decaying into decoration.
- **Decision**: exactly one gradient-filled surface — the table header banner — and the code comments it explicitly: "The header banner is the only filled surface on the page." Everything else is white with slate borders; the accent appears only as text, focus rings, tints ≤12%, and the active tab.
- **Reason**: the filled banner marks where the real work starts (the table), and keeps ₹ amounts as the darkest, highest-contrast ink on the page. Two filled surfaces would compete; zero would leave the table unanchored.
- **Evidence**: HEADER_BANNER gradient (line 104) vs. `CARD = 'bg-white ... border-slate-200/80 ... shadow-xs'` (line 108). One leak exists: the bulk bar's hardcoded `rgba(5,91,101,0.35)` shadow bypasses the theme token.

**3. State is flat color — never motion, never elevation** *(Restraint)*
- **Trigger**: row selection and hover in a bulk-selection table invite the usual card-lift/scale/checkbox theatrics.
- **Decision**: selection is a 5px left accent bar plus a 12% tint — with the 5px gutter *reserved even when unselected* so nothing shifts on click; hover is a flat `slate-50` wash; non-actionable rows get no hover affordance at all.
- **Reason**: on a screen where a click approves money, layout must be perfectly still under the pointer; affordance is granted only where action is possible, so "can I act on this?" is answered by the cursor, not by reading the stage column.
- **Evidence**: `borderLeft: 5px solid transparent|primary` inline style (lines 879-882); `role`/`tabIndex`/hover applied only when `row.awaitingMd` (lines 867-887).

**4. Semantic color is reserved for verdicts**
- **Trigger**: three verdict actions (approve / reject / hold) on every row of a mostly-monochrome page.
- **Decision**: rose, amber and emerald appear *only* on verdict surfaces — reject buttons and failure panels (rose), hold buttons and aging badges (amber), success confirmations (emerald). Approve deliberately wears the brand primary, not green. Chrome, filters, tabs and KPIs stay slate + primary.
- **Reason**: when color always means "a decision or its consequence," a flash of rose in peripheral vision *is* the alert; green-for-approve was rejected so the commonest action reads as neutral-default rather than a celebration.
- **Evidence**: approve = `bg-[var(--dashboard-primary)]` (line 803); reject = `border-rose-200 text-rose-700` (line 812); `days >= 7` badge flips slate → amber (lines 908-915); failure panel rose-50/200 (line 636).
