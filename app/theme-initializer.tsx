'use client'

import { useServerInsertedHTML } from 'next/navigation'

const themeInitScript = `
  try {
    const storedTheme = window.localStorage.getItem('dashboard-theme');
    const storedAccent = window.localStorage.getItem('dashboard-accent') || 'executive-navy';
    const legacyAccents = ['navy', 'indigo', 'blue', 'violet', 'ruby', 'minimal-slate', 'minimal-sage', 'minimal-sand'];
    const accent = legacyAccents.includes(storedAccent) ? 'executive-navy' : storedAccent;
    const migrationKey = 'dashboard-midnight-theme-decoupled';
    const shouldResetOldMidnightDark = accent === 'midnight' && storedTheme === 'dark' && window.localStorage.getItem(migrationKey) !== '1';
    const theme = shouldResetOldMidnightDark ? 'light' : storedTheme;
    if (shouldResetOldMidnightDark) {
      window.localStorage.setItem('dashboard-theme', 'light');
      window.localStorage.setItem(migrationKey, '1');
    }
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.setAttribute('data-dashboard-accent', accent);
  } catch (_) {}
`

export function ThemeInitializer() {
  useServerInsertedHTML(() => {
    return (
      <script
        id="theme-init"
        dangerouslySetInnerHTML={{ __html: themeInitScript }}
      />
    )
  })

  return null
}
