import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Dark mode is currently an allowlist of literal Tailwind class names in
// `app/globals.css`, rather than a semantic-token system. A class outside the
// list keeps its light-mode value under `.dark`; that is how `bg-white/60`
// shipped as a light member row with white text. This test provides the missing
// feedback loop until the interface is migrated to semantic color tokens.

const CSS = 'app/globals.css';
const SCAN_ROOTS = ['app', 'components'];

// This view is intentionally dark in both themes and owns its contrast rules.
const DARK_NATIVE = ['app/showcase/page.tsx'];

// A white veil below this threshold remains subtle on a dark background.
const SHEER_WHITE_MAX = 20;

// Above this luminance, an unmapped background becomes a bright surface.
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
const DARK_RULE = /\.dark\s*\[class~="([^"]+)"\]/g;

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

function allowlist(): Set<string> {
  const css = readFileSync(CSS, 'utf8');
  const tokens = new Set<string>();
  for (const match of css.matchAll(DARK_RULE)) tokens.add(match[1]);
  return tokens;
}

function contrast(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  const [high, low] = first > second ? [first, second] : [second, first];
  return (high + 0.05) / (low + 0.05);
}

// A light surface becomes a bright patch when it is not mapped in dark mode.
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
  const registered = allowlist();
  const findings: string[] = [];
  for (const file of sourceFiles()) {
    readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      for (const match of line.matchAll(CLASS_TOKEN)) {
        const token = match[1];
        if (registered.has(token)) continue;
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
  it('leaves no light surface or dark text outside the allowlist', () => {
    const findings = scan();
    expect(
      findings,
      `Add these classes to the matching .dark group in ${CSS}:\n${findings.join('\n')}`,
    ).toEqual([]);
  });

  // `[class~=]` matches whole tokens, so a rule for `bg-white` does not cover
  // `bg-white/60`. Keep the complete regression set registered.
  it('recognizes and registers every light surface from this regression', () => {
    const registered = allowlist();
    for (const token of ['bg-white/60', 'bg-[#dff0eb]', 'bg-[#e3e7e2]', 'bg-[#e4f2ee]', 'bg-[#f6ede7]']) {
      expect(lightSurface(token), `${token} must be recognized as light`).not.toBeNull();
      expect(registered.has(token), `${token} must be in the allowlist`).toBe(true);
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
