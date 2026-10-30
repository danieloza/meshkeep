import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Colors that change between the themes are semantic tokens: `app/globals.css`
// defines each one in `:root` and again in `.dark`, and components use the
// token's class (`bg-surface-raised`, `text-ink-muted`) instead of a literal
// color. A literal light color in a component keeps its light value under
// `.dark`; that is how `bg-white/60` once shipped as a light member row with
// white text. This test is the feedback loop for that.

const CSS = 'app/globals.css';
const SCAN_ROOTS = ['app', 'components', 'features'];

// This view is intentionally dark in both themes and owns its contrast rules.
const DARK_NATIVE = ['app/showcase/page.tsx'];

// A white veil below this threshold remains subtle on a dark background.
const SHEER_WHITE_MAX = 20;

// Above this luminance, an unthemed background becomes a bright surface.
const LIGHT_SURFACE_MIN = 0.5;

// Evaluate text by contrast against the common `--card` surface, not by raw
// luminance. The threshold is WCAG AA for normal text.
const DARK_CARD = '14211e';
const AA_NORMAL = 4.5;

// Intentionally dark text placed on a light surface in both themes.
const INTENTIONALLY_DARK_TEXT = new Set([
  // Sidebar logo text sits on a cyan-to-emerald gradient.
  'text-[#102724]',
]);

const LIGHT_HEX_BG = /^bg-\[#([0-9a-f]{6})\]$/i;
const DARK_HEX_TEXT = /^text-\[#([0-9a-f]{6})\]$/i;
const WHITE_BG = /^bg-white(?:\/(\d+))?$/;
const LIGHT_PALETTE_BG = /^bg-(?!white|black)[a-z]+-(?:50|100)(?:\/\d+)?$/;
const DARK_PALETTE_TEXT = /^text-(?!white|black)[a-z]+-(?:600|700|800|900)(?:\/\d+)?$/;
const CLASS_TOKEN = /(?:^|[\s"'`])((?:bg|text)-[^\s"'`]+)/g;

function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      // Use forward slashes so exclusions behave the same on Windows and CI.
      const path = `${dir}/${entry}`;
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith('.tsx')) found.push(path);
    }
  };
  for (const root of SCAN_ROOTS) walk(root);
  return found.filter((path) => !DARK_NATIVE.includes(path));
}

function luminance(hex: string): number {
  const value = Number.parseInt(hex, 16);
  const channel = (raw: number) => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((value >> 16) & 255)
    + 0.7152 * channel((value >> 8) & 255)
    + 0.0722 * channel(value & 255);
}

function contrast(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  const [high, low] = first > second ? [first, second] : [second, first];
  return (high + 0.05) / (low + 0.05);
}

// Custom properties declared directly in a top-level block such as `:root`.
function declarations(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf('\n}', start));
  return new Map([...body.matchAll(/^\s*--([\w-]+):\s*([^;]+);/gm)].map((m) => [m[1], m[2].trim()]));
}

// A light surface becomes a bright patch when it is not themed.
export function lightSurface(token: string): string | null {
  const hex = token.match(LIGHT_HEX_BG);
  if (hex && luminance(hex[1]) > LIGHT_SURFACE_MIN) return 'light literal color';
  const white = token.match(WHITE_BG);
  if (white) {
    const alpha = white[1] === undefined ? 100 : Number(white[1]);
    if (alpha >= SHEER_WHITE_MAX) return `bg-white at ${alpha}% opacity`;
  }
  if (LIGHT_PALETTE_BG.test(token)) return 'light palette shade';
  return null;
}

// Dark text disappears on the common dark card surface.
export function darkText(token: string): string | null {
  if (INTENTIONALLY_DARK_TEXT.has(token)) return null;
  const hex = token.match(DARK_HEX_TEXT);
  if (hex && contrast(hex[1], DARK_CARD) < AA_NORMAL) return 'unreadable on a dark card';
  if (DARK_PALETTE_TEXT.test(token)) return 'dark palette shade';
  return null;
}

function scan(): string[] {
  const findings: string[] = [];
  for (const file of sourceFiles()) {
    readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      for (const match of line.matchAll(CLASS_TOKEN)) {
        const token = match[1];
        const why = lightSurface(token) ?? darkText(token);
        if (!why) continue;
        // An explicit `dark:` variant for the same property handles the token.
        // This line-based heuristic intentionally prefers avoiding false positives.
        if (line.includes(token.startsWith('bg-') ? 'dark:bg-' : 'dark:text-')) continue;
        findings.push(`${token} (${why}) — ${file}:${index + 1}`);
      }
    });
  }
  return [...new Set(findings)].sort();
}

describe('dark-theme coverage', () => {
  it('uses no literal light surface or dark text in a component', () => {
    const findings = scan();
    expect(
      findings,
      `Use a semantic color from ${CSS} (or add one to :root and .dark) instead of:\n${findings.join('\n')}`,
    ).toEqual([]);
  });

  it('defines every semantic color in both themes and exposes it to Tailwind', () => {
    const css = readFileSync(CSS, 'utf8');
    const light = declarations(css, ':root');
    const dark = declarations(css, '.dark');
    const theme = declarations(css, '@theme inline');
    const exposed = [...theme].filter(([name, value]) => name.startsWith('color-') && value === `var(--${name.slice(6)})`).map(([name]) => name.slice(6));

    expect(exposed.length, 'the theme exposes semantic colors').toBeGreaterThan(30);
    for (const name of exposed) {
      expect(light.has(name), `--${name} in :root`).toBe(true);
      expect(dark.has(name), `--${name} in .dark`).toBe(true);
    }
  });

  // The `[class~="…"]` allowlist matched whole tokens only, so `hover:bg-white`
  // and `bg-red-50/70` slipped through it. Tokens replaced it; it must not
  // come back.
  it('keeps no per-class dark overrides', () => {
    expect(readFileSync(CSS, 'utf8')).not.toMatch(/\.dark\s*\[class~=/);
  });

  it('recognizes every light surface from the bg-white/60 regression', () => {
    for (const token of ['bg-white/60', 'bg-[#dff0eb]', 'bg-[#e3e7e2]', 'bg-[#e4f2ee]', 'bg-[#f6ede7]']) {
      expect(lightSurface(token), `${token} must be recognized as light`).not.toBeNull();
    }
  });

  it('ignores translucent veils and dark backgrounds', () => {
    for (const token of ['bg-white/10', 'bg-white/6', 'bg-black/35', 'bg-[#0d1e1a]', 'bg-[#23534c]']) {
      expect(lightSurface(token), token).toBeNull();
    }
  });

  // `text-[#9aa5a2]` has low luminance but 6.5:1 contrast on `--card`.
  it('does not report light text with sufficient dark-surface contrast', () => {
    for (const token of ['text-white', 'text-white/45', 'text-[#edf8f4]', 'text-[#9aa5a2]', 'text-emerald-100/50']) {
      expect(darkText(token), token).toBeNull();
    }
  });

  it('reports text that becomes unreadable on a dark card', () => {
    for (const token of ['text-[#32665d]', 'text-[#354a46]', 'text-emerald-700']) {
      expect(darkText(token), token).not.toBeNull();
    }
  });
});
