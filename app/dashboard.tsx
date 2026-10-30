'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Files, Folder, Gauge, LockKeyhole, Menu, MessageSquareText, LogOut, Plus, Search, Settings2, ShieldCheck, UploadCloud } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, ApiRequestError } from '@/lib/api-client';
import type { Visibility } from '@/lib/contracts/common';
import type { ConversationSummary } from '@/lib/contracts/conversations';
import type { ProjectShare, StorageProvider } from '@/lib/contracts/projects';
import type { ProviderModel } from '@/lib/contracts/providers';
import type { SearchResults } from '@/lib/contracts/search';
import type { PendingInvite, TeamMember } from '@/lib/contracts/team';
import { type ChatTarget, chatSearch, DEFAULT_SECTION, DEFAULT_SETTINGS_SECTION, isSettingsSection, NEW_CONVERSATION, parseChatTarget, SECTION_LABELS, type Section, sectionFromLocation, sectionPath, sectionSearch } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { MetricCard } from '@/components/metric-card';
import { ViewPlaceholder } from '@/components/view-placeholder';
import { ChatWorkspace } from '@/features/chat/chat-workspace';
import { ConversationsView } from '@/features/conversations/conversations-view';
import { AuditView } from '@/features/owner/audit-view';
import { CreateProjectDialog } from '@/features/projects/create-project-dialog';
import { ProjectCard } from '@/features/projects/project-card';
import { type Project, PROJECT_FILE_ACCEPT } from '@/features/projects/project';
import { SEARCH_INPUT_ID, SEARCH_RESULTS_ID, focusStaysInSearch, SearchPanel } from '@/features/search/search-panel';
import { type AuthMode, SecureGate } from '@/features/shell/secure-gate';
import { ProjectNav } from '@/features/shell/project-nav';
import { SettingsNav } from '@/features/shell/settings-nav';
import { ThemeToggle } from '@/features/shell/theme-toggle';
import { FolderSyncCard } from '@/features/sync/folder-sync-card';
import { SyncAgentPanel } from '@/features/sync/sync-agent-panel';
import { BackupCard, KillSwitchCard } from '@/features/owner/owner-controls';
import { ProviderCard } from '@/features/providers/provider-card';
import { type TeamCapacity, TeamPanel } from '@/features/team/team-panel';
import { UsagePanel } from '@/features/usage/usage-panel';
import { UsageView } from '@/features/usage/usage-view';
import { relativeDate, formatTokens } from '@/lib/format';

const SECTION_SUBTITLES: Record<Section, string> = {
  dashboard: 'Your projects stay private until you choose who can access them.',
  projects: 'Every project you can access: private, shared and team-wide.',
  conversations: 'Conversation history from every project you can access.',
  team: 'Members, invitations and reconnect links. Up to four people.',
  providers: 'Any service that speaks the OpenAI chat format. Each member can also bring their own key.',
  usage: 'Tokens counted per person, by model, and how much of each limit remains.',
  sync: 'The agent on your computer that uploads changed files to a project.',
  activity: 'Who did what, and when. The log never stores message text or file contents.',
  safety: 'Everything the owner needs when something goes wrong.',
};

// How a change reaches the address: a new history entry, an edit of the
// current one, or nothing when the address already says it (Back, a reload).
type HistoryMode = 'push' | 'replace' | 'none';

type ChatOptions = { conversationId?: string; fresh?: boolean; fileIds?: string[] };

function chatOptions(target: ChatTarget): ChatOptions {
  return target.conversation === NEW_CONVERSATION ? { fresh: true } : { conversationId: target.conversation ?? undefined };
}

export function Dashboard({ authMode, initialSection = DEFAULT_SECTION }: { authMode: AuthMode; initialSection?: Section }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  // Safari does not move focus to a clicked button, so losing focus to "no
  // element" may still be a click on a result. Closing waits a moment for it.
  const searchCloseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Files a search result asked the chat to open with, already selected.
  const [openWithFileIds, setOpenWithFileIds] = useState<string[]>([]);
  const [activeFilter, setActiveFilter] = useState<'all' | Visibility>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  // The page reads the view from the address on the server, so the first
  // render on either side already shows it.
  const [section, setSection] = useState<Section>(initialSection);
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
  // Starts the open project on a new conversation instead of the latest one.
  const [startFresh, setStartFresh] = useState(false);
  // Every open remounts the chat, so asking twice for the same conversation,
  // or for a new one, still starts it over.
  const [chatSession, setChatSession] = useState(0);
  // The conversation the chat shows, for the project column to mark.
  const [currentConversationId, setCurrentConversationId] = useState<string | undefined>();
  const [projectConversations, setProjectConversations] = useState<ConversationSummary[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  // The project whose conversations were asked for last, so a slow answer for
  // a project closed meanwhile does not show up under another one.
  const conversationsFor = useRef<string | null>(null);
  // The open project and the project list, for the address handlers that are
  // registered once and would otherwise see the first render's state.
  const openProjectId = useRef<string | null>(null);
  const projectsRef = useRef<Project[]>([]);
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
  const [models, setModels] = useState<ProviderModel[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const contextInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.sync.get().then((setting) => setSyncEnabled(setting.enabled)).catch(() => undefined);
    api.driveStatus().then((status) => setDriveConfigured(status.configured)).catch(() => undefined);
  }, []);

  function writeUrl(search: string, history: HistoryMode, path = window.location.pathname) {
    if (history === 'none') return;
    const url = `${path}${search}`;
    if (history === 'push') window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
  }

  // The conversation on screen, kept in the address without a new history
  // entry, so a reload returns to it.
  function rememberConversation(conversationId: string | undefined) {
    setCurrentConversationId(conversationId);
    const projectId = openProjectId.current;
    if (projectId) writeUrl(chatSearch({ projectId, conversation: conversationId ?? NEW_CONVERSATION }, window.location.search), 'replace');
  }

  async function loadConversations(projectId: string) {
    conversationsFor.current = projectId;
    setConversationsLoading(true);
    try {
      const { conversations } = await api.projects.conversations(projectId);
      if (conversationsFor.current === projectId) setProjectConversations(conversations);
    } catch { /* the column keeps what it showed */ }
    finally { if (conversationsFor.current === projectId) setConversationsLoading(false); }
  }

  function openProject(project: Project, target: ChatOptions = {}, history: HistoryMode = 'push') {
    if (project.id !== openProjectId.current) {
      setProjectConversations([]);
      void loadConversations(project.id);
    }
    openProjectId.current = project.id;
    // A chat opens in the workspace, so one opened from Settings (by search)
    // leaves Settings and closes back to home.
    const leavingSettings = history !== 'none' && isSettingsSection(sectionFromLocation(window.location.pathname, window.location.search));
    if (leavingSettings) setSection(DEFAULT_SECTION);
    const base = leavingSettings ? sectionSearch(DEFAULT_SECTION, window.location.search) : window.location.search;
    writeUrl(chatSearch({ projectId: project.id, conversation: target.fresh ? NEW_CONVERSATION : target.conversationId ?? null }, base), history, '/');
    setActiveProject(project);
    setActiveConversationId(target.conversationId ?? null);
    setStartFresh(Boolean(target.fresh));
    setOpenWithFileIds(target.fileIds ?? []);
    setCurrentConversationId(target.fresh ? undefined : target.conversationId);
    setChatSession((value) => value + 1);
    setMobileMenu(false);
  }

  function closeProject(history: HistoryMode = 'push') {
    if (openProjectId.current) writeUrl(chatSearch(null, window.location.search), history);
    openProjectId.current = null;
    conversationsFor.current = null;
    setActiveProject(null);
    setActiveConversationId(null);
    setStartFresh(false);
    setOpenWithFileIds([]);
    setCurrentConversationId(undefined);
  }

  function goToSection(next: Section) {
    closeProject('none');
    setSection(next);
    setMobileMenu(false);
    writeUrl(chatSearch(null, sectionSearch(next, window.location.search)), 'push', sectionPath(next));
  }

  useEffect(() => {
    let active = true;
    Promise.all([api.bootstrap(), api.projects.list(), api.team.get()])
      .then(([bootstrap, payload, team]) => {
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
        const list: Project[] = payload.projects.map((project, index) => ({ id: project.id, name: project.name, description: project.description, visibility: project.visibility, files: project.fileCount, conversations: project.conversationCount ?? 0, updated: relativeDate(project.updatedAt), color: ['from-cyan-400/20 via-teal-300/10 to-transparent', 'from-violet-400/20 via-fuchsia-300/10 to-transparent', 'from-amber-300/20 via-orange-300/10 to-transparent'][index % 3], icon: index % 3 === 0 ? 'code' : index % 3 === 1 ? 'folder' : 'lab', members: ['DS'] }));
        setProjects(list);
        // A reload or a shared link opens the chat the address names.
        const target = parseChatTarget(window.location.search);
        const project = target && list.find((item) => item.id === target.projectId);
        if (target && project) openProject(project, chatOptions(target), 'none');
        else {
          // A malformed or unknown target leaves the address, so it is not
          // tried again on the next reload.
          const cleaned = chatSearch(null, window.location.search);
          if (cleaned !== window.location.search) writeUrl(cleaned, 'replace');
          if (target) setNotice('That project is not available, or you no longer have access to it.');
        }
        void api.auth.claim().catch(() => undefined);
      })
      .catch((error) => {
        if (!active) return;
        // All three need a session, so a missing one fails them together.
        if (error instanceof ApiRequestError && error.status === 401) { setAuthRequired(true); return; }
        setNotice(error instanceof Error && !(error instanceof ApiRequestError) ? error.message : 'Could not load application data.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  // Adres jest źródłem prawdy dla wybranego widoku: odczyt przy wejściu plus
  // reakcja na Wstecz/Dalej, żeby przyciski przeglądarki robiły to, czego
  // użytkownik oczekuje.
  useEffect(() => {
    const syncFromUrl = () => setSection(sectionFromLocation(window.location.pathname, window.location.search));
    // The open chat follows the address too. Before the projects load there
    // is nothing to open; loading them reads the address itself.
    const onPopState = () => {
      syncFromUrl();
      const target = parseChatTarget(window.location.search);
      const project = target && projectsRef.current.find((item) => item.id === target.projectId);
      if (target && project) openProject(project, chatOptions(target), 'none');
      else if (openProjectId.current) closeProject('none');
    };
    const frame = requestAnimationFrame(syncFromUrl);
    window.addEventListener('popstate', onPopState);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  useEffect(() => { projectsRef.current = projects; }, [projects]);

  // Po zaproszeniu albo cofnięciu zaproszenia bierzemy stan z serwera zamiast
  // zgadywać go lokalnie — link ponownego dostępu nie zajmuje miejsca w zespole,
  // więc licznik „x z 4” nie da się poprawnie policzyć po stronie przeglądarki.
  async function refreshTeam() {
    try {
      const team = await api.team.get();
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
      await api.sync.update({ enabled });
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
  const settingsOpen = !activeProject && isSettingsSection(section);

  const filteredProjects = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('pl');
    return projects.filter((p) => (activeFilter === 'all' || p.visibility === activeFilter) && (!needle || `${p.name} ${p.description}`.toLocaleLowerCase('pl').includes(needle)));
  }, [activeFilter, projects, query]);

  // The box filtered only project names while promising files and
  // conversations too. The same text now also searches their contents.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) return;
    let active = true;
    const timer = setTimeout(() => {
      api.search(term).then((results) => { if (active) setSearchResults(results); }).catch(() => undefined);
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [query]);
  const visibleResults = query.trim().length >= 2 ? searchResults : null;

  function openSearch() {
    clearTimeout(searchCloseTimer.current);
    setSearchOpen(true);
  }

  function closeSearchSoon(next: EventTarget | null) {
    if (focusStaysInSearch(next)) return;
    clearTimeout(searchCloseTimer.current);
    searchCloseTimer.current = setTimeout(() => setSearchOpen(false), 150);
  }

  function openFromSearch(projectId: string, target: { conversationId?: string; fileId?: string }) {
    const project = projects.find((item) => item.id === projectId);
    if (!project) return;
    clearTimeout(searchCloseTimer.current);
    setSearchOpen(false);
    openProject(project, { conversationId: target.conversationId, fileIds: target.fileId ? [target.fileId] : [] });
  }

  async function createProject() {
    const name = projectName.trim();
    if (!name) return;
    setSaving(true); setNotice(null);
    try {
      const { project } = await api.projects.create({ name, description: importedFile ? `Import: ${importedFile}` : '', visibility, selectedMembers: [], members: projectShares, storageProvider });
      if (pendingFiles.length) {
        const form = new FormData();
        pendingFiles.forEach((file) => form.append('files', file));
        form.append('paths', JSON.stringify(pendingFiles.map((file) => file.webkitRelativePath || file.name)));
        await api.projects.upload(project.id, form);
      }
      setProjects((current) => [{ id: project.id, name, description: importedFile ? `Imported: ${importedFile}` : 'New project workspace.', visibility, files: pendingFiles.length, conversations: 0, updated: 'now', color: 'from-emerald-400/20 via-cyan-300/10 to-transparent', icon: 'folder', members: visibility === 'private' ? ['DS'] : ['DS', 'MK'] }, ...current]);
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
      const { project, message } = await api.projects.importContext(form);
      setProjects((current) => [{ id: project.id, name: project.name, description: `${project.conversations} imported conversations`, visibility: project.visibility, files: 0, conversations: project.conversations, updated: 'now', color: 'from-sky-400/20 via-cyan-300/10 to-transparent', icon: 'lab', members: ['DS'] }, ...current]);
      setNotice(message);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Context import failed.'); }
    finally { setSaving(false); }
  }

  async function makeProjectPrivate(project: Project) {
    if (project.visibility === 'private') return;
    try {
      await api.projects.updateSharing(project.id, { visibility: 'private', members: [] });
      setProjects((current) => current.map((item) => item.id === project.id ? { ...item, visibility: 'private', members: ['DS'], updated: 'now' } : item));
      setNotice('The project is now visible only to you.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not make the project private.'); }
  }

  async function deleteProject(project: Project) {
    if (!window.confirm(`Delete “${project.name}” with all of its files and conversations? This cannot be undone.`)) return;
    try {
      await api.projects.remove(project.id);
      setProjects((current) => current.filter((item) => item.id !== project.id));
      setNotice('The project and its data were deleted.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not delete the project.'); }
  }

  async function logout() {
    await api.auth.logout().catch(() => undefined);
    window.location.replace('/');
  }

  if (loading) return <SecureGate title="Loading private cloud…" />;
  if (authRequired) return <SecureGate authMode={authMode} authRequired title="This workspace requires an invitation" />;

  return (
    <TooltipProvider delay={200}>
    <main className="min-h-screen bg-surface text-ink">
      <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-line bg-surface/90 px-3 backdrop-blur-xl sm:gap-3 sm:px-4">
            {!settingsOpen && <Button aria-label="Open menu" className="lg:hidden" onClick={() => setMobileMenu(true)} size="icon" variant="ghost"><Menu /></Button>}
            <button aria-label="MeshKeep home" className="flex min-h-11 shrink-0 items-center gap-2.5 rounded-lg px-2 hover:bg-surface-fill" onClick={() => goToSection('dashboard')} type="button"><span className="grid size-7 place-items-center rounded-lg bg-brand text-brand-ink"><Bot className="size-4" /></span><span className="hidden text-[15px] font-semibold tracking-tight sm:inline">MeshKeep</span></button>
            <div className="relative mx-auto max-w-xl flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
              <Input aria-controls={SEARCH_RESULTS_ID} aria-expanded={searchOpen && Boolean(visibleResults)} aria-label="Search projects, files and conversations" className="h-10 rounded-xl border-line bg-surface-raised/75 pl-9 shadow-none dark:bg-surface-raised" id={SEARCH_INPUT_ID} onBlur={(event) => closeSearchSoon(event.relatedTarget)} onChange={(e) => { setQuery(e.target.value); openSearch(); }} onFocus={openSearch} onKeyDown={(event) => { if (event.key === 'Escape') setSearchOpen(false); }} placeholder="Search projects, files or conversations…" value={query} />
              {searchOpen && visibleResults && <SearchPanel onBlur={closeSearchSoon} onFocus={openSearch} onOpen={openFromSearch} results={visibleResults} />}
            </div>
            <Badge className="hidden border-emerald-700/15 bg-ok-soft-strong text-ok-text md:flex" variant="outline"><span className="size-1.5 rounded-full bg-emerald-500" />Service online</Badge>
            <ThemeToggle />
            <Button aria-current={settingsOpen ? 'page' : undefined} className={cn(settingsOpen && 'bg-surface-selected text-brand-text')} onClick={() => goToSection(DEFAULT_SETTINGS_SECTION)} variant="ghost"><Settings2 /><span className="hidden sm:inline">Settings</span></Button>
            <Button aria-label="Sign out" onClick={() => void logout()} size="icon" title="Sign out" variant="ghost"><LogOut /></Button>
            <Avatar className="bg-brand text-brand-ink"><AvatarFallback className="bg-transparent text-xs font-semibold text-brand-ink">DS</AvatarFallback></Avatar>
      </header>
      {/* Pola plikowe zostają zamontowane niezależnie od widoku — trzymają je refy,
          a odmontowanie zerwałoby uchwyty używane przez obsługę importu. */}
      <input ref={fileInput} accept={PROJECT_FILE_ACCEPT} className="sr-only" multiple onChange={(e) => { const selected = Array.from(e.target.files ?? []); if (selected.length) { setPendingFiles(selected); setImportedFile(`${selected.length} ${selected.length === 1 ? 'file' : 'files'}`); setShowCreate(true); } e.target.value = ''; }} type="file" />
      <input ref={folderInput} className="sr-only" multiple onChange={(e) => { const selected = Array.from(e.target.files ?? []); if (selected.length) { setPendingFiles(selected); setImportedFile(`folder · ${selected.length} files`); setShowCreate(true); } e.target.value = ''; }} type="file" {...{ webkitdirectory: '' }} />
      <input ref={contextInput} accept="application/json,.json" className="sr-only" onChange={(e) => { const selected = e.target.files?.[0]; if (selected) void importContext(selected); e.target.value = ''; }} type="file" />

      <div className={cn('lg:grid', activeProject ? 'lg:grid-cols-[256px_minmax(0,1fr)] xl:grid-cols-[256px_minmax(0,1fr)_320px]' : 'lg:grid-cols-[256px_minmax(0,1fr)]')}>
        {settingsOpen
          ? <SettingsNav isOwner={currentRole === 'owner'} onBack={() => goToSection(DEFAULT_SECTION)} onSelect={goToSection} section={section} />
          : <ProjectNav activeProjectId={activeProject?.id ?? null} conversations={projectConversations} conversationsLoading={conversationsLoading} currentConversationId={currentConversationId} onClose={() => setMobileMenu(false)} onNewConversation={(project) => openProject(project, { fresh: true })} onNewProject={() => { setMobileMenu(false); setShowCreate(true); }} onOpenConversation={(project, conversationId) => openProject(project, { conversationId })} onOpenProject={(project) => { if (project.id === activeProject?.id) setMobileMenu(false); else openProject(project); }} onSelectSection={goToSection} open={mobileMenu} projects={projects} section={section} syncEnabled={syncEnabled} teamCapacity={teamCapacity} />}
        {activeProject ? <ChatWorkspace conversationId={activeConversationId} fresh={startFresh} initialFileIds={openWithFileIds} key={`chat-${chatSession}`} models={models} onClose={() => closeProject()} onConversationChange={rememberConversation} onConversationSaved={() => void loadConversations(activeProject.id)} onFileCountChange={(count) => setProjects((current) => current.map((item) => item.id === activeProject.id ? { ...item, files: count } : item))} onUsage={(input, output) => { setInputUsage((value) => value + input); setOutputUsage((value) => value + output); setDailyUsage((value) => value + input + output); setMonthlyUsage((value) => value + input + output); }} project={activeProject} />
        : <section className="min-w-0">
          <div className="mx-auto max-w-[1500px] px-4 py-7 sm:px-7 lg:px-10 lg:py-10">
            <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
              <div>
                <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-brand-text"><ShieldCheck className="size-4" /> {settingsOpen ? 'Settings' : 'Private team cloud'}</p>
                <h1 className="text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">{section === 'dashboard' ? `Welcome, ${displayName}.` : SECTION_LABELS[section]}</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted sm:text-base">{SECTION_SUBTITLES[section]}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {showImportActions && <>
                  <Button className="h-10 rounded-xl border-line bg-surface-raised px-3 dark:border-line dark:bg-surface-raised" onClick={() => contextInput.current?.click()} variant="outline"><MessageSquareText /> Context</Button>
                  <Button className="h-10 rounded-xl border-line bg-surface-raised px-3 dark:border-line dark:bg-surface-raised" onClick={() => folderInput.current?.click()} variant="outline"><Folder /> Folder</Button>
                  <Button className="h-10 rounded-xl border-line bg-surface-raised px-3 dark:border-line dark:bg-surface-raised" onClick={() => fileInput.current?.click()} variant="outline"><UploadCloud /> File / ZIP</Button>
                  <Button className="h-10 rounded-xl bg-brand px-4 text-brand-ink shadow-[0_8px_24px_rgba(23,61,56,.18)] hover:bg-brand-hover" onClick={() => setShowCreate(true)}><Plus /> New project</Button>
                </>}
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
                  <div><h2 className="text-xl font-semibold tracking-tight">Recent projects</h2><p className="mt-1 text-sm text-ink-muted">The four most recently updated projects. Open Projects for the full, filtered list.</p></div>
                  {projects.length > recentProjects.length && <Button className="h-9 rounded-xl border-line bg-surface-raised px-3 dark:border-line dark:bg-surface-raised" onClick={() => goToSection('projects')} variant="outline">View all ({projects.length})</Button>}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {recentProjects.map((project) => <ProjectCard key={project.id} onCopyId={() => { void navigator.clipboard.writeText(project.id); setNotice('Project ID copied. Use it with the sync agent.'); }} onDelete={() => void deleteProject(project)} onExport={() => { window.location.href = `/api/projects/${project.id}/context`; }} onMakePrivate={() => void makeProjectPrivate(project)} onOpen={() => openProject(project)} project={project} />)}
                  {projects.length === 0 && <button className="group flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-[#9caaa6] bg-surface-veil p-6 text-center transition hover:border-[#4c7a72] hover:bg-surface-raised/70" onClick={() => setShowCreate(true)} type="button">
                    <span className="mb-3 flex size-11 items-center justify-center rounded-xl border border-line bg-surface-raised text-brand-text shadow-sm transition group-hover:-translate-y-0.5"><Plus /></span>
                    <span className="font-semibold">Create your first project</span><span className="mt-1 max-w-[230px] text-sm leading-5 text-ink-muted">Start empty or import a folder or ZIP archive.</span>
                  </button>}
                </div>
              </section>
              <aside className="space-y-4 xl:sticky xl:top-[96px]">
                <UsagePanel dailyLimit={dailyLimit} inputUsage={inputUsage} monthlyLimit={monthlyLimit} monthlyUsage={monthlyUsage} outputUsage={outputUsage} />
              </aside>
            </div>
            </>}

            {section === 'projects' && <section aria-label="All projects">
              <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <p className="text-sm text-ink-muted">{filteredProjects.length === projects.length ? `${projects.length} ${projects.length === 1 ? 'project' : 'projects'}` : `${filteredProjects.length} of ${projects.length} projects`}</p>
                <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-surface-raised/70 p-1">
                  {([['all', 'All'], ['private', 'Only me'], ['selected', 'Selected'], ['team', 'Team']] as const).map(([key, label]) => (
                    <button key={key} className={cn('rounded-lg px-3 py-1.5 text-xs font-medium transition-colors', activeFilter === key ? 'bg-brand text-brand-ink' : 'text-ink-muted hover:bg-black/5')} onClick={() => setActiveFilter(key)} type="button">{label}</button>
                  ))}
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {filteredProjects.map((project) => <ProjectCard key={project.id} onCopyId={() => { void navigator.clipboard.writeText(project.id); setNotice('Project ID copied. Use it with the sync agent.'); }} onDelete={() => void deleteProject(project)} onExport={() => { window.location.href = `/api/projects/${project.id}/context`; }} onMakePrivate={() => void makeProjectPrivate(project)} onOpen={() => openProject(project)} project={project} />)}
                <button className="group flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-[#9caaa6] bg-surface-veil p-6 text-center transition hover:border-[#4c7a72] hover:bg-surface-raised/70" onClick={() => setShowCreate(true)} type="button">
                  <span className="mb-3 flex size-11 items-center justify-center rounded-xl border border-line bg-surface-raised text-brand-text shadow-sm transition group-hover:-translate-y-0.5"><Plus /></span>
                  <span className="font-semibold">Add another project</span><span className="mt-1 max-w-[230px] text-sm leading-5 text-ink-muted">Create an empty project or import a folder or ZIP archive.</span>
                </button>
              </div>
              {filteredProjects.length === 0 && <div className="mt-4 rounded-2xl border border-dashed border-line-strong bg-surface-veil p-12 text-center"><Folder className="mx-auto mb-3 text-ink-muted" /><p className="font-medium">No projects found</p><p className="mt-1 text-sm text-ink-muted">Change the filter or try another search term.</p></div>}
            </section>}

            {section === 'conversations' && <ConversationsView onNotice={setNotice} onOpenConversation={(projectId, conversationId) => { const target = projects.find((item) => item.id === projectId); if (!target) { setNotice('You no longer have access to this conversation’s project.'); return; } openProject(target, { conversationId }); }} query={query} />}

            {section === 'team' && <div className="max-w-2xl"><TeamPanel canInvite={currentRole === 'owner'} capacity={teamCapacity} currentMemberId={currentMemberId} members={teamMembers} onNotice={setNotice} onTeamChanged={() => void refreshTeam()} pendingInvites={pendingInvites} reconnectLinks={reconnectLinks} /></div>}

            {section === 'providers' && <div className="max-w-2xl"><ProviderCard onChanged={() => window.location.reload()} onNotice={setNotice} /></div>}

            {section === 'usage' && <UsageView dailyLimit={dailyLimit} monthlyLimit={monthlyLimit} />}

            {section === 'sync' && <div className="max-w-2xl space-y-4"><FolderSyncCard enabled={syncEnabled} onChange={(enabled) => void updateSync(enabled)} /><SyncAgentPanel onNotice={setNotice} /></div>}

            {section === 'activity' && (currentRole === 'owner'
              ? <AuditView />
              : <ViewPlaceholder detail="Only the cloud owner can view the activity log." icon={LockKeyhole} title="Access denied" />)}

            {section === 'safety' && (currentRole === 'owner'
              ? <div className="max-w-2xl space-y-4"><KillSwitchCard onNotice={setNotice} /><BackupCard onNotice={setNotice} /></div>
              : <ViewPlaceholder detail="Only the cloud owner can stop model calls or download a backup." icon={LockKeyhole} title="Access denied" />)}
          </div>
        </section>}
      </div>
      {notice && <output aria-live="polite" className="fixed bottom-5 right-5 z-[80] max-w-sm rounded-xl bg-brand px-4 py-3 text-sm text-brand-ink shadow-xl">{notice}</output>}
      {showCreate && <CreateProjectDialog driveConfigured={driveConfigured} importedFile={importedFile} members={teamMembers.filter((member) => member.role !== 'owner')} name={projectName} onClose={() => { if (!saving) { setShowCreate(false); setImportedFile(null); setPendingFiles([]); setProjectShares([]); setStorageProvider('r2'); } }} onCreate={createProject} onNameChange={setProjectName} onSharesChange={setProjectShares} onStorageProviderChange={setStorageProvider} onVisibilityChange={setVisibility} saving={saving} shares={projectShares} storageProvider={storageProvider} visibility={visibility} />}
    </main>
    </TooltipProvider>
  );
}
