// How files join a chat message. In `manual` only the files the member picks
// are sent. In `auto` the files search suggests for the question are added
// too, shown in the composer before sending, and any of them can be left out.
export type ContextMode = 'manual' | 'auto';

export const CONTEXT_MODE_STORAGE_KEY = 'meshkeep-context-mode';

export function parseContextMode(value: unknown): ContextMode | null {
  return value === 'manual' || value === 'auto' ? value : null;
}

// The suggested files that join the message on their own: not already picked,
// not left out by the member, and only as many as the message has room for.
export function autoAttachments(suggested: string[], selected: string[], dismissed: string[], max: number): string[] {
  const room = Math.max(0, max - selected.length);
  return suggested.filter((id) => !selected.includes(id) && !dismissed.includes(id)).slice(0, room);
}
