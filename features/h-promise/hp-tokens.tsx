/*
 * AM Tata · H Promise — section tokens, scoped to `.hp`.
 *
 * The accent is ALWAYS the dashboard theme's (var(--dashboard-primary)), so the header's theme switcher keeps
 * working; never write #055B65 or any other theme hex here. Neutrals stay on the app's slate utilities so the
 * global dark-mode net keeps handling them.
 *
 * Only the stage and status tones get their own variables: app/globals.css repaints the emerald / amber / rose
 * utilities with !important, so a tone written as a Tailwind class is not the tone that renders.
 *
 *   in stock  sky      booked   violet     sold     emerald
 *   pending   amber    rejected rose       neutral  slate
 */
export const HP_TOKENS_CSS = `
.hp {
  --hp-accent: var(--dashboard-primary);
  --hp-accent-rgb: var(--dashboard-primary-rgb);
  /* Ink (text, lines), fill (solid surfaces) and wash (tints). They split because some themes keep a very dark
     primary in dark mode — navy text on a navy-black page would vanish. */
  --hp-accent-ink: var(--dashboard-primary);
  --hp-accent-fill: var(--dashboard-primary);
  --hp-accent-edge: var(--dashboard-primary);
  --hp-accent-wash: rgba(var(--dashboard-primary-rgb), 0.08);
  --hp-count-bg: rgba(255, 255, 255, 0.78);
  /* Ink (text, lines), fill (solid surfaces) and wash (tints). They split because some themes keep a very dark
     primary in dark mode — navy text on a navy-black page would vanish. */
  --hp-accent-ink: var(--dashboard-primary);
  --hp-accent-fill: var(--dashboard-primary);
  --hp-accent-edge: var(--dashboard-primary);
  --hp-accent-wash: rgba(var(--dashboard-primary-rgb), 0.08);
  --hp-count-bg: rgba(255, 255, 255, 0.78);
  --hp-ink: #0f172a;
  --hp-muted: #64748b;
  --hp-rule: #e2e8f0;
  --hp-surface: #ffffff;
  --hp-sunken: #f8fafc;

  --hp-stock: #0369a1;   --hp-stock-bg: #e0f2fe;   --hp-stock-line: #bae6fd;
  --hp-booked: #6d28d9;  --hp-booked-bg: #ede9fe;  --hp-booked-line: #ddd6fe;
  --hp-sold: #047857;    --hp-sold-bg: #d1fae5;    --hp-sold-line: #a7f3d0;
  --hp-pending: #b45309; --hp-pending-bg: #fef3c7; --hp-pending-line: #fde68a;
  --hp-rejected: #be123c; --hp-rejected-bg: #ffe4e6; --hp-rejected-line: #fecdd3;
  --hp-neutral: #475569; --hp-neutral-bg: #f1f5f9; --hp-neutral-line: #cbd5e1;

  --hp-approve-solid: #047857;
  --hp-reject-solid: #be123c;

  --hp-plate-face: #ffffff;
  --hp-plate-ink: #111827;
  --hp-plate-edge: #1f2937;
  --hp-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
}
.dark .hp {
  --hp-ink: #e2e8f0;
  --hp-muted: #94a3b8;
  --hp-rule: rgba(148, 163, 184, 0.2);
  --hp-surface: #0f172a;
  --hp-sunken: rgba(15, 23, 42, 0.6);

  --hp-stock: #7dd3fc;   --hp-stock-bg: rgba(14, 165, 233, 0.14);  --hp-stock-line: rgba(125, 211, 252, 0.3);
  --hp-booked: #c4b5fd;  --hp-booked-bg: rgba(139, 92, 246, 0.16); --hp-booked-line: rgba(196, 181, 253, 0.3);
  --hp-sold: #6ee7b7;    --hp-sold-bg: rgba(16, 185, 129, 0.14);   --hp-sold-line: rgba(110, 231, 183, 0.3);
  --hp-pending: #fcd34d; --hp-pending-bg: rgba(245, 158, 11, 0.14); --hp-pending-line: rgba(252, 211, 77, 0.3);
  --hp-rejected: #fda4af; --hp-rejected-bg: rgba(244, 63, 94, 0.14); --hp-rejected-line: rgba(253, 164, 175, 0.3);
  --hp-neutral: #cbd5e1; --hp-neutral-bg: rgba(148, 163, 184, 0.14); --hp-neutral-line: rgba(148, 163, 184, 0.3);

  --hp-approve-solid: #059669;
  --hp-reject-solid: #e11d48;

  --hp-accent-ink: color-mix(in srgb, var(--dashboard-primary) 28%, #e2e8f0);
  --hp-accent-fill: color-mix(in srgb, var(--dashboard-primary) 62%, #334155);
  --hp-accent-edge: rgba(226, 232, 240, 0.24);
  --hp-accent-wash: rgba(148, 163, 184, 0.12);
  --hp-count-bg: rgba(2, 6, 23, 0.45);

  --hp-accent-ink: color-mix(in srgb, var(--dashboard-primary) 28%, #e2e8f0);
  --hp-accent-fill: color-mix(in srgb, var(--dashboard-primary) 62%, #334155);
  --hp-accent-edge: rgba(226, 232, 240, 0.24);
  --hp-accent-wash: rgba(148, 163, 184, 0.12);
  --hp-count-bg: rgba(2, 6, 23, 0.45);

  /* A number plate stays a white plate in the dark; only its edge softens. */
  --hp-plate-edge: #475569;
}
.hp ::selection { background: rgba(var(--hp-accent-rgb), 0.16); }
.hp :focus-visible { outline: 2px solid var(--hp-accent-ink); outline-offset: 2px; border-radius: 6px; }
.hp .hp-mono { font-family: var(--hp-mono); font-variant-numeric: tabular-nums; }
.hp .hp-num { font-variant-numeric: tabular-nums; }

/* The registration plate — India's HSRP: white face, dark embossed characters, the blue "IND" strip.
   ⚠️ These rules are unlayered, so they beat Tailwind's 'hidden' class: hide a plate by hiding a wrapper. */
.hp .hp-plate {
  display: inline-flex; align-items: stretch; overflow: hidden;
  background: var(--hp-plate-face); color: var(--hp-plate-ink);
  border: 1.5px solid var(--hp-plate-edge); border-radius: 5px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.9), 0 1px 0 rgba(15, 23, 42, 0.06);
  font-family: var(--hp-mono); font-weight: 700; letter-spacing: 0.08em; line-height: 1;
  white-space: nowrap;
}
.hp .hp-plate-strip {
  display: inline-flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  background: var(--hp-accent-fill); color: #ffffff;
  font-family: inherit; font-weight: 800; letter-spacing: 0.02em;
}
.hp .hp-plate-dot { width: 5px; height: 5px; border-radius: 999px; border: 1px solid rgba(255, 255, 255, 0.85); }
.hp .hp-plate-text { display: inline-flex; align-items: center; }

.hp .hp-tone { color: var(--tone); background: var(--tone-bg); border: 1px solid var(--tone-line); }
.hp .hp-tone-dot { background: var(--tone); }
.hp [data-tone='stock']    { --tone: var(--hp-stock);    --tone-bg: var(--hp-stock-bg);    --tone-line: var(--hp-stock-line); }
.hp [data-tone='booked']   { --tone: var(--hp-booked);   --tone-bg: var(--hp-booked-bg);   --tone-line: var(--hp-booked-line); }
.hp [data-tone='sold']     { --tone: var(--hp-sold);     --tone-bg: var(--hp-sold-bg);     --tone-line: var(--hp-sold-line); }
.hp [data-tone='approved'] { --tone: var(--hp-sold);     --tone-bg: var(--hp-sold-bg);     --tone-line: var(--hp-sold-line); }
.hp [data-tone='pending']  { --tone: var(--hp-pending);  --tone-bg: var(--hp-pending-bg);  --tone-line: var(--hp-pending-line); }
.hp [data-tone='rejected'] { --tone: var(--hp-rejected); --tone-bg: var(--hp-rejected-bg); --tone-line: var(--hp-rejected-line); }
.hp [data-tone='neutral']  { --tone: var(--hp-neutral);  --tone-bg: var(--hp-neutral-bg);  --tone-line: var(--hp-neutral-line); }
.hp [data-tone='accent']   { --tone: var(--hp-accent-ink); --tone-bg: var(--hp-accent-wash); --tone-line: color-mix(in srgb, var(--hp-accent-ink) 30%, transparent); }

.hp .hp-area-link[aria-current='page'] {
  background: var(--hp-accent-fill); color: #ffffff; border-color: var(--hp-accent-edge);
  box-shadow: 0 6px 16px -8px rgba(var(--hp-accent-rgb), 0.7);
}

/*
 * ⚠️ app/globals.css forces bg-white / bg-slate-50 / bg-slate-100 with !important inside .glass-dashboard-content.
 * An element whose background must change (an active pill, a tinted row) must NOT carry those classes.
 */
/* Accent surfaces written as variables: arbitrary bg utilities are unreliable under the app's rescue net. */
.hp .hp-accent-text { color: var(--hp-accent-ink); }
.hp .hp-accent-bg { background: var(--hp-accent-fill); color: #ffffff; box-shadow: inset 0 0 0 1px var(--hp-accent-edge); }
.hp .hp-accent-soft { background: var(--hp-accent-wash); }
.hp .hp-accent-ring { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--hp-accent-ink) 45%, transparent); }
/* Neutral surfaces as tokens: translucent slate utilities (bg-slate-50/60 …) are not covered by the dark net. */
.hp .hp-sunken-bg { background: var(--hp-sunken); }
.hp .hp-track { background: var(--hp-neutral-bg); }
.hp .hp-count { background: var(--hp-count-bg); }
.hp .hp-muted-text { color: var(--hp-muted); }
.hp .hp-hover { transition: background-color 120ms ease, color 120ms ease; }
.hp .hp-hover:hover { background: var(--hp-neutral-bg); color: var(--hp-ink); }
.hp .hp-tone-text { color: var(--tone); }
.hp .hp-tone-soft { background: var(--tone-bg); }
.hp .hp-tone-line { border-color: var(--tone-line); }
.hp .hp-tone-fill { background: var(--tone); }

/* KPI band: one surface, cells divided by hairlines — not a row of separate cards. */
.hp .hp-band { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (min-width: 768px) { .hp .hp-band { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (min-width: 1280px) { .hp .hp-band[data-cols='6'] { grid-template-columns: repeat(6, minmax(0, 1fr)); } .hp .hp-band[data-cols='5'] { grid-template-columns: repeat(5, minmax(0, 1fr)); } .hp .hp-band[data-cols='4'] { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
.hp .hp-band > * { border-color: var(--hp-rule); border-style: solid; border-width: 0 1px 1px 0; }
.hp .hp-cell-tick { position: absolute; left: 0; top: 14px; bottom: 14px; width: 3px; border-radius: 0 3px 3px 0; background: var(--tone, var(--hp-accent-ink)); }

/* Aging: the bar fills to 90 days and changes tone at the sheet's buckets. */
.hp .hp-age { position: relative; height: 6px; border-radius: 999px; background: var(--hp-neutral-bg); overflow: hidden; }
.hp .hp-age > span { position: absolute; inset: 0 auto 0 0; border-radius: 999px; background: var(--tone); }

/* The register table. Header colour and weight also have an opt-out in app/globals.css (its th rule is !important). */
.hp .hp-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 14.5px; }
.hp .hp-table thead th {
  position: sticky; top: 0; z-index: 1; background: var(--hp-sunken); color: var(--hp-muted);
  font-size: 12.5px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; text-align: left;
  padding: 11px 12px; border-bottom: 1px solid var(--hp-rule); white-space: nowrap;
}
.hp .hp-table tbody td { padding: 11px 12px; border-bottom: 1px solid var(--hp-rule); vertical-align: middle; }
.hp .hp-table-dense thead th, .hp .hp-table-dense tbody td { padding-left: 10px; padding-right: 10px; }
.hp .hp-noscrollbar { scrollbar-width: none; }
.hp .hp-noscrollbar::-webkit-scrollbar { display: none; }
.hp .hp-table tbody tr { transition: background-color 120ms ease; }
.hp .hp-table tbody tr[data-clickable='true'] { cursor: pointer; }
.hp .hp-table tbody tr[data-clickable='true']:hover { background: var(--hp-accent-wash); }
.hp .hp-scroll { overflow-x: auto; overflow-y: visible; overscroll-behavior: auto; -webkit-overflow-scrolling: touch; }
.hp .hp-scroll::-webkit-scrollbar { height: 8px; width: 8px; }
.hp .hp-scroll::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 8px; }

/* Lifecycle rail in the vehicle drawer. */
.hp .hp-rail { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(84px, 1fr); gap: 0; overflow-x: auto; padding-bottom: 2px; }
.hp .hp-rail-step { position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 0 4px; text-align: center; }
.hp .hp-rail-step::before {
  content: ''; position: absolute; top: 13px; left: -50%; right: 50%; height: 2px;
  background: var(--hp-rule);
}
.hp .hp-rail-step:first-child::before { display: none; }
.hp .hp-rail-step[data-done='true']::before { background: var(--tone); }
.hp .hp-rail-node {
  position: relative; z-index: 1; display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 999px; background: var(--hp-surface);
  border: 2px solid var(--tone-line); color: var(--tone);
}
.hp .hp-rail-step[data-state='done'] .hp-rail-node { background: var(--tone); border-color: var(--tone); color: #ffffff; }
.hp .hp-rail-step[data-state='skip'] .hp-rail-node { border-style: dashed; }

/* Drawer (Radix dialog) motion. */
@keyframes hp-sheet-in { from { transform: translateX(28px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes hp-fade-in { from { opacity: 0; } to { opacity: 1; } }
.hp-sheet[data-state='open'] { animation: hp-sheet-in 240ms cubic-bezier(0.16, 1, 0.3, 1); }
.hp-overlay[data-state='open'] { animation: hp-fade-in 160ms ease-out; }
@keyframes hp-rise { from { transform: translateY(6px); opacity: 0; } to { transform: none; opacity: 1; } }
.hp .hp-rise { animation: hp-rise 260ms cubic-bezier(0.16, 1, 0.3, 1) both; }
@media (prefers-reduced-motion: reduce) {
  .hp-sheet[data-state='open'], .hp-overlay[data-state='open'], .hp .hp-rise { animation: none; }
  .hp .hp-table tbody tr { transition: none; }
}

/* Buttons. The app's primary button paints itself with !important, so the section's tones need their own. */
.hp .hp-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem; white-space: nowrap;
  height: 36px; padding: 0 14px; border-radius: 8px; border: 1px solid transparent;
  font-size: 13px; font-weight: 600; line-height: 1; cursor: pointer;
  transition: filter 120ms ease, background-color 120ms ease, border-color 120ms ease;
}
.hp .hp-btn svg { width: 15px; height: 15px; flex-shrink: 0; }
.hp .hp-btn[data-size='sm'] { height: 30px; padding: 0 10px; font-size: 12px; }
.hp .hp-btn[data-size='lg'] { height: 40px; padding: 0 18px; font-size: 14px; }
.hp .hp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.hp .hp-btn[data-variant='accent'] { background: var(--hp-accent-fill); color: #ffffff; box-shadow: inset 0 0 0 1px var(--hp-accent-edge), 0 6px 14px -10px rgba(var(--hp-accent-rgb), 0.9); }
.hp .hp-btn[data-variant='approve'] { background: var(--hp-approve-solid); color: #ffffff; }
.hp .hp-btn[data-variant='reject'] { background: var(--hp-reject-solid); color: #ffffff; }
.hp .hp-btn[data-variant='outline'] { background: var(--hp-surface); color: var(--hp-ink); border-color: var(--hp-rule); }
.hp .hp-btn[data-variant='soft'] { background: var(--hp-accent-wash); color: var(--hp-accent-ink); }
.hp .hp-btn[data-variant='ghost'] { background: transparent; color: var(--hp-muted); }
.hp .hp-btn:not(:disabled):hover { filter: brightness(0.93); }
.hp .hp-btn[data-variant='outline']:not(:disabled):hover,
.hp .hp-btn[data-variant='ghost']:not(:disabled):hover { filter: none; background: var(--hp-sunken); color: var(--hp-ink); }
@media (prefers-reduced-motion: reduce) { .hp .hp-btn { transition: none; } }

/* File tiles. */
.hp .hp-file-tile { border: 1px dashed var(--hp-neutral-line); background: var(--hp-sunken); }
.hp .hp-file-tile[data-filled='true'] { border-style: solid; border-color: var(--hp-rule); background: var(--hp-surface); }
.hp .hp-file-tile[data-required='true'][data-filled='false'] { border-color: var(--hp-pending-line); background: var(--hp-pending-bg); }
.hp .hp-file-tile[data-invalid='true'] { border-color: var(--hp-rejected); background: var(--hp-rejected-bg); }

@media print {
  #app-sidebar, .dashboard-orb, .hp-noprint { display: none !important; }
  .hp .hp-scroll { overflow: visible !important; }
}
`

export function HPromiseTokens() {
  return <style>{HP_TOKENS_CSS}</style>
}
