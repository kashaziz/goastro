import { useEffect, useState } from 'react';

/** The goastro icon: "go" on a citron highlight (same drawing as the favicon). */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#D8ED9B" />
      <g fill="none" stroke="#18271E" strokeWidth="3.1" strokeLinecap="round">
        <circle cx="10.2" cy="14.6" r="4.6" />
        <path d="M14.8 10v10.4c0 3.6-2.4 5.6-5.3 5.6-1.9 0-3.4-.7-4.4-1.9" />
        <circle cx="22.4" cy="14.6" r="4.8" />
      </g>
    </svg>
  );
}

export function Wordmark({ onClick }: { onClick?: () => void }) {
  // The logo is the wordmark itself: "go" highlighted, like a marker on text.
  const inner = (
    <span className="wordmark">
      <span className="go">go</span>astro
    </span>
  );
  return onClick ? (
    <button type="button" className="brand" onClick={onClick} title="goastro home">
      {inner}
    </button>
  ) : (
    <span className="brand">{inner}</span>
  );
}

// ---------- theme ----------

type Theme = 'system' | 'light' | 'dark';
const KEY = 'goastro-theme';

function readTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

function applyTheme(t: Theme) {
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

applyTheme(readTheme()); // before the first paint

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    applyTheme(theme);
    try {
      if (theme === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, theme);
    } catch {
      // storage blocked: the choice lasts for this tab only
    }
  }, [theme]);
  const next: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
  const icon = { system: '◐', light: '☀', dark: '☾' }[theme];
  const label = { system: 'Theme: follows your system', light: 'Theme: light', dark: 'Theme: dark' }[theme];
  return (
    <button type="button" className="icon-btn" title={`${label}. Click to change.`} aria-label={label} onClick={() => setTheme(next[theme])}>
      {icon}
    </button>
  );
}

/** Show a home-relative path: /home/alice/work/x → ~/work/x */
export function shortPath(p: string, home: string | null): string {
  return home && (p === home || p.startsWith(home + '/')) ? '~' + p.slice(home.length) : p;
}
