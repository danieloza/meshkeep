'use client';

import { isValidElement, useState, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy } from 'lucide-react';

// Model answers are untrusted text. react-markdown renders no raw HTML, and the
// default URL filter drops `javascript:` links. Images are the remaining
// channel: a prompt hidden in a context file can ask the model to emit an image
// whose URL carries data out of the workspace. The CSP already blocks remote
// images; rendering them as plain text means the request is never attempted.

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const code = isValidElement<{ className?: string; children?: ReactNode }>(children) ? children : null;
  const language = /language-([\w+-]+)/.exec(code?.props.className ?? '')?.[1];
  const text = textOf(code ? code.props.children : children).replace(/\n$/, '');

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable; the text stays selectable */ }
  }

  return <div className="my-3 overflow-hidden rounded-xl bg-[#102724] text-white first:mt-0 last:mb-0">
    <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5 text-[10px] uppercase tracking-wider text-white/60">
      <span>{language ?? 'code'}</span>
      <button aria-label="Copy code" className="flex items-center gap-1 rounded px-1.5 py-0.5 normal-case tracking-normal transition hover:bg-white/10 hover:text-white" onClick={() => void copy()} type="button">{copied ? <Check className="size-3" /> : <Copy className="size-3" />}{copied ? 'Copied' : 'Copy'}</button>
    </div>
    <pre className="overflow-x-auto p-3 text-xs leading-5"><code>{text}</code></pre>
  </div>;
}

const components: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  code: ({ children }) => <code className="rounded bg-[#edf5f2] px-1 py-0.5 font-mono text-[0.85em] text-[#315f57]">{children}</code>,
  a: ({ children, href }) => <a className="text-[#2f6e63] underline underline-offset-2" href={href} rel="noopener noreferrer nofollow" target="_blank">{children}</a>,
  img: ({ alt }) => <span className="text-[#63706d]">[image{alt ? `: ${alt}` : ''}]</span>,
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 first:mt-0 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0">{children}</ol>,
  h1: ({ children }) => <h3 className="mb-2 mt-4 text-base font-semibold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-2 mt-4 text-base font-semibold first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-1.5 mt-3 font-semibold first:mt-0">{children}</h4>,
  blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-black/10 pl-3 text-[#5c6763]">{children}</blockquote>,
  hr: () => <hr className="my-4 border-black/8" />,
  table: ({ children }) => <div className="my-3 overflow-x-auto first:mt-0 last:mb-0"><table className="w-full border-collapse text-xs">{children}</table></div>,
  th: ({ children }) => <th className="border border-black/8 px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-black/8 px-2 py-1 align-top">{children}</td>,
};

export function ChatMarkdown({ content }: { content: string }) {
  return <div className="min-w-0 break-words">
    <Markdown components={components} remarkPlugins={[remarkGfm]}>{content}</Markdown>
  </div>;
}
