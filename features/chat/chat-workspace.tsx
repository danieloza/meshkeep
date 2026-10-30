'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, FolderOpen, Loader2, MessageSquarePlus, PanelRight, Paperclip, Send, Trash2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChatMarkdown } from '@/components/chat-markdown';
import { api } from '@/lib/api-client';
import { type ContextFile, createLineSplitter, parseStreamEvent } from '@/lib/chat-stream';
import type { FileSuggestion, ProjectFile } from '@/lib/contracts/files';
import type { ProviderModel } from '@/lib/contracts/providers';
import { cn } from '@/lib/utils';
import { Hint } from '@/components/hint';
import { type Project, PROJECT_FILE_ACCEPT, visibilityBadgeClasses, visibilityLabels } from '@/features/projects/project';
import { formatBytes } from '@/lib/format';

const MAX_SELECTED_FILES = 8;

// Bounded rounds, so opening a project with many older files does not keep
// the browser busy; whatever is left is picked up the next time.
async function indexProjectFiles(projectId: string) {
  for (let round = 0; round < 5; round += 1) {
    const round = await api.projects.indexRound(projectId).catch(() => null);
    if (!round?.remaining) return;
  }
}

// `context` lists what the answer was built from; `pending` marks an answer
// that is still streaming in.
type ChatMessage = { role: 'user' | 'assistant'; content: string; context?: ContextFile[]; pending?: boolean; interrupted?: boolean };

const CONTEXT_STATUS: Record<ContextFile['status'], { label: string; className: string }> = {
  included: { label: '', className: 'bg-surface-selected text-brand-text' },
  truncated: { label: 'partial', className: 'bg-warn-soft text-warn-text' },
  unreadable: { label: 'not readable', className: 'bg-surface-fill text-ink-muted' },
  skipped: { label: 'over limit', className: 'bg-surface-fill text-ink-muted' },
};

// Shows, per answer, which selected files the model actually received. A file
// the model did not read in full says so, instead of looking like the rest.
function ContextChips({ files }: { files: ContextFile[] }) {
  if (!files.length) return null;
  return <div className="mt-1.5 flex max-w-[88%] flex-wrap gap-1.5" aria-label="Files used for this answer">
    {files.map((file) => {
      const status = CONTEXT_STATUS[file.status];
      return <span className={cn('flex max-w-[240px] items-center gap-1 rounded-full px-2.5 py-1 text-[10px]', status.className)} key={file.id} title={file.note ? `${file.path} — ${file.note}` : file.path}>
        <Paperclip className="size-3 shrink-0" /><span className="truncate">{file.path.split('/').pop()}</span>{status.label && <span className="shrink-0 font-medium">· {status.label}</span>}
      </span>;
    })}
  </div>;
}

// The open project, in the middle column, with its context in a column of its
// own: the files picked for the next message and the project instructions.
// The two columns are returned side by side, so the page grid places them and
// the state they share stays here. `conversationId` opens that conversation,
// `null` the latest one; `fresh` starts a new conversation instead.
export function ChatWorkspace({ project, models, onClose, onFileCountChange, onConversationChange, onConversationSaved, conversationId: openConversationId, fresh, initialFileIds }: { project: Project; models: ProviderModel[]; onClose: () => void; onFileCountChange: (count: number) => void; onConversationChange: (conversationId: string | undefined) => void; onConversationSaved: () => void; conversationId: string | null; fresh: boolean; initialFileIds: string[] }) {
  // Pusty stan oznacza „pierwszy z listy serwera” — dzięki temu nie trzeba
  // synchronizować wyboru efektem, gdy lista dojedzie później niż render.
  const [model, setModel] = useState('');
  const activeModel = model || models[0]?.id || '';
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([]);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>(initialFileIds);
  const [suggestions, setSuggestions] = useState<FileSuggestion[]>([]);
  const [uploading, setUploading] = useState(false);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [driveConfigured, setDriveConfigured] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(!fresh);
  const [conversationTitle, setConversationTitle] = useState('New conversation');
  // Below the widest layout the context column is a drawer.
  const [contextOpen, setContextOpen] = useState(false);
  const [contextTab, setContextTab] = useState<'files' | 'instructions'>('files');
  const [instructions, setInstructions] = useState('');
  const [instructionsDraft, setInstructionsDraft] = useState('');
  const [instructionsEditable, setInstructionsEditable] = useState(false);
  const [instructionsSaving, setInstructionsSaving] = useState(false);
  const chatFileInput = useRef<HTMLInputElement>(null);
  const chatFolderInput = useRef<HTMLInputElement>(null);
  // An answer can finish after another project or conversation was opened.
  // Its conversation then belongs to a chat that is gone, so it must not mark
  // the column or the address of the one on screen.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Wcześniej czat startował zawsze pusty, mimo że messages leżały w D1.
  // Wczytujemy ostatnią rozmowę projektu, żeby odświeżenie strony nie kasowało
  // historii z widoku.
  // Stan startowy `historyLoading` wystarcza, bo Dashboard montuje ten komponent
  // na nowo dla każdego projektu (prop `key`) — nie ma czego resetować w efekcie.
  useEffect(() => {
    if (fresh) return;
    let active = true;
    void (async () => {
      try {
        // Wskazana rozmowa ma pierwszenstwo; bez niej wracamy do najnowszej.
        let targetId = openConversationId;
        if (!targetId) {
          const list = await api.projects.conversations(project.id);
          if (!active) return;
          targetId = list.conversations[0]?.id ?? null;
        }
        if (!targetId || !active) return;
        const detail = await api.projects.conversation(project.id, targetId);
        if (!active) return;
        setConversationId(targetId);
        setConversationTitle(detail.conversation.title);
        onConversationChange(targetId);
        setChatMessages(detail.messages.flatMap((message) => message.role === 'system' ? [] : [{ role: message.role, content: message.content, context: message.contextFiles }]));
      } catch {
        // Czat zaczyna od pustej historii. Rozmowa wskazana wprost (z adresu,
        // listy albo wyszukiwania) mogla zniknac: mowimy to i oznaczamy nowa.
        if (active && openConversationId) {
          setError('That conversation is not available, so a new one is open.');
          onConversationChange(undefined);
        }
      }
      finally { if (active) setHistoryLoading(false); }
    })();
    return () => { active = false; };
    // Opening another conversation remounts this component (the parent's
    // `key`), so the callback is read once, when the conversation loads.
  }, [project.id, openConversationId, fresh]);

  useEffect(() => {
    let active = true;
    api.projects.files(project.id).then((payload) => { if (active) setProjectFiles(payload.files); }).catch(() => undefined);
    api.driveStatus().then((status) => { if (active) setDriveConfigured(status.configured); }).catch(() => undefined);
    return () => { active = false; };
  }, [project.id]);

  useEffect(() => {
    let active = true;
    api.projects.instructions(project.id)
      .then((payload) => {
        if (!active) return;
        setInstructions(payload.instructions);
        setInstructionsDraft(payload.instructions);
        setInstructionsEditable(payload.canEdit);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [project.id]);

  async function saveInstructions() {
    if (instructionsSaving) return;
    setInstructionsSaving(true); setError(null);
    try {
      const payload = await api.projects.updateInstructions(project.id, { instructions: instructionsDraft });
      setInstructions(payload.instructions);
      setInstructionsDraft(payload.instructions);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save the instructions.'); }
    finally { setInstructionsSaving(false); }
  }

  // Files uploaded before search existed, and documents that are extracted
  // after upload, become searchable when their project is opened.
  useEffect(() => { void indexProjectFiles(project.id); }, [project.id]);

  // Files that look relevant to the question being typed. They are only
  // offered: nothing joins the model context until the person picks it.
  useEffect(() => {
    const question = prompt.trim();
    if (question.length < 12) return;
    let active = true;
    const timer = setTimeout(() => {
      api.projects.suggestFiles(project.id, question.slice(0, 500))
        .then((payload) => { if (active) setSuggestions(payload.files); })
        .catch(() => undefined);
    }, 500);
    return () => { active = false; clearTimeout(timer); };
  }, [project.id, prompt]);
  const visibleSuggestions = prompt.trim().length >= 12 ? suggestions.filter((file) => !selectedFileIds.includes(file.fileId)) : [];

  async function uploadProjectFiles(selected: File[]) {
    if (!selected.length || uploading) return;
    setUploading(true); setError(null);
    try {
      const form = new FormData();
      selected.forEach((file) => form.append('files', file));
      form.append('paths', JSON.stringify(selected.map((file) => file.webkitRelativePath || file.name)));
      const { files } = await api.projects.upload(project.id, form);
      setProjectFiles((current) => [...files, ...current]);
      setSelectedFileIds((current) => [...new Set([...current, ...files.map((file) => file.id)])].slice(0, MAX_SELECTED_FILES));
      setContextTab('files');
      void indexProjectFiles(project.id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not add files.'); }
    finally { setUploading(false); }
  }

  // Kasowanie jest nieodwracalne — nie ma kosza ani wersjonowania — więc
  // potwierdzenie jest jedynym zabezpieczeniem przed pomyłkowym kliknięciem.
  async function deleteProjectFile(file: ProjectFile) {
    if (deletingFileId) return;
    if (!window.confirm(`Delete “${file.relativePath}” from the cloud? This cannot be undone.`)) return;
    setDeletingFileId(file.id); setError(null);
    try {
      await api.files.remove(file.id);
      const next = projectFiles.filter((item) => item.id !== file.id);
      setProjectFiles(next);
      // Zaznaczenie trzeba wyczyścić razem z plikiem, inaczej następna
      // message poleciałaby z identyfikatorem, którego już nie ma.
      setSelectedFileIds((current) => current.filter((id) => id !== file.id));
      onFileCountChange(next.length);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not delete the file.'); }
    finally { setDeletingFileId(null); }
  }

  // Serwer zaklada nowa rozmowe, gdy `conversationId` jest pusty. Wystarczy
  // wiec wyczyscic stan; niczego nie tworzymy z gory, zeby porzucone "nowe
  // rozmowy" nie zostawialy pustych wierszy w bazie.
  function startNewConversation() {
    setConversationId(undefined);
    setConversationTitle('New conversation');
    setChatMessages([]);
    setSelectedFileIds([]);
    setError(null);
    onConversationChange(undefined);
  }

  function toggleFile(fileId: string) {
    setSelectedFileIds((current) => current.includes(fileId)
      ? current.filter((id) => id !== fileId)
      : current.length < MAX_SELECTED_FILES ? [...current, fileId] : current);
  }

  async function sendMessage() {
    const content = prompt.trim();
    if ((!content && !selectedFileIds.length) || sending) return;
    const visibleContent = content || 'Analyze the selected project files.';
    const nextMessages = [...chatMessages, { role: 'user' as const, content: visibleContent }];
    setChatMessages(nextMessages); setPrompt(''); setSending(true); setError(null);
    // The answer is addressed by position, so a late chunk can only ever land
    // on the message it belongs to.
    const answerIndex = nextMessages.length;
    const updateAnswer = (change: (message: ChatMessage) => ChatMessage) =>
      setChatMessages((current) => current.map((message, index) => index === answerIndex ? change(message) : message));
    let streaming = false;
    try {
      const answer = await api.chat({ projectId: project.id, conversationId, model: activeModel, messages: nextMessages.slice(-20).map(({ role, content: text }) => ({ role, content: text })), attachmentIds: selectedFileIds, temperature: 0.4, maxTokens: 2048 });
      streaming = true;
      setChatMessages((current) => [...current, { role: 'assistant', content: '', pending: true }]);
      const reader = answer.getReader();
      const decoder = new TextDecoder();
      const lines = createLineSplitter();
      let finished = false;
      const apply = (line: string) => {
        const event = parseStreamEvent(line);
        if (!event) return;
        if (event.type === 'delta') {
          updateAnswer((message) => ({ ...message, content: message.content + event.text }));
        } else if (event.type === 'done') {
          finished = true;
          if (!conversationId) setConversationTitle(visibleContent.slice(0, 80));
          setConversationId(event.conversationId);
          if (mounted.current) {
            onConversationChange(event.conversationId);
            onConversationSaved();
          }
          updateAnswer((message) => ({ ...message, pending: false, context: event.context }));
          setSelectedFileIds([]);
        } else {
          finished = true;
          throw new Error(event.error);
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        lines.push(decoder.decode(value, { stream: true })).forEach(apply);
      }
      lines.flush().forEach(apply);
      if (!finished) throw new Error('The connection closed before the answer finished.');
    } catch (caught) {
      // The server saves an answer only when it completes, so a partial one is
      // marked as not saved rather than passed off as part of the history.
      if (streaming) updateAnswer((message) => ({ ...message, pending: false, interrupted: true }));
      setError(caught instanceof Error ? caught.message : 'Could not send the message.');
    }
    finally { setSending(false); }
  }

  const selectionFull = selectedFileIds.length >= MAX_SELECTED_FILES;

  return <>
    <section aria-labelledby="chat-title" className="flex h-[calc(100dvh-4rem)] min-w-0 flex-col">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3 sm:px-6">
        <div className="min-w-0 flex-1 basis-56">
          <p className="truncate text-xs text-ink-subtle">{project.name}</p>
          <h1 className="truncate text-lg font-semibold tracking-tight" id="chat-title">{historyLoading ? 'Loading conversation…' : conversationTitle}</h1>
        </div>
        <Badge className={cn('gap-1.5 border-transparent font-medium', visibilityBadgeClasses[project.visibility])} variant="outline"><span aria-hidden className="size-1.5 rounded-full bg-current" />{visibilityLabels[project.visibility]}</Badge>
        <label className="sr-only" htmlFor="chat-model">Model</label>
        <select className="h-9 max-w-[210px] rounded-lg border border-line-strong bg-surface-raised px-2 text-xs font-medium outline-none focus:ring-2 focus:ring-ring/30" disabled={!models.length} id="chat-model" onChange={(event) => setModel(event.target.value)} value={activeModel}>
          {models.length === 0 && <option value="">No models available</option>}
          {models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <Button disabled={historyLoading || !chatMessages.length} onClick={startNewConversation} size="sm" title="New conversation" variant="outline"><MessageSquarePlus /><span className="hidden sm:inline">New conversation</span></Button>
        <Button aria-expanded={contextOpen} aria-label="Show files and instructions" className="xl:hidden" onClick={() => setContextOpen(true)} size="icon" variant="ghost"><PanelRight /></Button>
        <Button aria-label="Close project" onClick={onClose} size="icon" variant="ghost"><X /></Button>
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        {chatMessages.length === 0 ? <div className="mx-auto grid h-full max-w-lg place-content-center text-center"><span className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-surface-selected text-brand-text"><Bot /></span><h2 className="text-xl font-semibold tracking-tight">What would you like to work on?</h2><p className="mt-2 text-sm leading-6 text-ink-muted">Ask about code, analyze a project or pick files under Files. The model receives this conversation, the project instructions and only the text files you select.</p></div> : <div className="mx-auto max-w-3xl space-y-5">{chatMessages.map((message, index) => message.role === 'user'
          ? <div className="flex justify-end" key={`${message.role}-${index}`}><div className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-surface-selected px-4 py-3 text-sm leading-6 text-ink">{message.content}</div></div>
          : <div className="flex flex-col items-start" key={`${message.role}-${index}`}>
            {message.content && <div className="max-w-[88%] rounded-2xl rounded-bl-md border border-line bg-surface-raised px-4 py-3 text-sm leading-6 text-ink shadow-sm"><ChatMarkdown content={message.content} /></div>}
            {message.interrupted && <p className="mt-1 text-[10px] text-warn-text">Interrupted · this partial answer was not saved</p>}
            {!message.pending && message.context && <ContextChips files={message.context} />}
          </div>)}{sending && !chatMessages.some((message) => message.pending && message.content) && <div className="flex items-center gap-2 text-sm text-ink-muted"><Loader2 className="size-4 animate-spin" /> Model is responding…</div>}</div>}
      </div>
      <footer className="px-4 pb-4 sm:px-8">
        {error && <p className="mx-auto mb-2 max-w-3xl rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger-text">{error}</p>}
        {selectedFileIds.length > 0 && <div aria-label="Files for the next message" className="mx-auto mb-2 flex max-w-3xl flex-wrap gap-1.5">{selectedFileIds.map((id) => { const file = projectFiles.find((item) => item.id === id); return file ? <button className="flex max-w-[220px] items-center gap-1 rounded-full bg-surface-selected px-2.5 py-1 text-[10px] text-brand-text" key={id} onClick={() => toggleFile(id)} title="Remove from message context" type="button"><Paperclip className="size-3" /><span className="truncate">{file.name}</span><X className="size-3" /></button> : null; })}</div>}
        <form className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-line-strong bg-surface-raised p-2 shadow-sm focus-within:border-ring" onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
          <textarea aria-label="Message to model" className="max-h-36 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-ink-subtle" maxLength={32_000} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder="Write a message…" rows={1} value={prompt} />
          <Button aria-label="Send message" className="size-9 rounded-xl bg-brand text-brand-ink" disabled={(!prompt.trim() && !selectedFileIds.length) || sending} size="icon" type="submit"><Send /></Button>
        </form>
        <p className="mt-2 text-center text-[10px] text-ink-subtle">Enter sends · Shift+Enter adds a new line · FREE models only</p>
      </footer>
    </section>

    {contextOpen && <button aria-label="Close files and instructions" className="fixed inset-0 z-40 bg-black/35 backdrop-blur-sm xl:hidden" onClick={() => setContextOpen(false)} type="button" />}
    <aside aria-label="Project context" className={cn('flex-col overflow-y-auto border-l border-line bg-surface-raised', contextOpen ? 'fixed inset-y-0 right-0 z-50 flex w-[min(340px,92vw)] shadow-2xl' : 'hidden', 'xl:static xl:z-auto xl:flex xl:h-[calc(100dvh-4rem)] xl:w-auto xl:shadow-none')}>
      <div className="sticky top-0 z-10 flex items-center gap-1 border-b border-line bg-surface-raised px-3 py-2">
        {([['files', 'Files'], ['instructions', 'Instructions']] as const).map(([tab, label]) => <button aria-pressed={contextTab === tab} className={cn('relative min-h-10 rounded-lg px-3 text-sm font-medium', contextTab === tab ? 'bg-surface-selected text-brand-text' : 'text-ink-muted hover:bg-surface-fill')} key={tab} onClick={() => setContextTab(tab)} type="button">{label}{tab === 'instructions' && instructions && <span className="absolute right-1.5 top-2 size-1.5 rounded-full bg-ok-text" title="Project instructions are on" />}</button>)}
        <span className="flex-1" />
        <Button aria-label="Close files and instructions" className="xl:hidden" onClick={() => setContextOpen(false)} size="icon-sm" variant="ghost"><X /></Button>
      </div>

      {contextTab === 'files' ? <div className="flex flex-col gap-4 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">For the next message<Hint side="left" text="Text and code are sent as they are. PDF, DOCX, XLSX, PPTX and RTF are converted to text on the server. Images and archives are stored, but no available model can read them, so they arrive as metadata only." /></h2>
          <span className="shrink-0 text-xs text-ink-subtle">{selectedFileIds.length} of {MAX_SELECTED_FILES}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={uploading} onClick={() => chatFileInput.current?.click()} size="sm" type="button" variant="outline"><Paperclip /> {uploading ? 'Adding…' : 'Add files'}</Button>
          <Button disabled={uploading} onClick={() => chatFolderInput.current?.click()} size="sm" type="button" variant="outline"><FolderOpen /> Import folder</Button>
        </div>
        <input ref={chatFileInput} accept={PROJECT_FILE_ACCEPT} className="sr-only" multiple onChange={(event) => { const selected = Array.from(event.target.files ?? []); void uploadProjectFiles(selected); event.target.value = ''; }} type="file" />
        <input ref={chatFolderInput} className="sr-only" multiple onChange={(event) => { const selected = Array.from(event.target.files ?? []); void uploadProjectFiles(selected); event.target.value = ''; }} type="file" {...{ webkitdirectory: '' }} />
        {projectFiles.length === 0
          ? <p className="text-xs leading-5 text-ink-muted">No files yet. Files you add are stored in this project’s private cloud.</p>
          : <ul className="-mx-2 flex flex-col gap-0.5">{projectFiles.map((file) => {
            const selected = selectedFileIds.includes(file.id);
            const image = file.mimeType.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name);
            return <li className={cn('flex items-start gap-1 rounded-lg pr-1', selected ? 'bg-surface-selected' : 'hover:bg-surface-fill')} key={file.id}>
              <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-start gap-2.5 p-2">
                <input checked={selected} className="mt-0.5 size-4 shrink-0 accent-brand" disabled={!selected && selectionFull} onChange={() => toggleFile(file.id)} type="checkbox" />
                <span className="min-w-0 flex-1"><span className="block break-all font-mono text-xs">{file.relativePath}</span><span className="text-xs text-ink-subtle">{formatBytes(file.sizeBytes)}{image ? ' · image, not read' : ''}</span></span>
              </label>
              <Button aria-label={`Delete ${file.relativePath} from cloud`} className="mt-2" disabled={deletingFileId === file.id} onClick={() => void deleteProjectFile(file)} size="icon-xs" title="Delete from cloud" variant="ghost"><Trash2 /></Button>
            </li>;
          })}</ul>}
        {visibleSuggestions.length > 0 && <div aria-label="Files suggested for this question" className="flex flex-col gap-2 rounded-xl bg-surface-fill p-3">
          <h2 className="text-[13px] font-semibold">Suggested for this question</h2>
          {visibleSuggestions.map((file) => <div className="flex items-center gap-2" key={file.fileId}><span className="min-w-0 flex-1 break-all font-mono text-xs">{file.path}</span><Button disabled={selectionFull} onClick={() => toggleFile(file.fileId)} size="sm" type="button" variant="outline">Add</Button></div>)}
        </div>}
        <p className="text-xs leading-5 text-ink-subtle">Stored in the project’s private cloud{driveConfigured ? ', with the Google Drive connector configured' : ''}. A local folder is copied, not permanently connected.</p>
      </div> : <div className="flex flex-col gap-3 p-4">
        <label className="text-[13px] font-semibold" htmlFor="project-instructions">Project instructions</label>
        <p className="text-xs leading-5 text-ink-muted">Sent to the model before every message in this project, ahead of any selected files. {instructionsEditable ? 'The owner and editors can change them.' : 'Only the owner and editors can change them.'}</p>
        <textarea className="min-h-48 w-full resize-y rounded-lg border border-line-strong bg-surface-raised p-2 text-xs leading-5 outline-none focus:ring-2 focus:ring-ring/30" id="project-instructions" maxLength={4000} onChange={(event) => setInstructionsDraft(event.target.value)} placeholder="For example: Answer in Polish. Prefer TypeScript examples. Name the file when you refer to code." readOnly={!instructionsEditable} value={instructionsDraft} />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-ink-subtle">{instructionsDraft.length} / 4000</span>
          {instructionsEditable && <div className="flex gap-2">
            <Button disabled={instructionsDraft === instructions} onClick={() => setInstructionsDraft(instructions)} size="sm" type="button" variant="ghost">Reset</Button>
            <Button className="bg-brand text-brand-ink hover:bg-brand-hover" disabled={instructionsSaving || instructionsDraft.trim() === instructions} onClick={() => void saveInstructions()} size="sm" type="button">{instructionsSaving ? 'Saving…' : 'Save'}</Button>
          </div>}
        </div>
      </div>}
    </aside>
  </>;
}
