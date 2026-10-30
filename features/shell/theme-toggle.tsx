'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { parseTheme, resolveTheme, THEME_STORAGE_KEY, type Theme } from '@/lib/theme';

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
}

// Przeglądarka może zablokować dostęp do localStorage (tryb prywatny, wyłączone
// dane witryn), a wtedy samo czytanie rzuca wyjątkiem.
function readStoredTheme(): Theme | null {
  try {
    return parseTheme(localStorage.getItem(THEME_STORAGE_KEY));
  } catch { return null; }
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  // Preferencję czytamy tutaj, a nie z klasy `dark` ustawionej przez skrypt
  // inline w layout.tsx. Produkcyjna CSP (`default-src 'self'`, bez
  // The external pre-paint script and this hydrated fallback both read the
  // same storage key, so the saved preference survives strict CSP.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const resolved = resolveTheme(
        readStoredTheme(),
        window.matchMedia('(prefers-color-scheme: dark)').matches,
      );
      applyTheme(resolved);
      setTheme(resolved);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  function toggleTheme() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* wybór zostaje na czas tej wizyty */ }
    setTheme(next);
  }

  const dark = theme === 'dark';
  return <Button aria-label={dark ? 'Use light theme' : 'Use dark theme'} onClick={toggleTheme} size="icon" title={dark ? 'Light theme' : 'Dark theme'} variant="ghost">{dark ? <Sun /> : <Moon />}</Button>;
}
