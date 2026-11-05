import type { ReactNode } from 'react';
import Link from 'next/link';
import { Loader2, LockKeyhole, UserX } from 'lucide-react';
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import type { LoadFailure } from './load-failure';

export type AuthMode = 'sites' | 'standalone';

// What stands in for the dashboard until it can show anything.
export type Gate = { kind: 'loading' } | Exclude<LoadFailure, { kind: 'error' }>;

const ACTION = 'inline-flex h-8 items-center justify-center rounded-lg bg-brand px-3 text-sm font-medium text-brand-ink transition hover:bg-brand-hover';

export function SecureGate({ gate, authMode = 'standalone' }: { gate: Gate; authMode?: AuthMode }) {
  const sites = authMode === 'sites';
  if (gate.kind === 'loading') {
    return <GateCard detail="Checking your session and project access." icon={<Loader2 className="animate-spin" />} title="Loading private cloud…" />;
  }
  if (gate.kind === 'signed-out') {
    const ownerHint = sites ? 'The owner can reconnect with their ChatGPT account.' : 'The owner signs in with the setup key.';
    return <GateCard
      action={<Link className={ACTION} href={sites ? '/signin-with-chatgpt?return_to=%2F' : '/setup'}>I am the owner</Link>}
      detail={`Ask the owner for a one-time link. ${ownerHint}`}
      icon={<LockKeyhole />}
      title="This workspace requires an invitation"
    />;
  }
  // Signed in, but not let in. On Sites the way forward may be another
  // ChatGPT account, so the screen offers to sign out of this one. The
  // platform answers that address, not a page of this app, and a prefetch by
  // <Link> would sign people out just for seeing the button.
  // oxlint-disable-next-line next/no-html-link-for-pages
  const switchAccount = <a className={ACTION} href="/signout-with-chatgpt?return_to=%2F">Use a different account</a>;
  return <GateCard
    action={sites ? switchAccount : undefined}
    detail={`${gate.reason} Ask the owner of this cloud for access${sites ? ', or sign in with the account they invited' : ''}.`}
    icon={<UserX />}
    title="This account has no access to this cloud"
  />;
}

function GateCard({ icon, title, detail, action }: { icon: ReactNode; title: string; detail: string; action?: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-surface p-5 text-ink">
      <Card className="w-full max-w-md border-0 bg-surface-raised/90 text-center shadow-xl ring-line">
        <CardHeader>
          <span className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-surface-selected text-brand-text">{icon}</span>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{detail}</CardDescription>
        </CardHeader>
        {action && <CardFooter className="justify-center">{action}</CardFooter>}
      </Card>
    </main>
  );
}
