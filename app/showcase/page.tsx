import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  Braces,
  Check,
  Cloud,
  FileLock2,
  FolderKanban,
  KeyRound,
  MessageSquareText,
  ShieldCheck,
  Users,
} from 'lucide-react';

export const metadata: Metadata = {
  title: 'MeshKeep — Product showcase',
  description: 'A provider-free tour of the private AI workspace for small teams.',
};

const features = [
  {
    icon: FolderKanban,
    title: 'Projects stay scoped',
    copy: 'Keep work private, share it with selected collaborators, or open it to your four-person team.',
  },
  {
    icon: MessageSquareText,
    title: 'Context is explicit',
    copy: 'Only the project files selected for a message enter the model context. Nothing is mounted silently.',
  },
  {
    icon: KeyRound,
    title: 'Bring your provider',
    copy: 'Connect an OpenAI-compatible endpoint. Credentials are encrypted before they are stored in D1.',
  },
  {
    icon: ShieldCheck,
    title: 'Server-side boundaries',
    copy: 'Ownership, roles, quotas, uploads, sync actions, and provider destinations are enforced on the server.',
  },
];

const checks = [
  'Owner, editor, and reader permissions',
  'Daily and monthly usage limits',
  'Revocable Windows folder-sync agent',
  'PDF and Office document extraction',
  'Secret-free backups and audit history',
];

export default function ShowcasePage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#071512] text-[#edf8f4]">
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 opacity-70" style={{ background: 'radial-gradient(circle at 20% 5%, rgba(55,166,145,.24), transparent 34%), radial-gradient(circle at 86% 22%, rgba(80,111,255,.15), transparent 28%)' }} />

      <nav className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-6 lg:px-8">
        <Link className="flex items-center gap-3 font-semibold tracking-tight" href="/showcase">
          <span className="grid size-10 place-items-center rounded-2xl bg-[#41a390] text-[#061310]"><Braces className="size-5" /></span>
          MeshKeep
        </Link>
        <Link className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/75 transition hover:border-white/30 hover:text-white" href="/">Open workspace</Link>
      </nav>

      <section className="relative mx-auto grid max-w-6xl gap-14 px-6 pb-24 pt-16 lg:grid-cols-[1.04fr_.96fr] lg:items-center lg:px-8 lg:pt-24">
        <div>
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#55b9a6]/25 bg-[#2b7669]/15 px-3 py-1.5 text-xs font-medium text-[#83d3c4]">
            <FileLock2 className="size-3.5" /> Local-first decisions, cloud collaboration
          </div>
          <h1 className="max-w-3xl text-5xl font-semibold leading-[1.02] tracking-[-0.045em] sm:text-6xl lg:text-7xl">
            Shared AI work without shared exposure.
          </h1>
          <p className="mt-7 max-w-xl text-lg leading-8 text-[#a9bbb6]">
            MeshKeep gives a small trusted team one place for projects, conversations, files, and model access while keeping every boundary visible.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link className="inline-flex items-center gap-2 rounded-full bg-[#4bb09c] px-5 py-3 text-sm font-semibold text-[#061310] transition hover:bg-[#65c5b2]" href="/">
              Try the workspace <ArrowRight className="size-4" />
            </Link>
            <a className="rounded-full border border-white/15 px-5 py-3 text-sm font-medium text-white/80 transition hover:border-white/30 hover:text-white" href="#architecture">Explore the architecture</a>
          </div>
        </div>

        <div className="relative rounded-[2rem] border border-white/10 bg-[#0b211c]/85 p-4 shadow-2xl shadow-black/40 backdrop-blur">
          <div className="rounded-[1.4rem] border border-white/8 bg-[#0d1c19] p-5">
            <div className="flex items-center justify-between border-b border-white/8 pb-4">
              <div>
                <p className="text-sm font-semibold">Research launch</p>
                <p className="mt-1 text-xs text-white/40">Private project · 3 collaborators</p>
              </div>
              <div className="flex -space-x-2">
                {['DO', 'AK', 'MS'].map((name) => <span className="grid size-8 place-items-center rounded-full border-2 border-[#0d1c19] bg-[#234d45] text-[10px] font-bold" key={name}>{name}</span>)}
              </div>
            </div>
            <div className="grid gap-3 py-5 sm:grid-cols-2">
              <div className="rounded-2xl bg-[#14332c] p-4"><Cloud className="size-5 text-[#66c6b3]" /><p className="mt-8 text-xs text-white/45">Project files</p><p className="mt-1 text-2xl font-semibold">18</p></div>
              <div className="rounded-2xl bg-[#152b37] p-4"><MessageSquareText className="size-5 text-[#74a8c5]" /><p className="mt-8 text-xs text-white/45">Conversations</p><p className="mt-1 text-2xl font-semibold">6</p></div>
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/[0.035] p-4">
              <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-[#3d8f80]/25"><KeyRound className="size-4 text-[#73ccbb]" /></span><div><p className="text-sm font-medium">Personal model provider</p><p className="text-xs text-white/40">Encrypted · ready</p></div></div>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/8"><div className="h-full w-[42%] rounded-full bg-[#4daf9c]" /></div>
              <p className="mt-2 text-[11px] text-white/35">42% of monthly allowance used</p>
            </div>
          </div>
        </div>
      </section>

      <section className="relative border-y border-white/8 bg-white/[0.025]" id="architecture">
        <div className="mx-auto max-w-6xl px-6 py-24 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold text-[#68c7b5]">Designed around boundaries</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Privacy is part of the data flow.</h2>
            <p className="mt-4 leading-7 text-[#9cafaa]">The interface explains what crosses each boundary, and the server independently enforces it.</p>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-2">
            {features.map(({ icon: Icon, title, copy }) => (
              <article className="rounded-3xl border border-white/8 bg-[#0a1b17] p-6" key={title}>
                <span className="grid size-11 place-items-center rounded-2xl bg-[#173c34] text-[#72cbbb]"><Icon className="size-5" /></span>
                <h3 className="mt-8 text-lg font-semibold">{title}</h3>
                <p className="mt-2 max-w-md text-sm leading-6 text-[#96aaa4]">{copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="relative mx-auto grid max-w-6xl gap-10 px-6 py-24 lg:grid-cols-2 lg:items-center lg:px-8">
        <div>
          <div className="flex items-center gap-3 text-[#67c2b1]"><Users className="size-5" /><span className="text-sm font-semibold">Built for a trusted four-person cloud</span></div>
          <h2 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">Enough structure to collaborate. Small enough to understand.</h2>
        </div>
        <ul className="space-y-3">
          {checks.map((item) => <li className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white/75" key={item}><span className="grid size-6 place-items-center rounded-full bg-[#2b7669]/35 text-[#7cd0c0]"><Check className="size-3.5" /></span>{item}</li>)}
        </ul>
      </section>

      <footer className="relative border-t border-white/8 px-6 py-8 text-center text-xs text-white/35">
        MeshKeep · MIT licensed · Provider-free showcase
      </footer>
    </main>
  );
}
