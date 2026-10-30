'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, BrainCircuit, ChevronDown, Cloud, ScrollText, HardDrive, FileText, FolderOpen, Image as ImageIcon, Loader2, MessageSquarePlus, Paperclip, Plus, Send, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChatMarkdown } from '@/components/chat-markdown';
import { api } from '@/lib/api-client';
import { type ContextFile, createLineSplitter, parseStreamEvent } from '@/lib/chat-stream';
import type { FileSuggestion, ProjectFile } from '@/lib/contracts/files';
import type { ProviderModel } from '@/lib/contracts/providers';
import { cn } from '@/lib/utils';
import { Hint } from '@/components/hint';
import { type Project, PROJECT_FILE_ACCEPT } from '@/features/projects/project';
import { formatBytes } from '@/lib/format';

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
  included: { label: '', className: 'bg-[#e2efeb] text-[#2c5c54]' },
  truncated: { label: 'partial', className: 'bg-amber-50 text-amber-800' },
  unreadable: { label: 'not readable', className: 'bg-[#eef0ed] text-[#63706d]' },
  skipped: { label: 'over limit', className: 'bg-[#eef0ed] text-[#63706d]' },
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

export function ChatWorkspace({ project, models, onClose, onUsage, onFileCountChange, conversationId: openConversationId, initialFileIds }: { project: Project; models: ProviderModel[]; onClose: () => void; onUsage: (input: number, output: number) => void; onFileCountChange: (count: number) => void; conversationId: string | null; initialFileIds: string[] }) {
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
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [driveConfigured, setDriveConfigured] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [instructions, setInstructions] = useState('');
  const [instructionsDraft, setInstructionsDraft] = useState('');
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [instructionsEditable, setInstructionsEditable] = useState(false);
  const [instructionsSaving, setInstructionsSaving] = useState(false);
  const chatFileInput = useRef<HTMLInputElement>(null);
  const chatFolderInput = useRef<HTMLInputElement>(null);

  // Wcześniej czat startował zawsze pusty, mimo że messages leżały w D1.
  // Wczytujemy ostatnią rozmowę projektu, żeby odświeżenie strony nie kasowało
  // historii z widoku.
  // Stan startowy `historyLoading` wystarcza, bo Dashboard montuje ten komponent
  // na nowo dla każdego projektu (prop `key`) — nie ma czego resetować w efekcie.
  useEffect(() => {
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
        setChatMessages(detail.messages.flatMap((message) => message.role === 'system' ? [] : [{ role: message.role, content: message.content, context: message.contextFiles }]));
      } catch { /* czat zaczyna od pustej historii */ }
      finally { if (active) setHistoryLoading(false); }
    })();
    return () => { active = false; };
  }, [project.id, openConversationId]);

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
      setInstructionsOpen(false);
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
      setSelectedFileIds((current) => [...new Set([...current, ...files.map((file) => file.id)])].slice(0, 8));
      setConnectionsOpen(true);
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
    setChatMessages([]);
    setSelectedFileIds([]);
    setError(null);
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
          setConversationId(event.conversationId);
          updateAnswer((message) => ({ ...message, pending: false, context: event.context }));
          setSelectedFileIds([]);
          onUsage(event.usage.inputTokens, event.usage.outputTokens);
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

  return <dialog aria-labelledby="chat-title" className="fixed inset-0 z-[75] m-0 grid h-screen max-h-none w-screen max-w-none place-items-center bg-[#071411]/60 p-3 backdrop-blur-sm sm:p-6" open>
    <button aria-label="Close chat" className="absolute inset-0" onClick={onClose} type="button" />
    <section className="relative z-10 flex h-[min(820px,94vh)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-[#f7f8f5] shadow-2xl">
      <header className="flex items-center gap-3 border-b border-black/7 bg-white/80 px-4 py-3 sm:px-5">
        <span className="grid size-9 place-items-center rounded-xl bg-[#173d38] text-white"><BrainCircuit className="size-4" /></span>
        <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold" id="chat-title">{project.name}</h2><p className="text-[11px] text-[#76817f]">{historyLoading ? 'Loading conversation history…' : `Private conversation · ${chatMessages.length} messages · ${projectFiles.length} files`}</p></div>
        <label className="hidden text-xs text-[#697572] sm:block" htmlFor="chat-model">Model</label>
        <select className="h-9 max-w-[210px] rounded-lg border border-black/10 bg-white px-2 text-xs font-medium outline-none focus:ring-2 focus:ring-[#4d8b80]/30" disabled={!models.length} id="chat-model" onChange={(event) => setModel(event.target.value)} value={activeModel}>
          {models.length === 0 && <option value="">No models available</option>}
          {models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <Button aria-expanded={instructionsOpen} aria-label="Project instructions" className="relative" onClick={() => setInstructionsOpen((value) => !value)} size="icon" title={instructions ? 'Project instructions are on' : 'Project instructions'} variant="ghost"><ScrollText />{instructions && <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-emerald-600" />}</Button>
        <Button aria-label="Start a new conversation" disabled={historyLoading || !chatMessages.length} onClick={startNewConversation} size="icon" title="New conversation" variant="ghost"><MessageSquarePlus /></Button>
        <Button aria-label="Close chat" onClick={onClose} size="icon" variant="ghost"><X /></Button>
      </header>
      {instructionsOpen && <div className="border-b border-black/7 bg-[#f8faf8] px-4 py-3 sm:px-5">
        <div className="mx-auto max-w-3xl">
          <label className="text-xs font-semibold" htmlFor="project-instructions">Project instructions</label>
          <p className="mt-0.5 text-[11px] leading-4 text-[#75817e]">Sent to the model before every message in this project, ahead of any selected files. {instructionsEditable ? 'The owner and editors can change them.' : 'Only the owner and editors can change them.'}</p>
          <textarea className="mt-2 h-28 w-full resize-y rounded-lg border border-black/10 bg-white p-2 text-xs leading-5 outline-none focus:ring-2 focus:ring-[#4d8b80]/30" id="project-instructions" maxLength={4000} onChange={(event) => setInstructionsDraft(event.target.value)} placeholder="For example: Answer in Polish. Prefer TypeScript examples. Name the file when you refer to code." readOnly={!instructionsEditable} value={instructionsDraft} />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[10px] text-[#89928f]">{instructionsDraft.length} / 4000</span>
            {instructionsEditable && <div className="flex gap-2">
              <Button onClick={() => { setInstructionsDraft(instructions); setInstructionsOpen(false); }} size="sm" type="button" variant="ghost">Cancel</Button>
              <Button className="bg-[#173d38] text-white" disabled={instructionsSaving || instructionsDraft.trim() === instructions} onClick={() => void saveInstructions()} size="sm" type="button">{instructionsSaving ? 'Saving…' : 'Save'}</Button>
            </div>}
          </div>
        </div>
      </div>}
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-10">
        {chatMessages.length === 0 ? <div className="mx-auto grid h-full max-w-lg place-content-center text-center"><span className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-[#dff4ed] text-[#2f6e63]"><Bot /></span><h3 className="text-xl font-semibold tracking-tight">What would you like to work on?</h3><p className="mt-2 text-sm leading-6 text-[#707c79]">Ask about code, analyze a project or attach specific files. The model receives this conversation and only the text files you explicitly select.</p></div> : <div className="mx-auto max-w-3xl space-y-5">{chatMessages.map((message, index) => message.role === 'user'
          ? <div className="flex justify-end" key={`${message.role}-${index}`}><div className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[#173d38] px-4 py-3 text-sm leading-6 text-white">{message.content}</div></div>
          : <div className="flex flex-col items-start" key={`${message.role}-${index}`}>
            {message.content && <div className="max-w-[88%] rounded-2xl rounded-bl-md border border-black/6 bg-white px-4 py-3 text-sm leading-6 text-[#25322f] shadow-sm"><ChatMarkdown content={message.content} /></div>}
            {message.interrupted && <p className="mt-1 text-[10px] text-amber-800">Interrupted · this partial answer was not saved</p>}
            {!message.pending && message.context && <ContextChips files={message.context} />}
          </div>)}{sending && !chatMessages.some((message) => message.pending && message.content) && <div className="flex items-center gap-2 text-sm text-[#65716e]"><Loader2 className="size-4 animate-spin" /> Model is responding…</div>}</div>}
      </div>
      <footer className="border-t border-black/7 bg-white/80 p-3 sm:p-5">
        {error && <p className="mx-auto mb-2 max-w-3xl rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <div className="mx-auto mb-2 max-w-3xl">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button className="flex items-center gap-2 rounded-lg border border-black/8 bg-[#edf5f2] px-3 py-2 font-medium text-[#315f57]" onClick={() => setConnectionsOpen((value) => !value)} type="button"><Cloud className="size-4" /> Project cloud <span className="text-[#72807d]">{projectFiles.length}</span><ChevronDown className={cn('size-3 transition', connectionsOpen && 'rotate-180')} /></button>
            <Button className="h-8 rounded-lg" disabled={uploading} onClick={() => chatFileInput.current?.click()} size="sm" type="button" variant="outline"><Paperclip /> {uploading ? 'Adding…' : 'Add files'}</Button>
            <Button className="h-8 rounded-lg" disabled={uploading} onClick={() => chatFolderInput.current?.click()} size="sm" type="button" variant="outline"><FolderOpen /> Import folder</Button>
          </div>
          <input ref={chatFileInput} accept={PROJECT_FILE_ACCEPT} className="sr-only" multiple onChange={(event) => { const selected = Array.from(event.target.files ?? []); void uploadProjectFiles(selected); event.target.value = ''; }} type="file" />
          <input ref={chatFolderInput} className="sr-only" multiple onChange={(event) => { const selected = Array.from(event.target.files ?? []); void uploadProjectFiles(selected); event.target.value = ''; }} type="file" {...{ webkitdirectory: '' }} />
          {connectionsOpen && <div className="mt-2 rounded-xl border border-black/8 bg-[#f8faf8] p-3 shadow-sm">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg bg-white p-3 ring-1 ring-black/6"><Cloud className="mb-2 size-4 text-emerald-700" /><p className="text-xs font-semibold">Private cloud</p><p className="mt-1 text-[10px] text-[#75817e]">Active · project files</p></div>
              <button className="rounded-lg bg-white p-3 text-left ring-1 ring-black/6 hover:bg-[#f2f7f5]" onClick={() => chatFolderInput.current?.click()} type="button"><FolderOpen className="mb-2 size-4 text-sky-700" /><p className="text-xs font-semibold">Local folder</p><p className="mt-1 text-[10px] text-[#75817e]">Select and copy into the project</p></button>
              <div className="rounded-lg bg-white p-3 ring-1 ring-black/6"><HardDrive className="mb-2 size-4 text-amber-700" /><p className="text-xs font-semibold">Google Drive</p><p className="mt-1 text-[10px] text-[#75817e]">{driveConfigured ? 'Connector configured' : 'Owner authorization required'}</p></div>
            </div>
            {projectFiles.length > 0 && <div className="mt-3 border-t border-black/6 pt-3"><p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#74807d]">Select up to 8 files for the next message<Hint side="top" text="Text and code are sent as they are. PDF, DOCX, XLSX, PPTX and RTF are converted to text on the server. Images and archives are stored, but no available model can read them, so they arrive as metadata only." /></p><div className="max-h-28 space-y-1 overflow-y-auto">{projectFiles.slice(0, 40).map((file) => { const selected = selectedFileIds.includes(file.id); const image = file.mimeType.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name); return <div className={cn('flex items-center gap-1 rounded-lg pr-1', selected ? 'bg-[#dff0eb] text-[#22574f]' : 'hover:bg-black/[0.035]')} key={file.id}><button className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs" onClick={() => setSelectedFileIds((current) => selected ? current.filter((id) => id !== file.id) : current.length < 8 ? [...current, file.id] : current)} type="button">{image ? <ImageIcon className="size-3.5 shrink-0" /> : <FileText className="size-3.5 shrink-0" />}<span className="min-w-0 flex-1 truncate">{file.relativePath}</span><span className="shrink-0 text-[9px] text-[#89928f]">{selected ? 'selected' : formatBytes(file.sizeBytes)}</span></button><Button aria-label={`Delete ${file.relativePath} from cloud`} disabled={deletingFileId === file.id} onClick={() => void deleteProjectFile(file)} size="icon-xs" title="Delete from cloud" variant="ghost"><Trash2 /></Button></div>; })}</div></div>}
            <p className="mt-2 text-[10px] leading-4 text-[#7b8582]">A local folder is copied, not permanently connected. Images and documents are stored; current models automatically analyze only supported safe text formats.</p>
          </div>}
          {visibleSuggestions.length > 0 && <div aria-label="Files suggested for this question" className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#74807d]">Suggested</span>
            {visibleSuggestions.map((file) => <button className="flex max-w-[220px] items-center gap-1 rounded-full border border-dashed border-black/10 bg-[#edf5f2] px-2.5 py-1 text-[10px] text-[#315f57]" key={file.fileId} onClick={() => setSelectedFileIds((current) => current.length < 8 && !current.includes(file.fileId) ? [...current, file.fileId] : current)} title={`Add ${file.path} to the next message`} type="button"><Plus className="size-3" /><span className="truncate">{file.path.split('/').pop()}</span></button>)}
          </div>}
          {selectedFileIds.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{selectedFileIds.map((id) => { const file = projectFiles.find((item) => item.id === id); return file ? <button className="flex max-w-[220px] items-center gap-1 rounded-full bg-[#e2efeb] px-2.5 py-1 text-[10px] text-[#2c5c54]" key={id} onClick={() => setSelectedFileIds((current) => current.filter((item) => item !== id))} title="Remove from message context" type="button"><Paperclip className="size-3" /><span className="truncate">{file.name}</span><X className="size-3" /></button> : null; })}</div>}
        </div>
        <form className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-black/10 bg-white p-2 shadow-sm focus-within:ring-2 focus-within:ring-[#4d8b80]/20" onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
          <textarea aria-label="Message to model" className="max-h-36 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-[#8a9492]" maxLength={32_000} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder="Write a message…" rows={1} value={prompt} />
          <Button aria-label="Send message" className="size-9 rounded-xl bg-[#173d38] text-white" disabled={(!prompt.trim() && !selectedFileIds.length) || sending} size="icon" type="submit"><Send /></Button>
        </form>
        <p className="mt-2 text-center text-[10px] text-[#89928f]">Enter sends · Shift+Enter adds a new line · FREE models only</p>
      </footer>
    </section>
  </dialog>;
}
