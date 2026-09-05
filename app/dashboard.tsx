'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Activity, Ban, Bot, BrainCircuit, ChevronDown, Cloud, Code2, Download, FileArchive, Files, Folder,
  ScrollText, SlidersHorizontal, UserCheck,
  FolderLock, Gauge, HardDrive, KeyRound, LayoutGrid, LockKeyhole, Menu, Moon,
  FileText, FolderOpen, Image as ImageIcon, Info, Loader2, MessageSquarePlus, MessageSquareText,
  Copy, LogOut, Paperclip, Plus, Search, Send, ShieldCheck, Sparkles, Trash2,
  Sun, UploadCloud, Users, X,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarGroup } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { AUDIT_LABELS, type AuditAction, isSensitiveAction } from '@/lib/audit';
import { DEFAULT_DAILY_TOKENS, DEFAULT_MONTHLY_TOKENS, limitsAreCoherent, parseLimitInput } from '@/lib/limits';
import { DEFAULT_SECTION, parseSection, SECTION_LABELS, SECTION_PARAM, type Section, sectionSearch, visibleSections } from '@/lib/navigation';
import { parseTheme, resolveTheme, THEME_STORAGE_KEY, type Theme } from '@/lib/theme';
import { cn } from '@/lib/utils';

type Visibility = 'private' | 'selected' | 'team';
type StorageProvider = 'r2' | 'google_drive';
type Project = { id: string; name: string; description: string; visibility: Visibility; files: number; conversations: number; updated: string; color: string; icon: 'code' | 'folder' | 'lab'; members: string[] };
// `email` przychodzi wyłącznie do ownera — reszcie zespołu serwer go nie wysyła.
type TeamMember = { id: string; displayName: string; email?: string; role: 'owner' | 'member'; status: string; dailyTokens?: number; monthlyTokens?: number; apiEnabled?: boolean };
type PendingInvite = { id: string; email: string; expiresAt: string };
type TeamCapacity = { used: number; total: number };
// Lista modeli pochodzi wyłącznie z `FREE_MODELS` na serwerze i przyjeżdża
// w `/api/bootstrap`. Dopisanie kolejnego modelu to jedna linia po stronie
// serwera — UI nie ma własnej, rozjeżdżającej się kopii.
type ModelOption = { id: string; label: string; tier: string; family: string; description: string };
type ProjectShare = { memberId: string; role: 'reader' | 'editor' };
type ProjectFile = { id: string; relativePath: string; name: string; mimeType: string; sizeBytes: number; createdAt: string };

const PROJECT_FILE_ACCEPT = '.txt,.md,.json,.csv,.ts,.tsx,.js,.jsx,.mjs,.cjs,.py,.go,.rs,.java,.kt,.swift,.css,.scss,.html,.xml,.yaml,.yml,.toml,.sql,.sh,.ps1,.bat,.zip,.pdf,.rtf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.gif,.bmp';

const visibilityLabels: Record<Visibility, string> = { private: 'Only me', selected: 'Selected people', team: 'Entire team' };
const SECTION_SUBTITLES: Record<Section, string> = {
  dashboard: 'Your projects stay private until you choose who can access them.',
  projects: 'Every project you can access: private, shared and team-wide.',
  conversations: 'Conversation history from every project you can access.',
  team: 'Members, invitations and reconnect links. Up to four people.',
  usage: 'See token usage by model and how much remains.',
  activity: 'Review activity and export a database backup. Conversation contents, files and secrets are excluded.',
};
const iconMap = { code: Code2, folder: FolderLock, lab: Sparkles };

// Podpowiedz przy etykiecie. Celowo NIE owijamy samych kontrolek: przelacznik
// albo przycisk owiniety w drugi element interaktywny potrafi zgubic zdarzenia
// i miesza kolejnosc czytania dla czytnikow ekranu. Osobna ikona kosztuje kilka
// pikseli, ale jest widoczna obietnica, ze jest tu cos do przeczytania -
// podpowiedz, o ktorej nikt nie wie, nie istnieje.
//
// Trescia jest to, czego z samego interfejsu nie widac: co dana rzecz robi POZA
// ekranem i czego NIE robi. Opisywanie etykiety jej wlasnymi slowami byloby
// szumem, ktory uczy ludzi ignorowac wszystkie dymki.
function Hint({ text, side = 'top', ciemna = false }: { text: string; side?: 'top' | 'bottom' | 'left' | 'right'; ciemna?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger
        aria-label="More information"
        className={cn(
          'inline-grid size-4 shrink-0 place-items-center rounded-full align-middle transition',
          ciemna ? 'text-white/45 hover:text-white/80' : 'text-[#9aa5a2] hover:text-[#4b6b64]',
        )}
        type="button"
      >
        <Info className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent className="max-w-72 leading-5" side={side}>{text}</TooltipContent>
    </Tooltip>
  );
}

export function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | Visibility>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  // Startujemy zawsze od widoku domyślnego, a adres odczytujemy dopiero w
  // efekcie — inaczej serwer i klient wyrenderowałyby co innego.
  const [section, setSection] = useState<Section>(DEFAULT_SECTION);
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [driveConfigured, setDriveConfigured] = useState(false);
  const [storageProvider, setStorageProvider] = useState<StorageProvider>('r2');
  const [projectName, setProjectName] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [projectShares, setProjectShares] = useState<ProjectShare[]>([]);
  const [importedFile, setImportedFile] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('Daniel');
  const [currentRole, setCurrentRole] = useState<'owner' | 'member'>('member');
  const [currentMemberId, setCurrentMemberId] = useState('');
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  // `null` znaczy "otworz najnowsza rozmowe projektu" - dotychczasowe zachowanie.
  // Konkretny identyfikator otwiera wskazana rozmowe z widoku Conversations.
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [dailyUsage, setDailyUsage] = useState(0);
  const [inputUsage, setInputUsage] = useState(0);
  const [outputUsage, setOutputUsage] = useState(0);
  const [dailyLimit, setDailyLimit] = useState(400_000);
  const [monthlyUsage, setMonthlyUsage] = useState(0);
  const [monthlyLimit, setMonthlyLimit] = useState(8_000_000);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [reconnectLinks, setReconnectLinks] = useState<PendingInvite[]>([]);
  const [teamCapacity, setTeamCapacity] = useState<TeamCapacity>({ used: 1, total: 4 });
  const [models, setModels] = useState<ModelOption[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const contextInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch('/api/bootstrap', { cache: 'no-store' }),
      fetch('/api/projects', { cache: 'no-store' }),
      fetch('/api/team', { cache: 'no-store' }),
    ])
      .then(async ([bootstrapResponse, projectsResponse, teamResponse]) => {
        if ([bootstrapResponse, projectsResponse, teamResponse].some((response) => response.status === 401)) {
          if (active) setAuthRequired(true);
          return;
        }
        if (!bootstrapResponse.ok || !projectsResponse.ok || !teamResponse.ok) throw new Error('Could not load application data.');
        const bootstrap = (await bootstrapResponse.json()) as { member: { id: string; displayName: string; role: 'owner' | 'member' }; limits?: { dailyTokens: number; monthlyTokens: number }; usage?: { inputTokens: number; outputTokens: number; monthlyTokens: number }; models?: ModelOption[] };
        const payload = (await projectsResponse.json()) as { projects: Array<{ id: string; name: string; description: string; visibility: Visibility; fileCount: number; conversationCount: number; updatedAt: string }> };
        const team = (await teamResponse.json()) as { members: TeamMember[]; pendingInvites: PendingInvite[]; reconnectLinks?: PendingInvite[]; capacity: TeamCapacity };
        if (!active) return;
        setDisplayName(bootstrap.member.displayName.split(' ')[0] || 'Daniel');
        setCurrentRole(bootstrap.member.role);
        setCurrentMemberId(bootstrap.member.id);
        setModels(bootstrap.models ?? []);
        setDailyLimit(bootstrap.limits?.dailyTokens ?? 400_000);
        setMonthlyLimit(bootstrap.limits?.monthlyTokens ?? 8_000_000);
        setMonthlyUsage(bootstrap.usage?.monthlyTokens ?? 0);
        setInputUsage(bootstrap.usage?.inputTokens ?? 0);
        setOutputUsage(bootstrap.usage?.outputTokens ?? 0);
        setDailyUsage((bootstrap.usage?.inputTokens ?? 0) + (bootstrap.usage?.outputTokens ?? 0));
        setTeamMembers(team.members);
        setPendingInvites(team.pendingInvites);
        setReconnectLinks(team.reconnectLinks ?? []);
        setTeamCapacity(team.capacity ?? { used: team.members.length, total: 4 });
        setProjects(payload.projects.map((project, index) => ({ id: project.id, name: project.name, description: project.description, visibility: project.visibility, files: project.fileCount, conversations: project.conversationCount ?? 0, updated: relativeDate(project.updatedAt), color: ['from-cyan-400/20 via-teal-300/10 to-transparent', 'from-violet-400/20 via-fuchsia-300/10 to-transparent', 'from-amber-300/20 via-orange-300/10 to-transparent'][index % 3], icon: index % 3 === 0 ? 'code' : index % 3 === 1 ? 'folder' : 'lab', members: ['DS'] })));
        void fetch('/api/auth/claim', { method: 'POST' }).catch(() => undefined);
      })
      .catch((error) => { if (active) setNotice(error instanceof Error ? error.message : 'Could not load application data.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    Promise.all([fetch('/api/sync', { cache: 'no-store' }), fetch('/api/storage/google-drive/status', { cache: 'no-store' })])
      .then(async ([syncResponse, driveResponse]) => {
        if (syncResponse.ok) setSyncEnabled(Boolean(((await syncResponse.json()) as { enabled?: boolean }).enabled));
        if (driveResponse.ok) setDriveConfigured(Boolean(((await driveResponse.json()) as { configured?: boolean }).configured));
      })
      .catch(() => undefined);
  }, []);

  // Adres jest źródłem prawdy dla wybranego widoku: odczyt przy wejściu plus
  // reakcja na Wstecz/Dalej, żeby przyciski przeglądarki robiły to, czego
  // użytkownik oczekuje.
  useEffect(() => {
    const syncFromUrl = () => setSection(parseSection(new URLSearchParams(window.location.search).get(SECTION_PARAM)));
    const frame = requestAnimationFrame(syncFromUrl);
    window.addEventListener('popstate', syncFromUrl);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('popstate', syncFromUrl);
    };
  }, []);

  function goToSection(next: Section) {
    setSection(next);
    setMobileMenu(false);
    window.history.pushState(null, '', `${window.location.pathname}${sectionSearch(next, window.location.search)}`);
  }

  // Po zaproszeniu albo cofnięciu zaproszenia bierzemy stan z serwera zamiast
  // zgadywać go lokalnie — link ponownego dostępu nie zajmuje miejsca w zespole,
  // więc licznik „x z 4” nie da się poprawnie policzyć po stronie przeglądarki.
  async function refreshTeam() {
    try {
      const response = await fetch('/api/team', { cache: 'no-store' });
      if (!response.ok) return;
      const team = (await response.json()) as { members: TeamMember[]; pendingInvites: PendingInvite[]; reconnectLinks?: PendingInvite[]; capacity: TeamCapacity };
      setTeamMembers(team.members);
      setPendingInvites(team.pendingInvites);
      setReconnectLinks(team.reconnectLinks ?? []);
      setTeamCapacity(team.capacity);
    } catch { /* panel zostaje przy ostatnim odczycie */ }
  }

  async function updateSync(enabled: boolean) {
    const previous = syncEnabled;
    setSyncEnabled(enabled);
    try {
      const response = await fetch('/api/sync', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
      if (!response.ok) throw new Error();
      setNotice(enabled ? 'Automatic sync has been enabled.' : 'Automatic sync has been disabled.');
    } catch { setSyncEnabled(previous); setNotice('Could not save the sync setting.'); }
  }
  // Kafelki pokazywały wcześniej zaszyte liczby („94 pliki”, „1,8 GB z 10 GB”,
  // „36 rozmów”), niezależne od stanu konta. Liczymy je z realnych danych.
  const totals = useMemo(() => ({
    files: projects.reduce((sum, project) => sum + project.files, 0),
    conversations: projects.reduce((sum, project) => sum + project.conversations, 0),
    shared: projects.filter((project) => project.visibility !== 'private').length,
  }), [projects]);

  // Pulpit jest podsumowaniem, więc pokazuje tylko kilka najświeższych projektów;
  // pełna lista z filtrami mieszka w widoku „Projects”, żeby oba nie były tym samym.
  const recentProjects = useMemo(() => projects.slice(0, 4), [projects]);
  const showImportActions = section === 'dashboard' || section === 'projects';

  const filteredProjects = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('pl');
    return projects.filter((p) => (activeFilter === 'all' || p.visibility === activeFilter) && (!needle || `${p.name} ${p.description}`.toLocaleLowerCase('pl').includes(needle)));
  }, [activeFilter, projects, query]);

  async function createProject() {
    const name = projectName.trim();
    if (!name) return;
    setSaving(true); setNotice(null);
    try {
      const response = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description: importedFile ? `Import: ${importedFile}` : '', visibility, selectedMembers: [], members: projectShares, storageProvider }) });
      const payload = (await response.json()) as { project?: { id: string }; error?: string };
      if (!response.ok || !payload.project) throw new Error(payload.error ?? 'Could not create the project.');
      if (pendingFiles.length) {
        const form = new FormData();
        pendingFiles.forEach((file) => form.append('files', file));
        form.append('paths', JSON.stringify(pendingFiles.map((file) => file.webkitRelativePath || file.name)));
        const upload = await fetch(`/api/projects/${payload.project.id}/files`, { method: 'POST', body: form });
        if (!upload.ok) {
          const uploadPayload = (await upload.json()) as { error?: string };
          throw new Error(uploadPayload.error ?? 'The project was created, but its files could not be imported.');
        }
      }
      setProjects((current) => [{ id: payload.project!.id, name, description: importedFile ? `Imported: ${importedFile}` : 'New project workspace.', visibility, files: pendingFiles.length, conversations: 0, updated: 'now', color: 'from-emerald-400/20 via-cyan-300/10 to-transparent', icon: 'folder', members: visibility === 'private' ? ['DS'] : ['DS', 'MK'] }, ...current]);
      setProjectName(''); setImportedFile(null); setPendingFiles([]); setVisibility('private'); setProjectShares([]); setStorageProvider('r2'); setShowCreate(false); setNotice(storageProvider === 'google_drive' ? 'The project was saved to the cloud and connected to Google Drive.' : 'The project was saved to the private cloud.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save the project.');
    } finally { setSaving(false); }
  }

  async function importContext(file: File) {
    setSaving(true); setNotice(null);
    try {
      const form = new FormData();
      form.append('context', file);
      const response = await fetch('/api/context/import', { method: 'POST', body: form });
      const payload = (await response.json()) as { project?: { id: string; name: string; visibility: Visibility; conversations: number }; message?: string; error?: string };
      if (!response.ok || !payload.project) throw new Error(payload.error ?? 'Could not import the context.');
      setProjects((current) => [{ id: payload.project!.id, name: payload.project!.name, description: `${payload.project!.conversations} imported conversations`, visibility: payload.project!.visibility, files: 0, conversations: payload.project!.conversations, updated: 'now', color: 'from-sky-400/20 via-cyan-300/10 to-transparent', icon: 'lab', members: ['DS'] }, ...current]);
      setNotice(payload.message ?? 'Context imported.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Context import failed.'); }
    finally { setSaving(false); }
  }

  async function makeProjectPrivate(project: Project) {
    if (project.visibility === 'private') return;
    try {
      const response = await fetch(`/api/projects/${project.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visibility: 'private', members: [] }) });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Could not make the project private.');
      setProjects((current) => current.map((item) => item.id === project.id ? { ...item, visibility: 'private', members: ['DS'], updated: 'now' } : item));
      setNotice('The project is now visible only to you.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not make the project private.'); }
  }

  async function deleteProject(project: Project) {
    if (!window.confirm(`Delete “${project.name}” with all of its files and conversations? This cannot be undone.`)) return;
    try {
      const response = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Could not delete the project.');
      setProjects((current) => current.filter((item) => item.id !== project.id));
      setNotice('The project and its data were deleted.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not delete the project.'); }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.replace('/');
  }

  if (loading) return <SecureGate title="Loading private cloud…" />;
  if (authRequired) return <SecureGate authRequired title="This workspace requires an invitation" />;

  return (
    <TooltipProvider delay={200}>
    <main className="min-h-screen bg-[#f4f5f2] text-[#15211f]">
      <div className="min-h-screen lg:grid lg:grid-cols-[252px_minmax(0,1fr)]">
        <Sidebar fileCount={totals.files} isOwner={currentRole === 'owner'} onClose={() => setMobileMenu(false)} onSelect={goToSection} open={mobileMenu} section={section} />
        <section className="min-w-0">
          <header className="sticky top-0 z-30 flex h-[72px] items-center gap-3 border-b border-black/7 bg-[#f4f5f2]/90 px-4 backdrop-blur-xl dark:bg-[#0d1e1a]/90 sm:px-7 lg:px-10">
            <Button aria-label="Open menu" className="lg:hidden" onClick={() => setMobileMenu(true)} size="icon" variant="ghost"><Menu /></Button>
            <div className="relative max-w-xl flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#75817e]" />
              <Input aria-label="Search projects" className="h-10 rounded-xl border-black/8 bg-white/75 pl-9 shadow-none" onChange={(e) => setQuery(e.target.value)} placeholder="Search projects, files or conversations…" value={query} />
            </div>
            <Badge className="hidden border-emerald-700/15 bg-emerald-100/80 text-emerald-800 sm:flex" variant="outline"><span className="size-1.5 rounded-full bg-emerald-500" />Service online</Badge>
            <ThemeToggle />
            <Button aria-label="Sign out" onClick={() => void logout()} size="icon" title="Sign out" variant="ghost"><LogOut /></Button>
            <Avatar className="bg-[#173d38] text-white"><AvatarFallback className="bg-transparent text-xs font-semibold text-white">DS</AvatarFallback></Avatar>
          </header>

          <div className="mx-auto max-w-[1500px] px-4 py-7 sm:px-7 lg:px-10 lg:py-10">
            <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
              <div>
                <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#518078]"><ShieldCheck className="size-4" /> Private team cloud</p>
                <h1 className="text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">{section === 'dashboard' ? `Welcome, ${displayName}.` : SECTION_LABELS[section]}</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[#63706d] sm:text-base">{SECTION_SUBTITLES[section]}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {/* Pola plikowe zostają zamontowane niezależnie od widoku — trzymają je refy,
                    a odmontowanie zerwałoby uchwyty używane przez obsługę importu. */}
                {showImportActions && <>
                  <Button className="h-10 rounded-xl border-black/8 bg-white px-3" onClick={() => contextInput.current?.click()} variant="outline"><MessageSquareText /> Context</Button>
                  <Button className="h-10 rounded-xl border-black/8 bg-white px-3" onClick={() => folderInput.current?.click()} variant="outline"><Folder /> Folder</Button>
                  <Button className="h-10 rounded-xl border-black/8 bg-white px-3" onClick={() => fileInput.current?.click()} variant="outline"><UploadCloud /> File / ZIP</Button>
                  <Button className="h-10 rounded-xl bg-[#173d38] px-4 text-white shadow-[0_8px_24px_rgba(23,61,56,.18)] hover:bg-[#23534c]" onClick={() => setShowCreate(true)}><Plus /> New project</Button>
                </>}
                <input ref={fileInput} accept={PROJECT_FILE_ACCEPT} className="sr-only" multiple onChange={(e) => { const selected = Array.from(e.target.files ?? []); if (selected.length) { setPendingFiles(selected); setImportedFile(`${selected.length} ${selected.length === 1 ? 'file' : 'files'}`); setShowCreate(true); } e.target.value = ''; }} type="file" />
                <input ref={folderInput} className="sr-only" multiple onChange={(e) => { const selected = Array.from(e.target.files ?? []); if (selected.length) { setPendingFiles(selected); setImportedFile(`folder · ${selected.length} files`); setShowCreate(true); } e.target.value = ''; }} type="file" {...{ webkitdirectory: '' }} />
                <input ref={contextInput} accept="application/json,.json" className="sr-only" onChange={(e) => { const selected = e.target.files?.[0]; if (selected) void importContext(selected); e.target.value = ''; }} type="file" />
              </div>
            </div>

            {section === 'dashboard' && <>
            <section aria-label="Overview" className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard icon={Folder} label="Projects" value={String(projects.length)} detail={totals.shared ? `${totals.shared} shared` : 'all private'} />
              <MetricCard icon={Files} label="Files" value={String(totals.files)} detail="in private project storage" />
              <MetricCard icon={MessageSquareText} label="Conversations" value={String(totals.conversations)} detail={`${teamCapacity.used} of ${teamCapacity.total} team seats`} />
              <MetricCard icon={Gauge} label="Tokens today" value={formatTokens(dailyUsage)} detail={`${dailyLimit ? Math.round((dailyUsage / dailyLimit) * 100) : 0}% of the daily limit`} accent />
            </section>

            <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
              <section>
                <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div><h2 className="text-xl font-semibold tracking-tight">Recent projects</h2><p className="mt-1 text-sm text-[#75817e]">The four most recently updated projects. Open Projects for the full, filtered list.</p></div>
                  {projects.length > recentProjects.length && <Button className="h-9 rounded-xl border-black/8 bg-white px-3" onClick={() => goToSection('projects')} variant="outline">View all ({projects.length})</Button>}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {recentProjects.map((project) => <ProjectCard key={project.id} onCopyId={() => { void navigator.clipboard.writeText(project.id); setNotice('Project ID copied. Use it with the sync agent.'); }} onDelete={() => void deleteProject(project)} onExport={() => { window.location.href = `/api/projects/${project.id}/context`; }} onMakePrivate={() => void makeProjectPrivate(project)} onOpen={() => { setActiveConversationId(null); setActiveProject(project); }} project={project} />)}
                  {projects.length === 0 && <button className="group flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-[#9caaa6] bg-white/35 p-6 text-center transition hover:border-[#4c7a72] hover:bg-white/70" onClick={() => setShowCreate(true)} type="button">
                    <span className="mb-3 flex size-11 items-center justify-center rounded-xl border border-black/7 bg-white text-[#31675e] shadow-sm transition group-hover:-translate-y-0.5"><Plus /></span>
                    <span className="font-semibold">Create your first project</span><span className="mt-1 max-w-[230px] text-sm leading-5 text-[#75817e]">Start empty or import a folder or ZIP archive.</span>
                  </button>}
                </div>
              </section>
              <aside className="space-y-4 xl:sticky xl:top-[96px]">
                <UsagePanel dailyLimit={dailyLimit} inputUsage={inputUsage} monthlyLimit={monthlyLimit} monthlyUsage={monthlyUsage} outputUsage={outputUsage} />
                <Card className="border-0 bg-[#15322e] text-white shadow-[0_16px_46px_rgba(20,48,44,.16)] ring-0">
                  <CardHeader><CardDescription className="flex items-center gap-2 text-emerald-100/65"><Cloud className="size-4" /> File agent</CardDescription><CardTitle className="flex items-center gap-1.5 text-lg text-white">Folder sync<Hint ciemna side="bottom" text="Enforced by the server, not by the script. While this is off the server rejects uploads and deletions from any agent, including a modified one. Browser uploads are unaffected." /></CardTitle><CardAction><Switch aria-label="Local folder sync" checked={syncEnabled} onCheckedChange={(enabled) => void updateSync(enabled)} /></CardAction></CardHeader>
                  <CardContent><p className="text-sm leading-6 text-emerald-50/70">{syncEnabled ? 'The agent running on your computer can upload changed files to a selected project and, with -PropagateDeletes, remove files deleted from disk.' : 'The server rejects agent uploads and deletions. Browser uploads work independently of this switch.'}</p><p className="mt-3 text-xs leading-5 text-emerald-100/50">This covers local files only. Codex, Claude, Gemini and Grok conversations require a manual JSON import.</p><div className="mt-4 flex items-center gap-2 text-xs text-emerald-100/70"><span className={cn('size-2 rounded-full', syncEnabled ? 'bg-emerald-400' : 'bg-stone-500')} />{syncEnabled ? 'Active · files only' : 'Manually disabled'}</div></CardContent>
                </Card>
                <SyncAgentPanel onNotice={setNotice} />
              </aside>
            </div>
            </>}

            {section === 'projects' && <section aria-label="All projects">
              <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <p className="text-sm text-[#75817e]">{filteredProjects.length === projects.length ? `${projects.length} ${projects.length === 1 ? 'project' : 'projects'}` : `${filteredProjects.length} of ${projects.length} projects`}</p>
                <div className="flex flex-wrap gap-1 rounded-xl border border-black/7 bg-white/70 p-1">
                  {([['all', 'All'], ['private', 'Only me'], ['selected', 'Selected'], ['team', 'Team']] as const).map(([key, label]) => (
                    <button key={key} className={cn('rounded-lg px-3 py-1.5 text-xs font-medium transition-colors', activeFilter === key ? 'bg-[#173d38] text-white' : 'text-[#65716e] hover:bg-black/5')} onClick={() => setActiveFilter(key)} type="button">{label}</button>
                  ))}
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {filteredProjects.map((project) => <ProjectCard key={project.id} onCopyId={() => { void navigator.clipboard.writeText(project.id); setNotice('Project ID copied. Use it with the sync agent.'); }} onDelete={() => void deleteProject(project)} onExport={() => { window.location.href = `/api/projects/${project.id}/context`; }} onMakePrivate={() => void makeProjectPrivate(project)} onOpen={() => { setActiveConversationId(null); setActiveProject(project); }} project={project} />)}
                <button className="group flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-[#9caaa6] bg-white/35 p-6 text-center transition hover:border-[#4c7a72] hover:bg-white/70" onClick={() => setShowCreate(true)} type="button">
                  <span className="mb-3 flex size-11 items-center justify-center rounded-xl border border-black/7 bg-white text-[#31675e] shadow-sm transition group-hover:-translate-y-0.5"><Plus /></span>
                  <span className="font-semibold">Add another project</span><span className="mt-1 max-w-[230px] text-sm leading-5 text-[#75817e]">Create an empty project or import a folder or ZIP archive.</span>
                </button>
              </div>
              {filteredProjects.length === 0 && <div className="mt-4 rounded-2xl border border-dashed border-black/10 bg-white/50 p-12 text-center"><Folder className="mx-auto mb-3 text-[#6f7b78]" /><p className="font-medium">No projects found</p><p className="mt-1 text-sm text-[#75817e]">Change the filter or try another search term.</p></div>}
            </section>}

            {section === 'conversations' && <ConversationsView onNotice={setNotice} onOpenConversation={(projectId, conversationId) => { const target = projects.find((item) => item.id === projectId); if (!target) { setNotice('You no longer have access to this conversation’s project.'); return; } setActiveConversationId(conversationId); setActiveProject(target); }} query={query} />}

            {section === 'team' && <div className="max-w-2xl"><TeamPanel canInvite={currentRole === 'owner'} capacity={teamCapacity} currentMemberId={currentMemberId} members={teamMembers} onNotice={setNotice} onTeamChanged={() => void refreshTeam()} pendingInvites={pendingInvites} reconnectLinks={reconnectLinks} /></div>}

            {section === 'usage' && <UsageView dailyLimit={dailyLimit} isOwner={currentRole === 'owner'} monthlyLimit={monthlyLimit} onNotice={setNotice} />}

            {section === 'activity' && (currentRole === 'owner'
              ? <AuditView onNotice={setNotice} />
              : <ViewPlaceholder detail="Only the cloud owner can view the activity log." icon={LockKeyhole} title="Access denied" />)}
          </div>
        </section>
      </div>
      {notice && <output aria-live="polite" className="fixed bottom-5 right-5 z-[80] max-w-sm rounded-xl bg-[#173d38] px-4 py-3 text-sm text-white shadow-xl">{notice}</output>}
      {showCreate && <CreateProjectDialog driveConfigured={driveConfigured} importedFile={importedFile} members={teamMembers.filter((member) => member.role !== 'owner')} name={projectName} onClose={() => { if (!saving) { setShowCreate(false); setImportedFile(null); setPendingFiles([]); setProjectShares([]); setStorageProvider('r2'); } }} onCreate={createProject} onNameChange={setProjectName} onSharesChange={setProjectShares} onStorageProviderChange={setStorageProvider} onVisibilityChange={setVisibility} saving={saving} shares={projectShares} storageProvider={storageProvider} visibility={visibility} />}
      {activeProject && <ChatWorkspace conversationId={activeConversationId} key={`${activeProject.id}:${activeConversationId ?? 'ostatnia'}`} models={models} onClose={() => { setActiveProject(null); setActiveConversationId(null); }} onFileCountChange={(count) => setProjects((current) => current.map((item) => item.id === activeProject.id ? { ...item, files: count } : item))} onUsage={(input, output) => { setInputUsage((value) => value + input); setOutputUsage((value) => value + output); setDailyUsage((value) => value + input + output); setMonthlyUsage((value) => value + input + output); }} project={activeProject} />}
    </main>
    </TooltipProvider>
  );
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
}

// Przeglądarka może zablokować dostęp do localStorage (tryb prywatny, wyłączone
// dane witryn), a wtedy samo czytanie rzuca wyjątkiem.
function readStoredTheme(): Theme | null {
  try {
    return parseTheme(localStorage.getItem(THEME_STORAGE_KEY));
  } catch { return null; }
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  // Preferencję czytamy tutaj, a nie z klasy `dark` ustawionej przez skrypt
  // inline w layout.tsx. Produkcyjna CSP (`default-src 'self'`, bez
  // The external pre-paint script and this hydrated fallback both read the
  // same storage key, so the saved preference survives strict CSP.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const resolved = resolveTheme(
        readStoredTheme(),
        window.matchMedia('(prefers-color-scheme: dark)').matches,
      );
      applyTheme(resolved);
      setTheme(resolved);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  function toggleTheme() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* wybór zostaje na czas tej wizyty */ }
    setTheme(next);
  }

  const dark = theme === 'dark';
  return <Button aria-label={dark ? 'Use light theme' : 'Use dark theme'} onClick={toggleTheme} size="icon" title={dark ? 'Light theme' : 'Dark theme'} variant="ghost">{dark ? <Sun /> : <Moon />}</Button>;
}

const SECTION_ICONS: Record<Section, typeof Folder> = {
  dashboard: LayoutGrid,
  projects: Folder,
  conversations: MessageSquareText,
  team: Users,
  usage: Activity,
  activity: ScrollText,
};

function Sidebar({ open, onClose, fileCount, isOwner, section, onSelect }: { open: boolean; onClose: () => void; fileCount: number; isOwner: boolean; section: Section; onSelect: (section: Section) => void }) {
  const nav = visibleSections(isOwner).map((item) => ({ id: item, label: SECTION_LABELS[item], icon: SECTION_ICONS[item], active: item === section }));
  return <><button aria-label="Close menu" className={cn('fixed inset-0 z-40 bg-black/35 backdrop-blur-sm lg:hidden', open ? 'block' : 'hidden')} onClick={onClose} type="button" /><aside className={cn('fixed inset-y-0 left-0 z-50 flex w-[252px] flex-col border-r border-white/8 bg-[#102724] px-4 py-5 text-white transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
    <div className="mb-8 flex items-center justify-between px-2"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-cyan-300 to-emerald-400 text-[#102724]"><Bot className="size-5" /></span><div><p className="font-semibold tracking-tight">MeshKeep</p><p className="text-[11px] text-emerald-100/45">PRIVATE TEAM CLOUD</p></div></div><Button aria-label="Close menu" className="text-white lg:hidden" onClick={onClose} size="icon-sm" variant="ghost"><X /></Button></div>
    <nav aria-label="Main navigation" className="space-y-1">{nav.map((item) => <button key={item.id} aria-current={item.active ? 'page' : undefined} className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors', item.active ? 'bg-white/10 font-medium text-white' : 'text-emerald-50/58 hover:bg-white/6 hover:text-white')} onClick={() => onSelect(item.id)} type="button"><item.icon className="size-[18px]" />{item.label}</button>)}</nav>
    <div className="mt-auto rounded-2xl border border-white/8 bg-white/[0.045] p-4"><div className="mb-2 flex items-center justify-between text-xs"><span className="text-emerald-50/60">Cloud files</span><span className="font-medium">{fileCount}</span></div><p className="text-[11px] leading-4 text-emerald-50/40">Only files you explicitly select are uploaded. Your local Projects folder is not connected.</p></div>
  </aside></>;
}

function SecureGate({ title, authRequired = false }: { title: string; authRequired?: boolean }) {
  return <main className="grid min-h-screen place-items-center bg-[#f4f5f2] p-5 text-[#15211f]"><Card className="w-full max-w-md border-0 bg-white/90 text-center shadow-xl ring-black/6"><CardHeader><span className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-[#dff4ed] text-[#2f6e63]">{authRequired ? <LockKeyhole /> : <Loader2 className="animate-spin" />}</span><CardTitle>{title}</CardTitle><CardDescription>{authRequired ? 'Ask the owner for a one-time link. The owner can reconnect with their ChatGPT account.' : 'Checking your session and project access.'}</CardDescription></CardHeader>{authRequired && <CardFooter className="justify-center"><Link className="inline-flex h-8 items-center justify-center rounded-lg bg-[#173d38] px-3 text-sm font-medium text-white transition hover:bg-[#23534c]" href="/signin-with-chatgpt?return_to=%2F">I am the owner</Link></CardFooter>}</Card></main>;
}

function MetricCard({ icon: Icon, label, value, detail, accent = false }: { icon: typeof Folder; label: string; value: string; detail: string; accent?: boolean }) {
  return <Card className={cn('border-0 py-4 shadow-none ring-black/6', accent ? 'bg-[#dff4ed]' : 'bg-white/80')}><CardContent className="flex items-center gap-4"><span className={cn('grid size-10 place-items-center rounded-xl', accent ? 'bg-[#173d38] text-white' : 'bg-[#eef0ed] text-[#42645e]')}><Icon className="size-[18px]" /></span><div className="min-w-0"><p className="text-xs font-medium text-[#75817e]">{label}</p><p className="mt-0.5 text-xl font-semibold tracking-tight">{value}</p><p className="truncate text-[11px] text-[#87918f]">{detail}</p></div></CardContent></Card>;
}

function ProjectCard({ project, onExport, onOpen, onMakePrivate, onDelete, onCopyId }: { project: Project; onExport: () => void; onOpen: () => void; onMakePrivate: () => void; onDelete: () => void; onCopyId: () => void }) {
  const Icon = iconMap[project.icon]; const VisibilityIcon = project.visibility === 'private' ? LockKeyhole : Users;
  return <Card className="group relative min-h-[220px] overflow-hidden border-0 bg-white/85 shadow-[0_8px_30px_rgba(24,48,44,.045)] ring-black/6 transition hover:-translate-y-0.5 hover:shadow-[0_16px_38px_rgba(24,48,44,.08)]"><div className={cn('pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-br', project.color)} /><CardHeader className="relative"><div className="mb-4 flex items-start justify-between"><button aria-label={`Open project ${project.name}`} className="grid size-11 place-items-center rounded-xl border border-black/6 bg-white/90 text-[#2c5b54] shadow-sm" onClick={onOpen} type="button"><Icon className="size-5" /></button><div className="flex"><Button aria-label={`Copy project ID for ${project.name}`} onClick={onCopyId} size="icon-sm" title="Copy ID for agent" variant="ghost"><Copy /></Button><Button aria-label={`Export context for ${project.name}`} onClick={onExport} size="icon-sm" variant="ghost"><Download /></Button>{project.visibility === 'private' ? <Button aria-label={`Delete project ${project.name}`} onClick={onDelete} size="icon-sm" variant="ghost"><Trash2 /></Button> : <Button aria-label={`Make project ${project.name} private`} onClick={onMakePrivate} size="icon-sm" variant="ghost"><LockKeyhole /></Button>}</div></div><button className="text-left" onClick={onOpen} type="button"><CardTitle className="text-base">{project.name}</CardTitle><CardDescription className="min-h-10 leading-5">{project.description}</CardDescription></button></CardHeader><CardContent className="mt-auto flex items-center justify-between"><Badge className={cn('gap-1.5 font-medium', project.visibility === 'private' ? 'border-[#82604d]/15 bg-[#f6ede7] text-[#795b49]' : 'border-[#387267]/15 bg-[#e4f2ee] text-[#32665d]')} variant="outline"><VisibilityIcon /> {visibilityLabels[project.visibility]}</Badge><AvatarGroup>{project.members.map((member, index) => <Avatar className={cn('size-7', ['bg-[#d7ece7]', 'bg-[#f1e4d7]', 'bg-[#e5e1f1]', 'bg-[#dfe7f1]'][index])} key={member} size="sm"><AvatarFallback className="bg-transparent text-[9px] font-semibold text-[#354a46]">{member}</AvatarFallback></Avatar>)}</AvatarGroup></CardContent><CardFooter className="justify-between border-black/5 bg-black/[0.015] py-2 text-[11px] text-[#818b89]"><span>{project.files} files · {project.updated}</span><Button onClick={onOpen} size="sm" variant="ghost">Open chat</Button></CardFooter></Card>;
}

type EffectiveProvider = { label: string; origin: 'member' | 'team' | 'environment'; modelCount: number } | null;

const ORIGIN_LABEL: Record<'member' | 'team' | 'environment', string> = {
  member: 'your own key',
  team: "the team's key",
  environment: 'a key set on the server',
};

// The dashboard and usage view describe the same provider, so they read the
// same server state. The dashboard used to hard-code a provider name and could
// contradict the provider card after bring-your-own-provider was configured.
function useEffectiveProvider(): { effective: EffectiveProvider; loaded: boolean } {
  const [effective, setEffective] = useState<EffectiveProvider>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/provider', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as ProviderState;
        if (active) setEffective(payload.effective);
      })
      .catch(() => undefined)
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, []);

  return { effective, loaded };
}

function UsagePanel({ dailyLimit, inputUsage, monthlyLimit, monthlyUsage, outputUsage }: { dailyLimit: number; inputUsage: number; monthlyLimit: number; monthlyUsage: number; outputUsage: number }) {
  const total = inputUsage + outputUsage;
  const percent = dailyLimit ? Math.min(100, Math.round((total / dailyLimit) * 100)) : 0;
  const monthlyPercent = monthlyLimit ? Math.min(100, Math.round((monthlyUsage / monthlyLimit) * 100)) : 0;
  const { effective, loaded } = useEffectiveProvider();
  // Do not guess a provider name while the server response is still pending.
  const providerName = effective ? effective.label : loaded ? 'Not connected' : '—';
  const keyNote = effective
    ? `Messages go out on ${ORIGIN_LABEL[effective.origin]}, which stays on the server and never reaches the browser.`
    : loaded
      ? 'No provider is connected, so the chat cannot reach a model.'
      : 'Checking which provider answers your messages.';
  return <Card className="border-0 bg-white/90 shadow-[0_8px_30px_rgba(24,48,44,.045)] ring-black/6"><CardHeader><CardDescription className="flex items-center gap-2"><Bot className="size-4" /> API usage</CardDescription><CardTitle className="flex items-center gap-2 text-base">Your limits <Badge className="bg-[#dff4ed] text-[#286057]" variant="secondary">FREE</Badge></CardTitle></CardHeader><CardContent className="space-y-5"><div><div className="mb-2 flex items-end justify-between"><div><p className="text-xs text-[#75817e]">Daily limit</p><p className="mt-0.5 text-lg font-semibold">{formatTokens(total)} <span className="text-xs font-normal text-[#88928f]">/ {formatTokens(dailyLimit)}</span></p></div><span className="text-xs font-medium text-[#396b62]">{percent}%</span></div><Progress className="[&_[data-slot=progress-indicator]]:bg-[#2c766a] [&_[data-slot=progress-track]]:h-1.5" value={percent} /></div><div><div className="mb-2 flex items-end justify-between"><div><p className="text-xs text-[#75817e]">Monthly limit</p><p className="mt-0.5 text-sm font-semibold">{formatTokens(monthlyUsage)} <span className="text-xs font-normal text-[#88928f]">/ {formatTokens(monthlyLimit)}</span></p></div><span className="text-xs font-medium text-[#396b62]">{monthlyPercent}%</span></div><Progress className="[&_[data-slot=progress-indicator]]:bg-[#4d8b80] [&_[data-slot=progress-track]]:h-1" value={monthlyPercent} /></div><div className="grid grid-cols-2 gap-3 rounded-xl bg-[#f3f5f2] p-3 text-xs"><div><p className="text-[#7a8582]">Wire format</p><p className="mt-1 font-semibold">OpenAI-compatible</p></div><div><p className="text-[#7a8582]">Provider</p><p className="mt-1 truncate font-semibold" title={providerName}>{providerName}</p></div><div><p className="text-[#7a8582]">Input today</p><p className="mt-1 font-semibold">{formatTokens(inputUsage)}</p></div><div><p className="text-[#7a8582]">Output today</p><p className="mt-1 font-semibold">{formatTokens(outputUsage)}</p></div></div><p className="flex items-start gap-2 text-[11px] leading-4 text-[#7a8582]"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-[#3c756b]" /> {keyNote}</p></CardContent></Card>;
}

type SyncCredential = { id: string; label: string; expiresAt: string; lastUsedAt: string | null };

function SyncAgentPanel({ onNotice }: { onNotice: (message: string) => void }) {
  const [tokens, setTokens] = useState<SyncCredential[]>([]);
  const [rawToken, setRawToken] = useState('');
  const [creating, setCreating] = useState(false);
  useEffect(() => { fetch('/api/sync/token', { cache: 'no-store' }).then(async (response) => { if (response.ok) setTokens(((await response.json()) as { tokens: SyncCredential[] }).tokens); }).catch(() => undefined); }, []);
  async function createToken() {
    setCreating(true); setRawToken('');
    try {
      const response = await fetch('/api/sync/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: `Windows · ${new Date().toLocaleDateString('en-US')}` }) });
      const payload = (await response.json()) as { token?: string; credential?: SyncCredential; error?: string };
      if (!response.ok || !payload.token || !payload.credential) throw new Error(payload.error ?? 'Could not create an agent key.');
      setRawToken(payload.token); setTokens((current) => [payload.credential!, ...current]);
      onNotice('Agent key created. It is shown only once.');
    } catch (error) { onNotice(error instanceof Error ? error.message : 'Could not create an agent key.'); }
    finally { setCreating(false); }
  }
  async function revoke(id: string) {
    const response = await fetch('/api/sync/token', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    if (response.ok) { setTokens((current) => current.filter((token) => token.id !== id)); setRawToken(''); onNotice('Agent key revoked.'); }
  }
  return <Card className="border-0 bg-white/90 shadow-none ring-black/6"><CardHeader><CardTitle className="flex items-center gap-1.5 text-base">Local folder<Hint text="An agent key lets one machine upload and delete files in projects you can edit. It grants no model access and is shown once, because the server keeps only its hash. Revoking it stops that machine immediately." /></CardTitle><CardDescription>The agent copies changed files only to the selected project.</CardDescription></CardHeader><CardContent className="space-y-3"><a className="inline-flex h-8 items-center gap-2 rounded-lg border border-black/10 bg-white px-3 text-xs font-medium hover:bg-black/[0.03]" download href="/meshkeep-sync.ps1"><Download className="size-3.5" /> Download Windows agent</a><Button disabled={creating} onClick={() => void createToken()} size="sm" variant="outline"><KeyRound /> {creating ? 'Creating…' : 'New agent key'}</Button>{rawToken && <div className="rounded-xl border border-amber-700/10 bg-amber-50 p-3"><p className="mb-2 text-[11px] leading-4 text-amber-900/75">Copy it now. The key will not be shown again and grants no model access.</p><div className="flex gap-2"><Input aria-label="Sync agent key" className="h-8 min-w-0 bg-white text-[10px]" readOnly value={rawToken} /><Button onClick={() => { void navigator.clipboard.writeText(rawToken); onNotice('Agent key copied.'); }} size="icon-sm" type="button" variant="outline"><Copy /></Button></div></div>}{tokens.map((token) => <div className="flex items-center gap-2 rounded-lg bg-[#f4f6f3] px-3 py-2 text-[11px]" key={token.id}><div className="min-w-0 flex-1"><p className="truncate font-medium">{token.label}</p><p className="text-[#7c8784]">expires {new Date(token.expiresAt).toLocaleDateString('en-US')}</p></div><Button aria-label={`Revoke ${token.label}`} onClick={() => void revoke(token.id)} size="icon-xs" variant="ghost"><Trash2 /></Button></div>)}</CardContent></Card>;
}

function MemberRow({ member, colorIndex, isOwnerView, currentMemberId, onChanged, onNotice }: { member: TeamMember; colorIndex: number; isOwnerView: boolean; currentMemberId: string; onChanged: () => void; onNotice: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [daily, setDaily] = useState(String(member.dailyTokens ?? DEFAULT_DAILY_TOKENS));
  const [monthly, setMonthly] = useState(String(member.monthlyTokens ?? DEFAULT_MONTHLY_TOKENS));
  const [busy, setBusy] = useState(false);

  const initials = member.displayName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toLocaleUpperCase('pl');
  const suspended = member.status === 'suspended';
  // Ownera nie da się zawiesić po stronie serwera, więc panel nawet nie
  // pokazuje takiej możliwości — inaczej kusiłby przyciskiem, który zwraca błąd.
  const canModerate = isOwnerView && member.role !== 'owner' && member.id !== currentMemberId;

  async function patch(body: Record<string, unknown>, message: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/team/members/${member.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Could not save the change.');
      onChanged();
      onNotice(message);
    } catch (error) { onNotice(error instanceof Error ? error.message : 'Could not save the change.'); }
    finally { setBusy(false); }
  }

  function toggleSuspension() {
    if (suspended) { void patch({ status: 'active' }, `${member.displayName} can access the service again. Existing sessions remain revoked; send a reconnect link.`); return; }
    if (!window.confirm(`Suspend “${member.displayName}”? Sessions and agent keys will be revoked. Access returns only after reactivation and a new reconnect link.`)) return;
    void patch({ status: 'suspended' }, `${member.displayName} was suspended. Sessions and agent keys were revoked.`);
  }

  function saveLimits() {
    const dailyTokens = parseLimitInput(daily, 'dailyTokens');
    const monthlyTokens = parseLimitInput(monthly, 'monthlyTokens');
    if (dailyTokens === null || monthlyTokens === null) { onNotice('Limits must be whole numbers within the allowed range.'); return; }
    if (!limitsAreCoherent(dailyTokens, monthlyTokens)) { onNotice('The monthly limit cannot be lower than the daily limit.'); return; }
    void patch({ dailyTokens, monthlyTokens }, `Limits saved for ${member.displayName}.`);
  }

  return <div className="rounded-xl border border-black/6 bg-white/60 p-2">
    <div className="flex items-center gap-3">
      <Avatar className={['bg-[#d7ece7]', 'bg-[#f1e4d7]', 'bg-[#e5e1f1]', 'bg-[#dfe7f1]'][colorIndex % 4]} size="sm"><AvatarFallback className="bg-transparent text-[9px] font-semibold">{initials}</AvatarFallback></Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{member.displayName}{member.id === currentMemberId && <span className="ml-1 text-[11px] font-normal text-[#818b89]">(to Ty)</span>}</p>
        <p className="text-[11px] text-[#818b89]">{member.role === 'owner' ? 'Owner' : 'Member'}{suspended && ' · suspended'}{member.apiEnabled === false && ' · API disabled'}</p>
      </div>
      {isOwnerView && <Button aria-label={`Limits for ${member.displayName}`} onClick={() => setOpen((value) => !value)} size="icon-xs" title="Token limits" variant="ghost"><SlidersHorizontal /></Button>}
      {canModerate && <Button aria-label={suspended ? `Reactivate ${member.displayName}` : `Suspend ${member.displayName}`} disabled={busy} onClick={toggleSuspension} size="icon-xs" title={suspended ? 'Restore access' : 'Suspend account'} variant="ghost">{suspended ? <UserCheck /> : <Ban />}</Button>}
      <span className={cn('size-2 shrink-0 rounded-full', suspended ? 'bg-red-400' : 'bg-emerald-400')} />
    </div>
    {open && isOwnerView && <div className="mt-2 space-y-2 border-t border-black/6 pt-2">
      <div className="flex gap-2">
        <div className="flex-1"><label className="text-[11px] text-[#7a8582]" htmlFor={`limit-daily-${member.id}`}>Daily</label>
          <Input className="mt-1 h-8 bg-white text-xs" id={`limit-daily-${member.id}`} inputMode="numeric" onChange={(event) => setDaily(event.target.value)} value={daily} /></div>
        <div className="flex-1"><label className="text-[11px] text-[#7a8582]" htmlFor={`limit-monthly-${member.id}`}>Monthly</label>
          <Input className="mt-1 h-8 bg-white text-xs" id={`limit-monthly-${member.id}`} inputMode="numeric" onChange={(event) => setMonthly(event.target.value)} value={monthly} /></div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-[11px] text-[#7a8582]">
          <input checked={member.apiEnabled !== false} disabled={busy} onChange={(event) => void patch({ apiEnabled: event.target.checked }, event.target.checked ? `Model access enabled for ${member.displayName}.` : `Model access disabled for ${member.displayName}.`)} type="checkbox" />
          Model access
        </label>
        <Button disabled={busy} onClick={saveLimits} size="sm" variant="outline">{busy ? '…' : 'Save limits'}</Button>
      </div>
    </div>}
  </div>;
}

function TeamPanel({ members, pendingInvites, reconnectLinks, capacity, canInvite, currentMemberId, onTeamChanged, onNotice }: { members: TeamMember[]; pendingInvites: PendingInvite[]; reconnectLinks: PendingInvite[]; capacity: TeamCapacity; canInvite: boolean; currentMemberId: string; onTeamChanged: () => void; onNotice: (message: string) => void }) {
  const [email, setEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [inviteKind, setInviteKind] = useState<'invite' | 'reconnect'>('invite');
  const used = capacity.used;
  const memberEmails = new Set(members.map((member) => member.email).filter((value): value is string => Boolean(value)));
  const isReconnect = memberEmails.has(email.trim().toLocaleLowerCase('en-US'));
  async function invite() {
    const normalized = email.trim();
    if (!normalized || inviting) return;
    setInviting(true);
    try {
      const response = await fetch('/api/team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: normalized }) });
      const payload = (await response.json()) as { invite?: { id: string; email: string; expiresInDays: number; joinPath: string; kind?: 'invite' | 'reconnect' }; error?: string };
      if (!response.ok || !payload.invite) throw new Error(payload.error ?? 'Could not create the invitation.');
      if (!payload.invite.joinPath.startsWith('/join?token=')) throw new Error('The server returned an invalid invitation link.');
      const kind = payload.invite.kind ?? 'invite';
      setInviteKind(kind);
      setInviteLink(new URL(payload.invite.joinPath, window.location.origin).toString());
      setEmail('');
      onTeamChanged();
      onNotice(kind === 'reconnect' ? 'The reconnect link is ready. It restores the existing account without using another seat.' : 'The one-time link is ready. Copy it and send it directly to the invitee.');
    } catch (error) { onNotice(error instanceof Error ? error.message : 'Could not invite this person.'); }
    finally { setInviting(false); }
  }
  async function revokeInvite(inviteId: string) {
    try {
      const response = await fetch('/api/team', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: inviteId }) });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Could not revoke the invitation.');
      onTeamChanged();
      onNotice('Invitation revoked. The seat is available again.');
    } catch (error) { onNotice(error instanceof Error ? error.message : 'Could not revoke the invitation.'); }
  }
  return <Card className="border-0 bg-white/90 shadow-none ring-black/6"><CardHeader><CardTitle className="flex items-center gap-1.5 text-base">Team<Hint text="Reusing an email that already belongs to a member creates a reconnect link rather than a second account, and takes no extra seat. Revoking an unused invitation frees its seat immediately." /></CardTitle><CardDescription>{used} of {capacity.total} seats used or reserved</CardDescription></CardHeader><CardContent className="space-y-3">{members.map((member, index) => <MemberRow key={member.id} colorIndex={index} currentMemberId={currentMemberId} isOwnerView={canInvite} member={member} onChanged={onTeamChanged} onNotice={onNotice} />)}{pendingInvites.map((invite) => <div className="flex items-center gap-3 text-xs" key={invite.id}><Avatar className="bg-stone-100" size="sm"><AvatarFallback className="bg-transparent text-[9px]">?</AvatarFallback></Avatar><div className="min-w-0 flex-1"><p className="truncate font-medium">{invite.email}</p><p className="text-[11px] text-[#929b98]">Waiting for link use · expires {new Date(invite.expiresAt).toLocaleDateString('en-US')}</p></div>{canInvite ? <Button aria-label={`Revoke invitation for ${invite.email}`} onClick={() => void revokeInvite(invite.id)} size="icon-xs" title="Revoke invitation and release seat" variant="ghost"><Trash2 /></Button> : <span className="size-2 rounded-full bg-amber-300" />}</div>)}{reconnectLinks.map((link) => <div className="flex items-center gap-3 text-xs" key={link.id}><Avatar className="bg-sky-50" size="sm"><AvatarFallback className="bg-transparent text-[9px]">↻</AvatarFallback></Avatar><div className="min-w-0 flex-1"><p className="truncate font-medium">{link.email}</p><p className="text-[11px] text-[#929b98]">Unused reconnect link · does not use a seat</p></div><Button aria-label={`Invalidate reconnect link for ${link.email}`} onClick={() => void revokeInvite(link.id)} size="icon-xs" title="Invalidate link" variant="ghost"><Trash2 /></Button></div>)}{canInvite && <form className="space-y-2 pt-2" onSubmit={(event) => { event.preventDefault(); void invite(); }}><div className="flex gap-2"><Input aria-label="Invitee email" className="h-8 min-w-0 text-xs" onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" type="email" value={email} /><Button disabled={!email.trim() || inviting} size="sm" type="submit">{inviting ? '…' : isReconnect ? 'Reconnect' : 'Invite'}</Button></div><p className="text-[10px] leading-4 text-[#8b9491]">{isReconnect ? 'This address already belongs to a member. You will receive a reconnect link for the existing account.' : used >= capacity.total ? 'All seats are occupied. Revoke an invitation above or enter an existing member’s address.' : 'A new invitation reserves one available seat.'}</p></form>}{canInvite && inviteLink && <div className="rounded-xl border border-emerald-800/10 bg-emerald-50 p-3"><p className="mb-2 text-[11px] leading-4 text-emerald-900/75">{inviteKind === 'reconnect' ? 'Reconnect link for an existing account. Treat it like a password and send it directly.' : 'This is a one-time link. Send it directly to your teammate and never publish it.'}</p><div className="flex gap-2"><Input aria-label="One-time invitation link" className="h-8 min-w-0 bg-white text-[10px]" readOnly value={inviteLink} /><Button onClick={() => { void navigator.clipboard.writeText(inviteLink); onNotice('Invitation link copied.'); }} size="icon-sm" title="Copy link" type="button" variant="outline"><Copy /></Button></div></div>}</CardContent></Card>;
}

type ConversationRow = { id: string; title: string; updatedAt: string; projectId: string; projectName: string; projectVisibility: Visibility; messageCount: number };

function ViewPlaceholder({ icon: Icon, title, detail }: { icon: typeof Folder; title: string; detail: string }) {
  return <div className="rounded-2xl border border-dashed border-black/10 bg-white/50 p-12 text-center"><Icon className="mx-auto mb-3 text-[#6f7b78]" /><p className="font-medium">{title}</p><p className="mt-1 text-sm text-[#75817e]">{detail}</p></div>;
}

function ConversationsView({ onOpenConversation, onNotice, query }: { onOpenConversation: (projectId: string, conversationId: string) => void; onNotice: (message: string) => void; query: string }) {
  const [rows, setRows] = useState<ConversationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/conversations', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load conversations.');
        const payload = (await response.json()) as { conversations: ConversationRow[] };
        if (active) setRows(payload.conversations);
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Could not load conversations.'); });
    return () => { active = false; };
  }, []);

  // Conversations nie da się odzyskać, a jej tytuł to początek pierwszej messages,
  // więc w potwierdzeniu pokazujemy dokładnie to, co zniknie.
  async function deleteConversation(row: ConversationRow) {
    if (deletingId) return;
    if (!window.confirm(`Delete “${row.title}” with ${row.messageCount} messages? This cannot be undone.`)) return;
    setDeletingId(row.id);
    try {
      const response = await fetch(`/api/projects/${row.projectId}/conversations?conversationId=${row.id}`, { method: 'DELETE' });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? 'Could not delete the conversation.');
      }
      setRows((current) => (current ?? []).filter((item) => item.id !== row.id));
      onNotice('Conversation deleted.');
    } catch (caught) { onNotice(caught instanceof Error ? caught.message : 'Could not delete the conversation.'); }
    finally { setDeletingId(null); }
  }

  const needle = query.trim().toLocaleLowerCase('pl');
  const visible = (rows ?? []).filter((row) => !needle || `${row.title} ${row.projectName}`.toLocaleLowerCase('pl').includes(needle));

  if (error) return <ViewPlaceholder detail={error} icon={MessageSquareText} title="Something went wrong" />;
  if (!rows) return <ViewPlaceholder detail="This may take a moment." icon={Loader2} title="Loading conversations…" />;
  if (!rows.length) return <ViewPlaceholder detail="Open a project and send the first message. It will appear here." icon={MessageSquareText} title="No conversations yet" />;
  if (!visible.length) return <ViewPlaceholder detail="Change the search term above." icon={Search} title="No search results" />;

  return <section aria-label="Conversations" className="space-y-2">
    <p className="mb-4 text-sm text-[#75817e]">{visible.length === rows.length ? `${rows.length} ${rows.length === 1 ? 'conversation' : 'conversations'}` : `${visible.length} of ${rows.length} conversations`}</p>
    {visible.map((row) => <div className="flex items-center gap-1 rounded-xl border border-black/7 bg-white/85 pr-2 transition hover:border-black/15 hover:bg-white" key={row.id}>
      <button className="flex min-w-0 flex-1 items-center gap-4 rounded-xl px-4 py-3 text-left" onClick={() => onOpenConversation(row.projectId, row.id)} type="button">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#e6f3ef] text-[#2c5b54]"><MessageSquareText className="size-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{row.title}</span>
          <span className="mt-0.5 block truncate text-[11px] text-[#818b89]">{row.projectName} · {visibilityLabels[row.projectVisibility]} · {row.messageCount} {row.messageCount === 1 ? 'message' : 'messages'}</span>
        </span>
        <span className="shrink-0 text-[11px] text-[#87918f]">{relativeDate(row.updatedAt)}</span>
      </button>
      <Button aria-label={`Delete conversation ${row.title}`} disabled={deletingId === row.id} onClick={() => void deleteConversation(row)} size="icon-sm" title="Delete conversation" variant="ghost"><Trash2 /></Button>
    </div>)}
  </section>;
}

type UsagePayload = {
  historyDays: number;
  limits: { dailyTokens: number; monthlyTokens: number; enabled: boolean };
  today: { inputTokens: number; outputTokens: number; requests: number };
  month: { inputTokens: number; outputTokens: number; requests: number };
  byDay: Array<{ day: string; inputTokens: number; outputTokens: number; requests: number }>;
  byModel: Array<{ model: string; label: string; inputTokens: number; outputTokens: number; requests: number }>;
  // Pusta dla każdego poza ownerem — serwer w ogóle nie liczy tych wierszy.
  team: Array<{ memberId: string; displayName: string; role: 'owner' | 'member'; status: 'active' | 'suspended'; dailyTokens: number | null; monthlyTokens: number | null; apiEnabled: boolean | null; todayTokens: number; monthTokens: number; monthRequests: number }>;
};

type ProviderSummary = { label: string; baseUrl: string; keyPreview: string; modelCount: number } | null;
type ProviderState = {
  mine: ProviderSummary;
  team: ProviderSummary;
  canSetTeam: boolean;
  effective: EffectiveProvider;
};

function ProviderCard({ onNotice, onChanged }: { onNotice: (message: string) => void; onChanged: () => void }) {
  const [state, setState] = useState<ProviderState | null>(null);
  const [label, setLabel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [forTeam, setForTeam] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const response = await fetch('/api/provider', { cache: 'no-store' });
    if (response.ok) setState((await response.json()) as ProviderState);
  }
  // Ten sam wzorzec, co pozostale pobrania w tym pliku: flaga `active` chroni
  // przed zapisem stanu po odmontowaniu, a setState dzieje sie w wywolaniu
  // zwrotnym obietnicy, nie w ciele efektu.
  useEffect(() => {
    let active = true;
    fetch('/api/provider', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as ProviderState;
        if (active) setState(payload);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  async function save() {
    setBusy(true); setError(null);
    try {
      const response = await fetch('/api/provider', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, baseUrl, apiKey, scope: forTeam ? 'team' : 'mine' }),
      });
      const payload = (await response.json()) as { error?: string; modelCount?: number };
      if (!response.ok) throw new Error(payload.error ?? 'Could not save the provider.');
      // The key is never echoed back, so there is nothing to keep in the form.
      setApiKey('');
      onNotice(`Provider connected. ${payload.modelCount ?? 0} models available.`);
      await load();
      onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save the provider.'); }
    finally { setBusy(false); }
  }

  async function remove(scope: 'mine' | 'team') {
    if (!window.confirm(scope === 'team' ? 'Remove the provider for the whole team?' : 'Remove your own provider and fall back to the team default?')) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/provider?scope=${scope}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Could not remove the provider.');
      onNotice('Provider removed.');
      await load();
      onChanged();
    } catch (caught) { onNotice(caught instanceof Error ? caught.message : 'Could not remove the provider.'); }
    finally { setBusy(false); }
  }

  if (!state) return null;

  const field = 'h-9 w-full rounded-lg border border-black/10 bg-white px-2 text-xs outline-none focus:ring-2 focus:ring-[#4d8b80]/30';

  return <Card className="border-0 bg-white/90 shadow-none ring-black/6">
    <CardHeader>
      <CardTitle className="flex items-center gap-1.5 text-base">Model provider
        <Hint text="Any service that speaks the OpenAI format works: OpenAI, OpenRouter, Groq, Together, Mistral, or a model running on your own machine. Your key is stored on the server, never sent to the browser and never included in a backup." />
      </CardTitle>
      <CardDescription>
        {state.effective
          ? <>Messages currently go to <b>{state.effective.label}</b> using {ORIGIN_LABEL[state.effective.origin]}, with {state.effective.modelCount} models available.</>
          : 'No provider is connected, so the chat cannot reach a model.'}
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-3">
      {[['Yours', state.mine, 'mine'] as const, ['Team default', state.team, 'team'] as const].map(([title, summary, scope]) => summary && (
        <div className="flex items-center gap-2 rounded-lg bg-[#f4f6f3] px-3 py-2 text-[11px]" key={scope}>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{title}: {summary.label}</p>
            <p className="truncate text-[#7c8784]">{summary.baseUrl} · key {summary.keyPreview} · {summary.modelCount} models</p>
          </div>
          {(scope === 'mine' || state.canSetTeam) && <Button aria-label={`Remove ${title}`} disabled={busy} onClick={() => void remove(scope)} size="icon-xs" variant="ghost"><Trash2 /></Button>}
        </div>
      ))}

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-[11px] font-medium" htmlFor="provider-label">Name
          <input className={field} id="provider-label" maxLength={60} onChange={(event) => setLabel(event.target.value)} placeholder="OpenRouter" value={label} />
        </label>
        <label className="text-[11px] font-medium" htmlFor="provider-url">Base URL
          <input className={field} id="provider-url" maxLength={400} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://openrouter.ai/api/v1" value={baseUrl} />
        </label>
      </div>
      <label className="block text-[11px] font-medium" htmlFor="provider-key">API key
        {/* type=password so a shoulder or a screen share does not reveal it. */}
        <input autoComplete="off" className={field} id="provider-key" maxLength={400} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-…" type="password" value={apiKey} />
      </label>
      {state.canSetTeam && <label className="flex items-center gap-2 text-[11px]">
        <input checked={forTeam} onChange={(event) => setForTeam(event.target.checked)} type="checkbox" />
        Use for the whole team instead of only me
      </label>}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-[11px] text-red-700">{error}</p>}
      <Button className="bg-[#173d38] text-white hover:bg-[#23534c]" disabled={busy || !label.trim() || !baseUrl.trim() || apiKey.trim().length < 8} onClick={() => void save()} size="sm">
        {busy ? 'Checking…' : 'Connect provider'}
      </Button>
      <p className="text-[10px] leading-4 text-[#7b8582]">The key is verified against the provider before it is stored, so a wrong one is reported here rather than at your first message.</p>
    </CardContent>
  </Card>;
}

function KillSwitchCard({ onNotice }: { onNotice: (message: string) => void }) {
  const [blocked, setBlocked] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/admin/settings', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as { apiKillSwitch?: boolean };
        if (active) setBlocked(Boolean(payload.apiKillSwitch));
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  async function toggle(next: boolean) {
    const previous = blocked;
    setBlocked(next);
    try {
      const response = await fetch('/api/admin/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKillSwitch: next }) });
      if (!response.ok) throw new Error();
      onNotice(next ? 'Models disabled for the entire team.' : 'Model access restored.');
    } catch { setBlocked(previous); onNotice('Could not update the setting.'); }
  }

  if (blocked === null) return null;

  return <Card className={cn('border-0 shadow-none ring-black/6', blocked ? 'bg-red-50' : 'bg-white/90')}>
    <CardHeader>
      <CardDescription className="flex items-center gap-2"><ShieldCheck className="size-4" /> Owner controls</CardDescription>
      <CardTitle className="flex items-center gap-1.5 text-base">Emergency model cutoff<Hint text="Blocks model requests for everyone, including you. Nothing is deleted: projects, files, conversations and the log stay untouched, and the rest of the app keeps working." /></CardTitle>
      <CardAction><Switch aria-label="Emergency model access cutoff" checked={blocked} onCheckedChange={(value) => void toggle(value)} /></CardAction>
    </CardHeader>
    <CardContent>
      <p className="text-sm leading-6 text-[#63706d]">{blocked
        ? 'Model requests are blocked for the entire team, including you. Projects, files and history remain available.'
        : 'Models are available. This switch blocks every model request immediately without changing stored data.'}</p>
    </CardContent>
  </Card>;
}

function BackupCard({ onNotice }: { onNotice: (message: string) => void }) {
  const [check, setCheck] = useState<{ inDatabase: number; inStorage: number; missingInStorage: string[]; orphanInStorage: string[]; truncated: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function verifyStorage() {
    setBusy(true);
    try {
      const response = await fetch('/api/admin/backup', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      if (!response.ok) throw new Error('Could not verify file storage.');
      setCheck(await response.json());
    } catch (error) { onNotice(error instanceof Error ? error.message : 'Could not verify file storage.'); }
    finally { setBusy(false); }
  }

  return <Card className="border-0 bg-white/90 shadow-none ring-black/6">
    <CardHeader>
      <CardDescription className="flex items-center gap-2"><Download className="size-4" /> Owner controls</CardDescription>
      <CardTitle className="flex items-center gap-1.5 text-base">Backup<Hint text="Sessions, invitation and agent-key hashes, and the stored file bytes are deliberately excluded. After restoring you issue new links and keys, so the old ones stay dead. Checksums show which files are missing." /></CardTitle>
    </CardHeader>
    <CardContent className="space-y-3">
      <p className="text-sm leading-6 text-[#63706d]">Exports the entire database as JSON: accounts, projects, permissions, conversations, messages, usage and audit events. <b>Stored files are excluded</b>; only metadata and checksums are included. Sessions and token hashes are deliberately omitted, so restored data requires new links and agent keys.</p>
      <div className="flex flex-wrap gap-2">
        <Button className="h-9 rounded-xl border-black/8 bg-white px-3" onClick={() => { window.location.href = '/api/admin/backup'; onNotice('Backup download started. Store it away from this computer.'); }} variant="outline"><Download /> Download database backup</Button>
        <Button className="h-9 rounded-xl border-black/8 bg-white px-3" disabled={busy} onClick={() => void verifyStorage()} variant="outline">{busy ? 'Checking…' : 'Verify file consistency'}</Button>
      </div>
      {check && <div className="rounded-xl bg-[#f3f5f2] p-3 text-xs leading-5">
        <p><b>{check.inDatabase}</b> files w bazie · <b>{check.inStorage}</b> objects in storage{check.truncated && ' (list truncated at 1,000)'}</p>
        {check.missingInStorage.length === 0 && check.orphanInStorage.length === 0
          ? <p className="mt-1 text-[#3c756b]">Database and storage are consistent.</p>
          : <>
            {check.missingInStorage.length > 0 && <p className="mt-1 text-red-700">Missing from storage ({check.missingInStorage.length}): {check.missingInStorage.slice(0, 5).join(', ')}{check.missingInStorage.length > 5 && ' …'}</p>}
            {check.orphanInStorage.length > 0 && <p className="mt-1 text-amber-800">Orphaned objects ({check.orphanInStorage.length}) — take up space but have no database reference.</p>}
          </>}
      </div>}
    </CardContent>
  </Card>;
}

type AuditRow = { id: string; actorLabel: string; action: string; targetType: string | null; targetLabel: string | null; detail: string | null; createdAt: string };

// Szczegoly przychodza jako JSON zapisany przez `serializeDetail` - zawsze
// plaski obiekt prostych wartosci. Renderujemy je po ludzku, ale gdyby kiedys
// przyszlo cos innego, pokazujemy surowy napis zamiast wywracac widok.
function AuditDetail({ detail }: { detail: string }) {
  let pary: Array<[string, string]> = [];
  try {
    const parsed: unknown = JSON.parse(detail);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      pary = Object.entries(parsed as Record<string, unknown>).map(([klucz, wartosc]) => [klucz.replaceAll('_', ' '), String(wartosc)]);
    }
  } catch { pary = []; }
  if (!pary.length) return <span className="font-mono">{detail}</span>;
  return <>{pary.map(([klucz, wartosc], index) => <span key={klucz}>{index > 0 && ' · '}{klucz}: <b className="font-medium text-[#5c6763]">{wartosc}</b></span>)}</>;
}

function AuditView({ onNotice }: { onNotice: (message: string) => void }) {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtrAkcji, setFiltrAkcji] = useState('wszystkie');
  const [filtrAutora, setFiltrAutora] = useState('wszyscy');

  useEffect(() => {
    let active = true;
    fetch('/api/admin/audit', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load the activity log.');
        const payload = (await response.json()) as { events: AuditRow[] };
        if (active) setRows(payload.events);
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Could not load the activity log.'); });
    return () => { active = false; };
  }, []);

  // Listy do filtrów budujemy z tego, co naprawdę jest w dzienniku. Wypisanie
  // wszystkich możliwych akcji dawałoby pozycje, które nic nie wybierają.
  const obecneAkcje = useMemo(() => [...new Set((rows ?? []).map((row) => row.action))].sort(), [rows]);
  const obecniAutorzy = useMemo(() => [...new Set((rows ?? []).map((row) => row.actorLabel))].sort((a, b) => a.localeCompare(b, 'pl')), [rows]);

  const widoczne = (rows ?? []).filter((row) => {
    if (filtrAutora !== 'wszyscy' && row.actorLabel !== filtrAutora) return false;
    if (filtrAkcji === 'wszystkie') return true;
    if (filtrAkcji === 'wrazliwe') return isSensitiveAction(row.action);
    return row.action === filtrAkcji;
  });

  if (error) return <ViewPlaceholder detail={error} icon={ScrollText} title="Something went wrong" />;
  if (!rows) return <ViewPlaceholder detail="This may take a moment." icon={Loader2} title="Loading activity log…" />;
  if (!rows.length) return <><BackupCard onNotice={onNotice} /><div className="pt-2"><ViewPlaceholder detail="Invitations, suspensions, limit changes and file or project deletions appear here." icon={ScrollText} title="The activity log is empty" /></div></>;

  const klasaPola = 'h-8 rounded-lg border border-black/10 bg-white px-2 text-xs outline-none focus:ring-2 focus:ring-[#4d8b80]/30';

  return <section aria-label="Activity log" className="space-y-2">
    <BackupCard onNotice={onNotice} />
    <div className="flex flex-wrap items-center gap-2 pt-4">
      <label className="text-xs text-[#697572]" htmlFor="activity-event">Event</label>
      <select className={klasaPola} id="activity-event" onChange={(event) => setFiltrAkcji(event.target.value)} value={filtrAkcji}>
        <option value="wszystkie">All</option>
        <option value="wrazliwe">Access-revoking only</option>
        {obecneAkcje.map((akcja) => <option key={akcja} value={akcja}>{AUDIT_LABELS[akcja as AuditAction] ?? akcja}</option>)}
      </select>
      <label className="ml-2 text-xs text-[#697572]" htmlFor="activity-actor">Actor</label>
      <select className={klasaPola} id="activity-actor" onChange={(event) => setFiltrAutora(event.target.value)} value={filtrAutora}>
        <option value="wszyscy">Wszyscy</option>
        {obecniAutorzy.map((autor) => <option key={autor} value={autor}>{autor}</option>)}
      </select>
      {(filtrAkcji !== 'wszystkie' || filtrAutora !== 'wszyscy') && <Button className="h-8 text-xs" onClick={() => { setFiltrAkcji('wszystkie'); setFiltrAutora('wszyscy'); }} size="sm" variant="ghost">Clear filters</Button>}
    </div>
    <p className="pb-2 text-sm text-[#75817e]">{widoczne.length === rows.length ? `${rows.length} ${rows.length === 1 ? 'event' : 'events'} · newest first` : `${widoczne.length} of ${rows.length} events`}</p>
    {widoczne.length === 0
      ? <p className="rounded-xl border border-black/7 bg-white/85 px-4 py-6 text-center text-sm text-[#75817e]">No events match the selected filters.</p>
      : widoczne.map((row) => {
      const wazne = isSensitiveAction(row.action);
      return <div className={cn('flex items-start gap-3 rounded-xl border px-4 py-3', wazne ? 'border-red-800/10 bg-red-50/70' : 'border-black/7 bg-white/85')} key={row.id}>
        <span className={cn('mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg', wazne ? 'bg-red-100 text-red-700' : 'bg-[#eef0ed] text-[#42645e]')}><ScrollText className="size-3.5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{AUDIT_LABELS[row.action as AuditAction] ?? row.action}</p>
          <p className="mt-0.5 text-[11px] text-[#818b89]">
            {row.actorLabel}
            {row.targetLabel && <> · {row.targetLabel}</>}
            {row.detail && <> · <AuditDetail detail={row.detail} /></>}
          </p>
        </div>
        <span className="shrink-0 text-[11px] text-[#87918f]">{new Date(row.createdAt).toLocaleString('pl-PL')}</span>
      </div>;
    })}
  </section>;
}
function UsageView({ dailyLimit, isOwner, monthlyLimit, onNotice }: { dailyLimit: number; isOwner: boolean; monthlyLimit: number; onNotice: (message: string) => void }) {
  const [data, setData] = useState<UsagePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/usage', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load usage.');
        const payload = (await response.json()) as UsagePayload;
        if (active) setData(payload);
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Could not load usage.'); });
    return () => { active = false; };
  }, []);

  if (error) return <ViewPlaceholder detail={error} icon={Activity} title="Something went wrong" />;
  if (!data) return <ViewPlaceholder detail="This may take a moment." icon={Loader2} title="Loading usage…" />;

  const todayTotal = data.today.inputTokens + data.today.outputTokens;
  const monthTotal = data.month.inputTokens + data.month.outputTokens;
  const effectiveDaily = data.limits.dailyTokens || dailyLimit;
  const effectiveMonthly = data.limits.monthlyTokens || monthlyLimit;
  // Skala słupków względem najintensywniejszego dnia — bez tego jeden wyjątkowy
  // dzień spłaszczyłby resztę do niewidoczności.
  const peak = data.byDay.reduce((max, row) => Math.max(max, row.inputTokens + row.outputTokens), 0);

  return <section aria-label="API usage" className="space-y-6">
    <ProviderCard onChanged={() => window.location.reload()} onNotice={onNotice} />
    {isOwner && <KillSwitchCard onNotice={onNotice} />}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard accent detail={`${effectiveDaily ? Math.round((todayTotal / effectiveDaily) * 100) : 0}% of the daily limit`} icon={Gauge} label="Today" value={formatTokens(todayTotal)} />
      <MetricCard detail={`${effectiveMonthly ? Math.round((monthTotal / effectiveMonthly) * 100) : 0}% of the monthly limit`} icon={Activity} label="This month" value={formatTokens(monthTotal)} />
      <MetricCard detail="requests today" icon={Bot} label="Requests" value={String(data.today.requests)} />
      <MetricCard detail={data.limits.enabled ? 'API access enabled' : 'API access disabled'} icon={ShieldCheck} label="Status" value={data.limits.enabled ? 'Active' : 'Paused'} />
    </div>

    {data.team.length > 0 && <Card className="border-0 bg-white/90 shadow-none ring-black/6">
      <CardHeader>
        <CardTitle className="text-base">Team usage</CardTitle>
        <CardDescription>Monthly usage per team member compared with the limit configured in Team. Numbers only; conversation titles and contents are excluded.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">{data.team.map((row) => {
          const limit = row.monthlyTokens ?? 0;
          const udzial = limit ? Math.min(100, Math.round((row.monthTokens / limit) * 100)) : 0;
          // Wyróżniamy dopiero powyżej 80%: niżej pasek i tak wszystko pokazuje,
          // a kolorowanie wszystkiego odbiera kolorowi znaczenie.
          const blisko = limit > 0 && udzial >= 80;
          return <div className="rounded-xl bg-[#f3f5f2] px-3 py-2.5" key={row.memberId}>
            <div className="flex items-center justify-between gap-3 text-xs">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-semibold">{row.displayName}</span>
                {row.role === 'owner' && <Badge className="border-[#387267]/15 bg-[#e4f2ee] px-1.5 py-0 text-[9px] text-[#32665d]" variant="outline">owner</Badge>}
                {row.status === 'suspended' && <Badge className="border-red-800/15 bg-red-50 px-1.5 py-0 text-[9px] text-red-700" variant="outline">suspended</Badge>}
                {row.apiEnabled === false && <Badge className="border-amber-800/15 bg-amber-50 px-1.5 py-0 text-[9px] text-amber-800" variant="outline">API disabled</Badge>}
              </div>
              <div className="flex shrink-0 gap-4 text-right tabular-nums">
                <div><p className="text-[10px] text-[#7a8582]">Today</p><p className="font-medium">{formatTokens(row.todayTokens)}</p></div>
                <div><p className="text-[10px] text-[#7a8582]">Month</p><p className={cn('font-medium', blisko && 'text-red-700')}>{formatTokens(row.monthTokens)}</p></div>
                <div><p className="text-[10px] text-[#7a8582]">Requests</p><p className="font-medium">{row.monthRequests}</p></div>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[#e3e7e2]"><span className={cn('block h-full rounded-full', blisko ? 'bg-red-600' : 'bg-[#2c766a]')} style={{ width: `${udzial}%` }} /></span>
              <span className="shrink-0 text-[10px] tabular-nums text-[#818b89]">{limit ? `${udzial}% of ${formatTokens(limit)}` : 'no limit'}</span>
            </div>
          </div>;
        })}</div>
      </CardContent>
    </Card>}

    <Card className="border-0 bg-white/90 shadow-none ring-black/6">
      <CardHeader><CardTitle className="text-base">Last {data.historyDays} days</CardTitle><CardDescription>Daily input and output token totals.</CardDescription></CardHeader>
      <CardContent>
        {data.byDay.length === 0
          ? <p className="text-sm text-[#75817e]">No usage was recorded during this period.</p>
          : <div className="space-y-1.5">{data.byDay.map((row) => { const total = row.inputTokens + row.outputTokens; return <div className="flex items-center gap-3 text-xs" key={row.day}>
              <span className="w-20 shrink-0 tabular-nums text-[#818b89]">{row.day.slice(5)}</span>
              <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[#eef0ed]"><span className="block h-full rounded-full bg-[#2c766a]" style={{ width: `${peak ? Math.max(2, Math.round((total / peak) * 100)) : 0}%` }} /></span>
              <span className="w-20 shrink-0 text-right tabular-nums font-medium">{formatTokens(total)}</span>
              <span className="w-16 shrink-0 text-right tabular-nums text-[#818b89]">{row.requests} zap.</span>
            </div>; })}</div>}
      </CardContent>
    </Card>

    <Card className="border-0 bg-white/90 shadow-none ring-black/6">
      <CardHeader><CardTitle className="text-base">Models this month</CardTitle><CardDescription>Usage by provider.</CardDescription></CardHeader>
      <CardContent>
        {data.byModel.length === 0
          ? <p className="text-sm text-[#75817e]">No model has been used this month.</p>
          : <div className="space-y-3">{data.byModel.map((row) => <div className="flex items-center justify-between gap-3 rounded-xl bg-[#f3f5f2] px-3 py-2.5 text-xs" key={row.model}>
              <div className="min-w-0"><p className="truncate font-semibold">{row.label}</p><p className="truncate text-[10px] text-[#818b89]">{row.model}</p></div>
              <div className="flex shrink-0 gap-4 text-right tabular-nums">
                <div><p className="text-[10px] text-[#7a8582]">Input</p><p className="font-medium">{formatTokens(row.inputTokens)}</p></div>
                <div><p className="text-[10px] text-[#7a8582]">Output</p><p className="font-medium">{formatTokens(row.outputTokens)}</p></div>
                <div><p className="text-[10px] text-[#7a8582]">Requests</p><p className="font-medium">{row.requests}</p></div>
              </div>
            </div>)}</div>}
      </CardContent>
    </Card>
  </section>;
}

type ChatMessage = { role: 'user' | 'assistant'; content: string };

function ChatWorkspace({ project, models, onClose, onUsage, onFileCountChange, conversationId: openConversationId }: { project: Project; models: ModelOption[]; onClose: () => void; onUsage: (input: number, output: number) => void; onFileCountChange: (count: number) => void; conversationId: string | null }) {
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
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [driveConfigured, setDriveConfigured] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
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
          const listResponse = await fetch(`/api/projects/${project.id}/conversations`, { cache: 'no-store' });
          if (!listResponse.ok || !active) return;
          const list = (await listResponse.json()) as { conversations: Array<{ id: string }> };
          targetId = list.conversations[0]?.id ?? null;
        }
        if (!targetId || !active) return;
        const detailResponse = await fetch(`/api/projects/${project.id}/conversations?conversationId=${targetId}`, { cache: 'no-store' });
        if (!detailResponse.ok || !active) return;
        const detail = (await detailResponse.json()) as { messages: Array<{ role: string; content: string }> };
        if (!active) return;
        setConversationId(targetId);
        setChatMessages(detail.messages.filter((message) => message.role === 'user' || message.role === 'assistant').map((message) => ({ role: message.role as ChatMessage['role'], content: message.content })));
      } catch { /* czat zaczyna od pustej historii */ }
      finally { if (active) setHistoryLoading(false); }
    })();
    return () => { active = false; };
  }, [project.id, openConversationId]);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch(`/api/projects/${project.id}/files`, { cache: 'no-store' }),
      fetch('/api/storage/google-drive/status', { cache: 'no-store' }),
    ]).then(async ([filesResponse, driveResponse]) => {
      if (filesResponse.ok) {
        const payload = (await filesResponse.json()) as { files?: ProjectFile[] };
        if (active) setProjectFiles(payload.files ?? []);
      }
      if (driveResponse.ok) {
        const payload = (await driveResponse.json()) as { configured?: boolean };
        if (active) setDriveConfigured(Boolean(payload.configured));
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [project.id]);

  async function uploadProjectFiles(selected: File[]) {
    if (!selected.length || uploading) return;
    setUploading(true); setError(null);
    try {
      const form = new FormData();
      selected.forEach((file) => form.append('files', file));
      form.append('paths', JSON.stringify(selected.map((file) => file.webkitRelativePath || file.name)));
      const response = await fetch(`/api/projects/${project.id}/files`, { method: 'POST', body: form });
      const payload = (await response.json()) as { files?: ProjectFile[]; error?: string };
      if (!response.ok || !payload.files) throw new Error(payload.error ?? 'Could not add files.');
      setProjectFiles((current) => [...payload.files!, ...current]);
      setSelectedFileIds((current) => [...new Set([...current, ...payload.files!.map((file) => file.id)])].slice(0, 8));
      setConnectionsOpen(true);
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
      const response = await fetch(`/api/files/${file.id}`, { method: 'DELETE' });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? 'Could not delete the file.');
      }
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
    try {
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: project.id, conversationId, model: activeModel, messages: nextMessages.slice(-20), attachmentIds: selectedFileIds, temperature: 0.4, maxTokens: 2048 }) });
      const payload = (await response.json()) as { conversationId?: string; message?: ChatMessage; usage?: { inputTokens: number; outputTokens: number }; error?: string };
      if (!response.ok || !payload.message) throw new Error(payload.error ?? 'The model did not respond.');
      setConversationId(payload.conversationId);
      setChatMessages((current) => [...current, payload.message!]);
      setSelectedFileIds([]);
      onUsage(payload.usage?.inputTokens ?? 0, payload.usage?.outputTokens ?? 0);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not send the message.'); }
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
          {models.map((item) => <option key={item.id} title={item.description} value={item.id}>{item.label}{item.tier === 'free' ? ' · FREE' : ''}</option>)}
        </select>
        <Button aria-label="Start a new conversation" disabled={historyLoading || !chatMessages.length} onClick={startNewConversation} size="icon" title="New conversation" variant="ghost"><MessageSquarePlus /></Button>
        <Button aria-label="Close chat" onClick={onClose} size="icon" variant="ghost"><X /></Button>
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-10">
        {chatMessages.length === 0 ? <div className="mx-auto grid h-full max-w-lg place-content-center text-center"><span className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-[#dff4ed] text-[#2f6e63]"><Bot /></span><h3 className="text-xl font-semibold tracking-tight">What would you like to work on?</h3><p className="mt-2 text-sm leading-6 text-[#707c79]">Ask about code, analyze a project or attach specific files. The model receives this conversation and only the text files you explicitly select.</p></div> : <div className="mx-auto max-w-3xl space-y-5">{chatMessages.map((message, index) => <div className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')} key={`${message.role}-${index}`}><div className={cn('max-w-[88%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6', message.role === 'user' ? 'rounded-br-md bg-[#173d38] text-white' : 'rounded-bl-md border border-black/6 bg-white text-[#25322f] shadow-sm')}>{message.content}</div></div>)}{sending && <div className="flex items-center gap-2 text-sm text-[#65716e]"><Loader2 className="size-4 animate-spin" /> Model is responding…</div>}</div>}
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

function CreateProjectDialog({ name, visibility, storageProvider, driveConfigured, importedFile, saving, members, shares, onNameChange, onVisibilityChange, onStorageProviderChange, onSharesChange, onCreate, onClose }: { name: string; visibility: Visibility; storageProvider: StorageProvider; driveConfigured: boolean; importedFile: string | null; saving: boolean; members: TeamMember[]; shares: ProjectShare[]; onNameChange: (value: string) => void; onVisibilityChange: (value: Visibility) => void; onStorageProviderChange: (value: StorageProvider) => void; onSharesChange: (value: ProjectShare[]) => void; onCreate: () => void; onClose: () => void }) {
  return <dialog aria-labelledby="create-project-title" className="fixed inset-0 z-[70] m-0 grid h-screen max-h-none w-screen max-w-none place-items-center bg-[#081714]/55 p-4 backdrop-blur-sm" open><button aria-label="Close dialog" className="absolute inset-0" onClick={onClose} type="button" /><Card className="relative z-10 max-h-[94vh] w-full max-w-lg overflow-y-auto border-0 bg-[#fbfcfa] shadow-2xl ring-white/20"><CardHeader className="border-b border-black/6 pb-4"><CardTitle id="create-project-title" className="text-xl">New project</CardTitle><CardDescription>Only you can access it by default.</CardDescription><CardAction><Button aria-label="Close" onClick={onClose} size="icon-sm" variant="ghost"><X /></Button></CardAction></CardHeader><CardContent className="space-y-5 pt-1"><label className="block text-sm font-medium" htmlFor="project-name">Project name</label><Input autoFocus className="-mt-3 h-10 bg-white" id="project-name" maxLength={80} onChange={(e) => onNameChange(e.target.value)} placeholder="e.g. Client research assistant" value={name} /><fieldset><legend className="mb-2 text-sm font-medium">Who can view this project?</legend><div className="grid gap-2 sm:grid-cols-3">{(['private', 'selected', 'team'] as Visibility[]).map((item) => <button key={item} className={cn('rounded-xl border p-3 text-left transition', visibility === item ? 'border-[#3b786d] bg-[#e6f3ef] ring-2 ring-[#3b786d]/10' : 'border-black/8 bg-white hover:border-black/20')} onClick={() => onVisibilityChange(item)} type="button">{item === 'private' ? <LockKeyhole className="mb-2 size-4" /> : <Users className="mb-2 size-4" />}<span className="block text-xs font-semibold">{visibilityLabels[item]}</span></button>)}</div>{visibility === 'selected' && <div className="mt-3 rounded-xl border border-black/7 bg-white p-3"><p className="mb-2 text-xs font-medium">Select people and their roles</p>{members.length ? <div className="space-y-2">{members.map((member) => { const share = shares.find((item) => item.memberId === member.id); return <div className="flex items-center gap-2 text-xs" key={member.id}><label className="flex min-w-0 flex-1 items-center gap-2"><input checked={Boolean(share)} onChange={(event) => onSharesChange(event.target.checked ? [...shares, { memberId: member.id, role: 'editor' }] : shares.filter((item) => item.memberId !== member.id))} type="checkbox" /><span className="truncate">{member.displayName}</span></label>{share && <select aria-label={`Role for ${member.displayName}`} className="rounded-md border border-black/10 bg-white px-2 py-1" onChange={(event) => onSharesChange(shares.map((item) => item.memberId === member.id ? { ...item, role: event.target.value as 'reader' | 'editor' } : item))} value={share.role}><option value="reader">Reader</option><option value="editor">Editor</option></select>}</div>; })}</div> : <p className="text-xs text-[#818b89]">Invite a team member first.</p>}</div>}</fieldset><fieldset><legend className="mb-2 text-sm font-medium">Project storage</legend><div className="grid grid-cols-2 gap-2"><button className={cn('rounded-xl border p-3 text-left text-xs', storageProvider === 'r2' ? 'border-[#3b786d] bg-[#e6f3ef]' : 'border-black/8 bg-white')} onClick={() => onStorageProviderChange('r2')} type="button"><Cloud className="mb-2 size-4" /><b>Private cloud</b><span className="mt-1 block text-[#74807d]">Application R2</span></button><button className={cn('rounded-xl border p-3 text-left text-xs', storageProvider === 'google_drive' ? 'border-[#3b786d] bg-[#e6f3ef]' : 'border-black/8 bg-white', !driveConfigured && 'cursor-not-allowed opacity-50')} disabled={!driveConfigured} onClick={() => onStorageProviderChange('google_drive')} type="button"><HardDrive className="mb-2 size-4" /><b>Google Drive</b><span className="mt-1 block text-[#74807d]">{driveConfigured ? 'Copy in a Drive folder' : 'OAuth required'}</span></button></div></fieldset>{importedFile && <div className="flex items-center gap-3 rounded-xl border border-[#3b786d]/15 bg-[#e8f4f0] p-3 text-sm"><FileArchive className="size-5 text-[#386c63]" /><div className="flex-1"><p className="font-medium">Import ready</p><p className="text-xs text-[#65716e]">Selected: {importedFile}</p></div></div>}<div className="rounded-xl border border-amber-700/10 bg-amber-50 p-3 text-xs leading-5 text-amber-900/75">Your computer folder is never shared directly. Only files you explicitly select are uploaded.</div></CardContent><CardFooter className="justify-end gap-2 border-black/6 bg-black/[0.015] py-4"><Button disabled={saving} onClick={onClose} variant="ghost">Cancel</Button><Button className="bg-[#173d38] text-white hover:bg-[#23534c]" disabled={!name.trim() || saving || (visibility === 'selected' && shares.length === 0)} onClick={onCreate}>{saving ? 'Saving…' : 'Create project'}</Button></CardFooter></Card></dialog>;
}

function relativeDate(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return 'niedawno';
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

function formatTokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 1 })}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

function formatBytes(value: number) {
  if (value >= 1_048_576) return `${(value / 1_048_576).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}
