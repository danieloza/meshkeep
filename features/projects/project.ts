import { Code2, FolderLock, Sparkles } from 'lucide-react';
import type { Visibility } from '@/lib/contracts/common';

export type Project = { id: string; name: string; description: string; visibility: Visibility; files: number; conversations: number; updated: string; color: string; icon: 'code' | 'folder' | 'lab'; members: string[] };

export const PROJECT_FILE_ACCEPT = '.txt,.md,.json,.csv,.ts,.tsx,.js,.jsx,.mjs,.cjs,.py,.go,.rs,.java,.kt,.swift,.css,.scss,.html,.xml,.yaml,.yml,.toml,.sql,.sh,.ps1,.bat,.zip,.pdf,.rtf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.gif,.bmp';

export const visibilityLabels: Record<Visibility, string> = { private: 'Only me', selected: 'Selected people', team: 'Entire team' };

export const visibilityBadgeClasses: Record<Visibility, string> = { private: 'bg-private-soft text-private-text', selected: 'bg-people-soft text-people-text', team: 'bg-team-soft text-team-text' };

export const iconMap = { code: Code2, folder: FolderLock, lab: Sparkles };
