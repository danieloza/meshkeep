'use client';

import { useEffect, useRef } from 'react';
import type { Figure, HairlineOptions } from '@lucasmarkes/hairline';
import { cn } from '@/lib/utils';

export type FigureMount = (el: HTMLElement, options?: HairlineOptions) => Figure;

// An isometric line figure from Hairline that answers the pointer. Every one
// here sits beside a heading that already says what the screen is, so it is
// decoration: hidden from assistive technology and kept out of the tab order
// (Riffle would otherwise add a tab stop and a live region). It never plays
// on its own, so nothing moves until the pointer is over it.
//
// The plain functions are imported rather than the package's React
// components, because the components module creates all thirty-three at load
// and the bundle would carry every figure.
export function LineFigure({ figure, className }: { figure: FigureMount; className?: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current) return;
    const drawn = figure(host.current);
    return () => drawn.destroy();
  }, [figure]);

  // The box keeps the figure's 5:4 shape before it draws, so nothing shifts.
  return <div aria-hidden className={cn('aspect-[5/4]', className)} ref={host} tabIndex={-1} />;
}
