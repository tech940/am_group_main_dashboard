/*
 * AM Tata · H Promise — Executive section tokens, scoped to `.hp`.
 * Unified with AM Group design system: Inter typography, soft muted executive tones, no AI slob.
 */
export const HP_TOKENS_CSS = `
.hp {
  font-family: var(--font-inter), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --hp-accent: var(--dashboard-primary);
  --hp-accent-rgb: var(--dashboard-primary-rgb);
  --hp-accent-ink: var(--dashboard-primary);
  --hp-accent-fill: var(--dashboard-primary);
  --hp-accent-edge: var(--dashboard-primary);
  --hp-accent-wash: rgba(var(--dashboard-primary-rgb), 0.06);
  --hp-count-bg: rgba(255, 255, 255, 0.85);
  --hp-ink: #0f172a;
  --hp-muted: #64748b;
  --hp-rule: #e2e8f0;
  --hp-surface: #ffffff;
  --hp-sunken: #f8fafc;

  /* Soft Executive Semantic Tones (No Saturated AI Neons) */
  --hp-stock: #0369a1;    --hp-stock-bg: #f0f9ff;    --hp-stock-line: #e0f2fe;
  --hp-booked: #4f46e5;   --hp-booked-bg: #eef2ff;   --hp-booked-line: #e0e7ff;
  --hp-sold: #166534;     --hp-sold-bg: #f0fdf4;     --hp-sold-line: #dcfce7;
  --hp-pending: #b45309;  --hp-pending-bg: #fffbeb;  --hp-pending-line: #fef3c7;
  --hp-rejected: #be123c; --hp-rejected-bg: #fff1f2; --hp-rejected-line: #ffe4e6;
  --hp-neutral: #475569;  --hp-neutral-bg: #f8fafc;  --hp-neutral-line: #e2e8f0;

  --hp-approve-solid: #166534;
  --hp-reject-solid: #be123c;

  --hp-plate-face: #ffffff;
  --hp-plate-ink: #1e293b;
  --hp-plate-edge: #cbd5e1;
  --hp-mono: var(--font-inter), ui-sans-serif, system-ui, sans-serif;
}
.dark .hp {
  --hp-ink: #e2e8f0;
  --hp-muted: #94a3b8;
  --hp-rule: rgba(148, 163, 184, 0.16);
  --hp-surface: #0f172a;
  --hp-sunken: rgba(15, 23, 42, 0.5);

  --hp-stock: #7dd3fc;   --hp-stock-bg: rgba(14, 165, 233, 0.1);  --hp-stock-line: rgba(125, 211, 252, 0.2);
  --hp-booked: #a5b4fc;  --hp-booked-bg: rgba(99, 102, 241, 0.1); --hp-booked-line: rgba(165, 180, 252, 0.2);
  --hp-sold: #86efac;    --hp-sold-bg: rgba(34, 197, 94, 0.1);   --hp-sold-line: rgba(134, 239, 172, 0.2);
  --hp-pending: #fde047; --hp-pending-bg: rgba(234, 179, 8, 0.1); --hp-pending-line: rgba(253, 224, 71, 0.2);
  --hp-rejected: #fda4af; --hp-rejected-bg: rgba(244, 63, 94, 0.1); --hp-rejected-line: rgba(253, 164, 175, 0.2);
  --hp-neutral: #cbd5e1; --hp-neutral-bg: rgba(148, 163, 184, 0.1); --hp-neutral-line: rgba(148, 163, 184, 0.2);

  --hp-approve-solid: #15803d;
  --hp-reject-solid: #e11d48;

  --hp-accent-ink: color-mix(in srgb, var(--dashboard-primary) 28%, #e2e8f0);
  --hp-accent-fill: color-mix(in srgb, var(--dashboard-primary) 62%, #334155);
  --hp-accent-edge: rgba(226, 232, 240, 0.18);
  --hp-accent-wash: rgba(148, 163, 184, 0.08);
  --hp-count-bg: rgba(2, 6, 23, 0.45);

  --hp-plate-edge: #475569;
}
.hp ::selection { background: rgba(var(--hp-accent-rgb), 0.14); }
.hp :focus-visible { outline: 2px solid var(--hp-accent-ink); outline-offset: 2px; border-radius: 6px; }
.hp .hp-mono { font-family: var(--hp-mono); font-variant-numeric: tabular-nums; }
.hp .hp-num { font-variant-numeric: tabular-nums; }

/* The registration plate — Clean Indian HSRP */
.hp .hp-plate {
  display: inline-flex; align-items: stretch; overflow: hidden;
  background: var(--hp-plate-face); color: var(--hp-plate-ink);
  border: 1px solid var(--hp-plate-edge); border-radius: 4px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  font-family: var(--hp-mono); font-weight: 600; letter-spacing: 0.04em; line-height: 1;
  white-space: nowrap;
}
.hp .hp-plate-strip {
  display: inline-flex; flex-direction: column; align-items: center; justify-content: center; gap: 1.5px;
  background: var(--hp-accent-fill); color: #ffffff;
  font-family: inherit; font-weight: 700; letter-spacing: 0.02em;
}
.hp .hp-plate-dot { width: 4px; height: 4px; border-radius: 999px; border: 1px solid rgba(255, 255, 255, 0.85); }
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
.hp [data-tone='accent']   { --tone: var(--hp-accent-ink); --tone-bg: var(--hp-accent-wash); --tone-line: color-mix(in srgb, var(--hp-accent-ink) 25%, transparent); }

.hp .hp-accent-text { color: var(--hp-accent-ink); }
.hp .hp-accent-bg { background: var(--hp-accent-fill); color: #ffffff; }
.hp .hp-accent-soft { background: var(--hp-accent-wash); }
.hp .hp-accent-ring { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--hp-accent-ink) 35%, transparent); }

.hp .hp-sunken-bg { background: var(--hp-sunken); }
.hp .hp-track { background: var(--hp-neutral-bg); }
.hp .hp-count { background: var(--hp-count-bg); }
.hp .hp-muted-text { color: var(--hp-muted); }
.hp .hp-hover { transition: background-color 100ms ease, color 100ms ease; }
.hp .hp-hover:hover { background: var(--hp-neutral-bg); color: var(--hp-ink); }
.hp .hp-tone-text { color: var(--tone); }
.hp .hp-tone-soft { background: var(--tone-bg); }
.hp .hp-tone-line { border-color: var(--tone-line); }
.hp .hp-tone-fill { background: var(--tone); }

/* KPI band: clean unified surface with subtle dividers */
.hp .hp-band { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (min-width: 768px) { .hp .hp-band { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (min-width: 1280px) {
  .hp .hp-band[data-cols='6'] { grid-template-columns: repeat(6, minmax(0, 1fr)); }
  .hp .hp-band[data-cols='5'] { grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .hp .hp-band[data-cols='4'] { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
.hp .hp-band > * { border-color: var(--hp-rule); border-style: solid; border-width: 0 1px 1px 0; }
.hp .hp-cell-tick { position: absolute; left: 0; top: 12px; bottom: 12px; width: 3px; border-radius: 0 2px 2px 0; background: var(--tone, var(--hp-accent-ink)); }

/* Aging progress */
.hp .hp-age { position: relative; height: 5px; border-radius: 999px; background: var(--hp-neutral-bg); overflow: hidden; }
.hp .hp-age > span { position: absolute; inset: 0 auto 0 0; border-radius: 999px; background: var(--tone); }

/* Executive Register Table */
.hp .hp-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px; }
.hp .hp-table thead th {
  position: sticky; top: 0; z-index: 1; background: var(--hp-sunken); color: var(--hp-muted);
  font-size: 11.5px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; text-align: left;
  padding: 10px 12px; border-bottom: 1px solid var(--hp-rule); white-space: nowrap;
}
.hp .hp-table tbody td { padding: 10px 12px; border-bottom: 1px solid var(--hp-rule); vertical-align: middle; }
.hp .hp-table-dense thead th, .hp .hp-table-dense tbody td { padding-left: 8px; padding-right: 8px; }
.hp .hp-noscrollbar { scrollbar-width: none; }
.hp .hp-noscrollbar::-webkit-scrollbar { display: none; }
.hp .hp-table tbody tr { transition: background-color 100ms ease; }
.hp .hp-table tbody tr[data-clickable='true'] { cursor: pointer; }
.hp .hp-table tbody tr[data-clickable='true']:hover { background: rgba(var(--dashboard-primary-rgb), 0.03); }
.hp .hp-scroll { overflow-x: auto; overflow-y: visible; overscroll-behavior: auto; -webkit-overflow-scrolling: touch; }
.hp .hp-scroll::-webkit-scrollbar { height: 6px; width: 6px; }
.hp .hp-scroll::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 6px; }

/* Lifecycle rail */
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
  width: 26px; height: 26px; border-radius: 999px; background: var(--hp-surface);
  border: 1.5px solid var(--tone-line); color: var(--tone); font-size: 11px;
}
.hp .hp-rail-step[data-state='done'] .hp-rail-node { background: var(--tone); border-color: var(--tone); color: #ffffff; }
.hp .hp-rail-step[data-state='skip'] .hp-rail-node { border-style: dashed; }

/* Drawer motion */
@keyframes hp-sheet-in { from { transform: translateX(20px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes hp-fade-in { from { opacity: 0; } to { opacity: 1; } }
.hp-sheet[data-state='open'] { animation: hp-sheet-in 200ms cubic-bezier(0.16, 1, 0.3, 1); }
.hp-overlay[data-state='open'] { animation: hp-fade-in 140ms ease-out; }
@keyframes hp-rise { from { transform: translateY(4px); opacity: 0; } to { transform: none; opacity: 1; } }
.hp .hp-rise { animation: hp-rise 200ms cubic-bezier(0.16, 1, 0.3, 1) both; }
@media (prefers-reduced-motion: reduce) {
  .hp-sheet[data-state='open'], .hp-overlay[data-state='open'], .hp .hp-rise { animation: none; }
  .hp .hp-table tbody tr { transition: none; }
}

/* Standard Buttons */
.hp .hp-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.35rem; white-space: nowrap;
  height: 34px; padding: 0 12px; border-radius: 6px; border: 1px solid transparent;
  font-size: 12.5px; font-weight: 500; line-height: 1; cursor: pointer;
  transition: background-color 100ms ease, border-color 100ms ease, color 100ms ease;
}
.hp .hp-btn svg { width: 14px; height: 14px; flex-shrink: 0; }
.hp .hp-btn[data-size='sm'] { height: 28px; padding: 0 9px; font-size: 11.5px; }
.hp .hp-btn[data-size='lg'] { height: 38px; padding: 0 16px; font-size: 13.5px; }
.hp .hp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.hp .hp-btn[data-variant='accent'] { background: var(--hp-accent-fill); color: #ffffff; }
.hp .hp-btn[data-variant='approve'] { background: var(--hp-approve-solid); color: #ffffff; }
.hp .hp-btn[data-variant='reject'] { background: var(--hp-reject-solid); color: #ffffff; }
.hp .hp-btn[data-variant='outline'] { background: var(--hp-surface); color: var(--hp-ink); border-color: var(--hp-rule); }
.hp .hp-btn[data-variant='soft'] { background: var(--hp-accent-wash); color: var(--hp-accent-ink); }
.hp .hp-btn[data-variant='ghost'] { background: transparent; color: var(--hp-muted); }
.hp .hp-btn:not(:disabled):hover { filter: brightness(0.96); }
.hp .hp-btn[data-variant='outline']:not(:disabled):hover,
.hp .hp-btn[data-variant='ghost']:not(:disabled):hover { filter: none; background: var(--hp-sunken); color: var(--hp-ink); }
@media (prefers-reduced-motion: reduce) { .hp .hp-btn { transition: none; } }

/* File tiles */
.hp .hp-file-tile { border: 1px dashed var(--hp-neutral-line); background: var(--hp-sunken); border-radius: 6px; }
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
