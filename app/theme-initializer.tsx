'use client'

import { useServerInsertedHTML } from 'next/navigation'

const themeInitScript = `
  try {
    const storedTheme = window.localStorage.getItem('dashboard-theme');
    const storedAccent = window.localStorage.getItem('dashboard-accent') || 'executive-navy';
    const validAccents = ['executive-navy', 'tropical-teal'];
    const accent = validAccents.includes(storedAccent) ? storedAccent : 'executive-navy';
    document.documentElement.classList.toggle('dark', storedTheme === 'dark');
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
