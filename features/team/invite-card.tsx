'use client';

// Settings › Team for the owner: an address field that takes several at once,
// and the links that are waiting to be used.
//
// MeshKeep sends no email. Each address gets a one-time link that the owner
// copies and sends themselves. The server keeps only a hash of the token, so a
// link can be shown only right after it is made; later the owner makes a new
// one, and the old link stops working.

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type SubmitEvent } from 'react';
import { Check, Copy, Link2, Loader2, RefreshCw, TriangleAlert, X } from 'lucide-react';
import { api } from '@/lib/api-client';
import type { PendingInvite, TeamResponse } from '@/lib/contracts/team';
import { cn } from '@/lib/utils';
import { addAddresses, seatsFor } from './invite-addresses';
import { TeamInviteIllustration } from './team-invite-illustration';

type Waiting = PendingInvite & { kind: 'invite' | 'reconnect' };

// The well behind the illustration: two soft glows of the accent over the
// page surface, with a fine grain on top.
const WELL: CSSProperties = {
  backgroundImage: [
    `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 .2 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
    'radial-gradient(75% 65% at 12% 8%, color-mix(in oklab, var(--brand-text) var(--well-glow), transparent), transparent 72%)',
    'radial-gradient(60% 60% at 92% 96%, color-mix(in oklab, var(--brand-text) calc(var(--well-glow) * 0.6), transparent), transparent 70%)',
    'linear-gradient(160deg, color-mix(in oklab, var(--surface) 55%, var(--surface-raised)), var(--surface))',
  ].join(', '),
  boxShadow: 'inset 0 0 0 1px color-mix(in oklab, var(--ink) 6%, transparent)',
};

const expires = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export function InviteCard({ memberEmails, pendingInvites, reconnectLinks, capacity, onTeamChanged, onNotice }: {
  memberEmails: string[];
  pendingInvites: PendingInvite[];
  reconnectLinks: PendingInvite[];
  capacity: TeamResponse['capacity'];
  onTeamChanged: () => void;
  onNotice: (message: string) => void;
}) {
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  const [drafts, setDrafts] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [problem, setProblem] = useState('');
  const [sending, setSending] = useState(false);
  // Links made in this visit, by address. Nothing else can show them again.
  const [links, setLinks] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [renewing, setRenewing] = useState<string | null>(null);
  // Shown when the clipboard refused, so the link can still be copied by hand.
  const [shown, setShown] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const members = new Set(memberEmails);
  // Newest link first. Every link lasts the same seven days, so the one that
  // expires last is the one made last.
  const waiting: Waiting[] = [
    ...pendingInvites.map((invite) => ({ ...invite, kind: 'invite' as const })),
    ...reconnectLinks.map((link) => ({ ...link, kind: 'reconnect' as const })),
  ].toSorted((a, b) => b.expiresAt.localeCompare(a.expiresAt));
  const context = { members, waiting: new Set(waiting.map((item) => item.email)), freeSeats: Math.max(0, capacity.total - capacity.used) };

  function commit(raw: string) {
    const result = addAddresses(raw, drafts, context);
    setDrafts(result.addresses);
    setText(result.rest);
    setProblem(result.problem);
    return result;
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if ([',', ';', ' ', 'Enter'].includes(event.key) && text.trim()) {
      event.preventDefault();
      commit(text);
    } else if (event.key === 'Backspace' && !text && drafts.length) {
      setDrafts(drafts.slice(0, -1));
    }
  }

  async function makeLink(email: string) {
    const { invite } = await api.team.invite({ email });
    if (!invite.joinPath.startsWith('/join?token=')) throw new Error('The server returned an invalid invitation link.');
    return new URL(invite.joinPath, window.location.origin).toString();
  }

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    let list = drafts;
    if (text.trim()) {
      const result = commit(text);
      if (result.rest) { field.current?.focus(); return; }
      list = result.addresses;
    }
    if (!list.length) {
      setProblem('Add at least one email address.');
      field.current?.focus();
      return;
    }
    setSending(true);
    const made: Record<string, string> = {};
    let failure = '';
    // One at a time: the server counts seats per request.
    for (const email of list) {
      try { made[email] = await makeLink(email); }
      catch (error) { failure = `${email}: ${error instanceof Error ? error.message : 'Could not make a link.'}`; break; }
    }
    const done = Object.keys(made);
    setLinks((current) => ({ ...current, ...made }));
    setDrafts(list.filter((email) => !(email in made)));
    setProblem(failure);
    setSending(false);
    if (done.length) {
      onTeamChanged();
      setAnnounce(`${done.length} ${done.length === 1 ? 'link is' : 'links are'} ready to copy`);
    }
  }

  async function copy(email: string) {
    try {
      await navigator.clipboard.writeText(links[email]);
      setCopied(email);
      setShown(null);
      setAnnounce(`Link for ${email} copied`);
    } catch {
      setShown(email);
    }
  }

  async function renew(email: string) {
    setRenewing(email);
    try {
      const link = await makeLink(email);
      setLinks((current) => ({ ...current, [email]: link }));
      onTeamChanged();
      setAnnounce(`New link for ${email} is ready to copy`);
      onNotice('A new link is ready. The previous link for this address no longer works.');
    } catch (error) { onNotice(error instanceof Error ? error.message : 'Could not make a new link.'); }
    finally { setRenewing(null); }
  }

  async function revoke(item: Waiting) {
    try {
      await api.team.revokeInvite({ id: item.id });
      setLinks((current) => Object.fromEntries(Object.entries(current).filter(([email]) => email !== item.email)));
      onTeamChanged();
      setAnnounce(`Link for ${item.email} revoked`);
      onNotice(item.kind === 'invite' ? 'Link revoked. The seat is free again.' : 'Reconnect link revoked.');
    } catch (error) { onNotice(error instanceof Error ? error.message : 'Could not revoke the link.'); }
  }

  const seats = seatsFor(drafts, members);
  const count = drafts.length;
  return (
    <section aria-labelledby={`${id}-title`} className="@container">
      <div
        className={cn(
          '[--well-glow:28%] dark:[--well-glow:14%]',
          'grid overflow-hidden rounded-[20px] bg-surface-raised p-2 text-ink @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]',
          'shadow-[0_0_0_1px_var(--line),0_1px_2px_rgb(0_0_0/0.04),0_16px_40px_-16px_rgb(0_0_0/0.18)] dark:shadow-[0_0_0_1px_var(--line)]',
        )}
      >
        <div className="relative isolate aspect-[16/11] overflow-hidden rounded-xl @3xl:aspect-auto" style={WELL}>
          <TeamInviteIllustration className="absolute inset-0 grid place-items-center p-2 @3xl:p-0" />
        </div>

        <div className="flex min-w-0 flex-col gap-6 px-3 pt-6 pb-3 @sm:px-6 @3xl:px-8 @3xl:pt-8 @3xl:pb-6">
          <header className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold tracking-tight text-balance" id={`${id}-title`}>Invite your team</h2>
            <p className="max-w-[46ch] text-sm leading-relaxed text-pretty text-ink-muted">Each address gets a one-time link to this cloud. MeshKeep sends no email: copy each link and send it yourself.</p>
            <p className="flex items-center gap-3 pt-1">
              <span aria-hidden className="flex gap-1">
                {Array.from({ length: capacity.total }, (_, index) => <span className={cn('h-1 w-5 rounded-full', index < capacity.used ? 'bg-ink' : 'bg-line-strong')} key={index} />)}
              </span>
              <span className="text-xs text-ink-muted tabular-nums">{capacity.used} of {capacity.total} seats used or reserved</span>
            </p>
          </header>

          <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void onSubmit(event)}>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium" htmlFor={`${id}-email`}>Email addresses</label>
              {/* A click on the empty part of the box puts the cursor in the field. */}
              {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
              <div
                className={cn(
                  'flex min-h-11 cursor-text flex-wrap items-center gap-1.5 rounded-lg border bg-surface px-2 py-1.5 transition-[border-color,box-shadow] duration-150',
                  'focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/25',
                  problem ? 'border-danger-text' : 'border-line-strong',
                )}
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) {
                    event.preventDefault();
                    field.current?.focus();
                  }
                }}
              >
                {drafts.map((email) => (
                  <span className="inline-flex h-7 max-w-full items-center gap-1 rounded-md bg-surface-fill pr-1 pl-2 text-sm" key={email}>
                    <span className="truncate">{email}</span>
                    <button
                      aria-label={`Remove ${email}`}
                      className="relative grid size-5 place-items-center rounded text-ink-muted transition-colors duration-150 before:absolute before:-inset-1.5 hover:bg-surface-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-ring"
                      onClick={() => {
                        setDrafts(drafts.filter((draft) => draft !== email));
                        field.current?.focus();
                      }}
                      type="button"
                    >
                      <X aria-hidden className="size-3.5" />
                    </button>
                  </span>
                ))}
                <input
                  aria-describedby={`${id}-hint`}
                  aria-invalid={Boolean(problem)}
                  autoComplete="off"
                  className="h-7 min-w-[9rem] flex-1 bg-transparent px-1 text-base outline-none placeholder:text-ink-subtle md:text-sm"
                  id={`${id}-email`}
                  inputMode="email"
                  onBlur={() => { if (text.trim()) commit(text); }}
                  onChange={(event) => {
                    setText(event.target.value);
                    if (problem) setProblem('');
                  }}
                  onKeyDown={onKeyDown}
                  onPaste={(event) => {
                    const pasted = event.clipboardData.getData('text');
                    if (/[\s,;]/.test(pasted.trim())) {
                      event.preventDefault();
                      commit(`${text} ${pasted}`);
                    }
                  }}
                  placeholder={count ? 'Add another' : 'name@company.com'}
                  ref={field}
                  spellCheck={false}
                  type="text"
                  value={text}
                />
              </div>
              <p className={cn('flex items-start gap-1.5 text-xs text-pretty', problem ? 'text-danger-text' : 'text-ink-muted')} id={`${id}-hint`}>
                {problem && <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />}
                {problem || 'Press Enter or a comma after each address, or paste a list. A member’s own address gets a reconnect link and takes no seat.'}
              </p>
            </div>

            <button
              className="inline-flex h-9 items-center justify-center gap-2 self-start rounded-lg bg-brand px-4 text-sm font-medium text-brand-ink transition-[background-color,scale,opacity] duration-150 hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.97] disabled:opacity-70"
              disabled={sending}
              type="submit"
            >
              {sending
                ? <><Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />Making links</>
                : <><Link2 aria-hidden className="size-4" />{count > 1 ? `Make ${count} links` : 'Make link'}</>}
            </button>
            {count > 0 && seats > 0 && <p className="-mt-2 text-xs text-ink-subtle">{seats === 1 ? 'This reserves 1 seat' : `This reserves ${seats} seats`} until the link is used or revoked.</p>}
          </form>

          <section aria-labelledby={`${id}-waiting`} className="flex flex-col gap-2">
            <h3 className="flex items-center gap-2 text-sm font-medium" id={`${id}-waiting`}>
              Waiting to join
              <span className="rounded-full bg-surface-fill px-1.5 text-xs leading-5 font-medium text-ink-muted tabular-nums">{waiting.length}</span>
            </h3>
            {Object.keys(links).length > 0 && <p className="text-xs text-pretty text-ink-muted">Copy each link now. MeshKeep shows a link only once; after that, make a new one.</p>}
            {waiting.length
              ? <ul className="-mx-2 flex max-h-[15rem] flex-col overflow-y-auto">
                {waiting.map((item) => {
                  const link = links[item.email];
                  return (
                    <li className="flex flex-col rounded-lg px-2 py-2" key={item.id}>
                      <div className="flex items-center gap-3">
                        <span aria-hidden className={cn('grid size-8 shrink-0 place-items-center rounded-full text-xs font-medium uppercase text-ink-soft', item.kind === 'invite' ? 'bg-avatar-pending' : 'bg-avatar-reconnect')}>{item.email[0]}</span>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-sm">{item.email}</span>
                          <span className="text-xs text-ink-subtle">{item.kind === 'invite' ? 'Invite' : 'Reconnect link, no seat'} · <span className="whitespace-nowrap">expires {expires(item.expiresAt)}</span></span>
                        </span>
                        {link
                          ? <button
                            className="relative inline-flex h-8 min-w-[5.5rem] items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium text-brand-text transition-colors duration-150 before:absolute before:-inset-1.5 hover:bg-surface-fill focus-visible:outline-2 focus-visible:outline-ring"
                            onClick={() => void copy(item.email)}
                            type="button"
                          >
                            {copied === item.email ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
                            {copied === item.email ? 'Copied' : 'Copy link'}
                          </button>
                          : <button
                            className="relative inline-flex h-8 min-w-[5.5rem] items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium text-ink-muted transition-colors duration-150 before:absolute before:-inset-1.5 hover:bg-surface-fill hover:text-ink focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
                            disabled={renewing === item.email}
                            onClick={() => void renew(item.email)}
                            title="Make a new link. The previous one stops working."
                            type="button"
                          >
                            <RefreshCw aria-hidden className={cn('size-3.5', renewing === item.email && 'animate-spin motion-reduce:animate-none')} />
                            New link
                          </button>}
                        <button
                          aria-label={`Revoke the link for ${item.email}`}
                          className="relative grid size-8 place-items-center rounded-md text-ink-muted transition-colors duration-150 before:absolute before:-inset-1.5 hover:bg-surface-fill hover:text-ink focus-visible:outline-2 focus-visible:outline-ring"
                          onClick={() => void revoke(item)}
                          title={item.kind === 'invite' ? 'Revoke the link and free the seat' : 'Revoke the reconnect link'}
                          type="button"
                        >
                          <X aria-hidden className="size-4" />
                        </button>
                      </div>
                      {shown === item.email && link && <input
                        aria-label={`One-time link for ${item.email}`}
                        className="mt-2 ml-11 h-8 rounded-md border border-line bg-surface px-2 font-mono text-[11px]"
                        onFocus={(event) => event.currentTarget.select()}
                        readOnly
                        value={link}
                      />}
                    </li>
                  );
                })}
              </ul>
              : <p className="text-sm text-ink-muted">No one yet. Links you make wait here until someone joins with them.</p>}
          </section>
          <output aria-live="polite" className="sr-only">{announce}</output>
        </div>
      </div>
    </section>
  );
}
