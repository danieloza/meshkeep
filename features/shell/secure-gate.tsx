import Link from 'next/link';
import { LockKeyhole, Loader2 } from 'lucide-react';
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

export type AuthMode = 'sites' | 'standalone';

export function SecureGate({ title, authRequired = false, authMode = 'standalone' }: { title: string; authRequired?: boolean; authMode?: AuthMode }) {
  const ownerHint = authMode === 'sites' ? 'The owner can reconnect with their ChatGPT account.' : 'The owner signs in with the setup key.';
  const ownerHref = authMode === 'sites' ? '/signin-with-chatgpt?return_to=%2F' : '/setup';
  return <main className="grid min-h-screen place-items-center bg-surface p-5 text-ink"><Card className="w-full max-w-md border-0 bg-surface-raised/90 text-center shadow-xl ring-line"><CardHeader><span className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-surface-selected text-brand-text">{authRequired ? <LockKeyhole /> : <Loader2 className="animate-spin" />}</span><CardTitle>{title}</CardTitle><CardDescription>{authRequired ? `Ask the owner for a one-time link. ${ownerHint}` : 'Checking your session and project access.'}</CardDescription></CardHeader>{authRequired && <CardFooter className="justify-center"><Link className="inline-flex h-8 items-center justify-center rounded-lg bg-brand px-3 text-sm font-medium text-brand-ink transition hover:bg-brand-hover" href={ownerHref}>I am the owner</Link></CardFooter>}</Card></main>;
}
