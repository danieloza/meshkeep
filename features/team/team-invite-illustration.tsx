'use client';

// The picture beside the invite form: a panel where an address is typed in, a
// cursor clicks Invite and a new row appears. It loops while it is on screen,
// pauses off screen, and stays still for prefers-reduced-motion. Decorative:
// the form beside it says what it means.
//
// The illustration itself is from Illos and is not MIT; see
// `team-invite-svg.ts` for its license. This component is MIT, like the rest.

import { useEffect, useRef, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { TEAM_INVITE_SVG } from './team-invite-svg';

// Its colours come from the theme tokens, so it follows light and dark. The
// one colour of its own, the accent, is the brand text colour here.
const COLOURS = [
  '[--illos-accent:var(--brand-text)]',
  '[--illos-ground:var(--surface-raised)]',
  '[--illos-ink:var(--ink)]',
  '[--illos-if-raised:var(--surface-raised)]',
  '[--illos-if-surface:color-mix(in_oklab,var(--surface)_70%,var(--surface-raised))]',
  '[--illos-if-line:var(--line-strong)]',
  '[--illos-if-muted:var(--ink-subtle)]',
  '[--illos-if-bar:color-mix(in_oklab,var(--ink)_8%,var(--surface-raised))]',
  '[--illos-if-cursor:var(--surface-raised)]',
  '[--illos-if-cursor-edge:var(--ink)]',
  'dark:[--illos-if-cursor:var(--ink)]',
  'dark:[--illos-if-cursor-edge:var(--surface)]',
].join(' ');

export function TeamInviteIllustration({ className }: { className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    // The animation loops on its own; this only pauses it while less than a
    // quarter of it is on screen.
    const observer = new IntersectionObserver(
      ([entry]) => element.style.setProperty('--illos-play', entry.isIntersecting ? 'running' : 'paused'),
      { threshold: 0.25 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      aria-hidden="true"
      className={cn(COLOURS, 'pointer-events-none select-none [&>svg]:h-auto [&>svg]:w-full [&>svg]:max-w-[640px]', className)}
      // A fixed string from this repository, never anything a person typed.
      dangerouslySetInnerHTML={{ __html: TEAM_INVITE_SVG }}
      ref={host}
      style={{ '--illos-play': 'paused' } as CSSProperties}
    />
  );
}
