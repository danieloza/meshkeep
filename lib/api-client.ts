// The browser's way into the API: one function per route, typed with the
// contracts in `lib/contracts`.
//
// Responses are typed, not parsed. The API tests parse every response with
// its contract on the built worker, and the server and this code always ship
// together, so a runtime check here would mostly cost bundle size: zod alone
// adds about 95 KB gzip to the browser. That is why everything from the
// contracts comes in with `import type`.
//
// File downloads (a project's context, the database backup) stay plain
// navigations, because they are files, not JSON.

import type { BootstrapResponse, JoinRequest, JoinResponse, SetupRequest, SetupResponse, SignedIn, SignedOut } from './contracts/account';
import type { AuditLog, KillSwitchSettings, StorageCheck } from './contracts/admin';
import type { ApiError, ByIdRequest, DeletedResponse, RevokedResponse } from './contracts/common';
import type { AllConversations, ChatRequest, ConversationDetail, ProjectConversations } from './contracts/conversations';
import type { DriveStatus, FileSuggestions, IndexRound, ProjectFiles } from './contracts/files';
import type {
  ContextImportResponse, CreateProjectRequest, CreateProjectResponse, InstructionsResponse, ProjectList,
  UpdateInstructionsRequest, UpdateInstructionsResponse, UpdateSharingRequest, UpdateSharingResponse,
} from './contracts/projects';
import type { ProviderState, RemoveProviderResponse, SaveProviderRequest, SaveProviderResponse } from './contracts/providers';
import type { SearchResults } from './contracts/search';
import type { CreateSyncTokenRequest, CreateSyncTokenResponse, SyncCredentials, SyncSetting, UpdateSyncRequest } from './contracts/sync';
import type { InviteRequest, InviteResponse, TeamResponse, UpdateMemberRequest, UpdateMemberResponse } from './contracts/team';
import type { UsageResponse } from './contracts/usage';

// A request the server answered with an error status. `message` is the
// server's own explanation when it gave one.
export class ApiRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

// What to tell a person when a failed response carries no `{ error }` of its
// own: the platform answered instead of MeshKeep, or the body is not JSON.
export function fallbackMessage(status: number): string {
  if (status === 401) return 'Your session has ended. Sign in again.';
  if (status === 413) return 'The request is too large.';
  if (status === 429) return 'Too many requests. Wait a moment and try again.';
  if (status >= 500) return 'The server is not responding right now. Try again in a moment.';
  return `The request failed (${status}).`;
}

async function failure(response: Response): Promise<ApiRequestError> {
  let message: string | undefined;
  try {
    message = ((await response.json()) as Partial<ApiError>).error;
  } catch {
    message = undefined;
  }
  return new ApiRequestError(response.status, message || fallbackMessage(response.status));
}

type Body = { json: unknown } | { form: FormData };

function send(method: string, path: string, body?: Body): Promise<Response> {
  const init: RequestInit = { method, cache: 'no-store' };
  if (body && 'json' in body) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body.json);
  } else if (body) {
    // The browser sets the multipart boundary itself.
    init.body = body.form;
  }
  return fetch(path, init);
}

async function call<T>(method: string, path: string, body?: Body): Promise<T> {
  const response = await send(method, path, body);
  if (!response.ok) throw await failure(response);
  return (await response.json()) as T;
}

const at = (id: string) => encodeURIComponent(id);
const query = (params: Record<string, string>) => new URLSearchParams(params).toString();

export const api = {
  bootstrap: () => call<BootstrapResponse>('GET', '/api/bootstrap'),

  auth: {
    claim: () => call<SignedIn>('POST', '/api/auth/claim'),
    join: (body: JoinRequest) => call<JoinResponse>('POST', '/api/auth/join', { json: body }),
    setup: (body: SetupRequest) => call<SetupResponse>('POST', '/api/auth/setup', { json: body }),
    logout: () => call<SignedOut>('POST', '/api/auth/logout'),
  },

  projects: {
    list: () => call<ProjectList>('GET', '/api/projects'),
    create: (body: CreateProjectRequest) => call<CreateProjectResponse>('POST', '/api/projects', { json: body }),
    updateSharing: (projectId: string, body: UpdateSharingRequest) =>
      call<UpdateSharingResponse>('PATCH', `/api/projects/${at(projectId)}`, { json: body }),
    remove: (projectId: string) => call<DeletedResponse>('DELETE', `/api/projects/${at(projectId)}`),
    importContext: (form: FormData) => call<ContextImportResponse>('POST', '/api/context/import', { form }),

    files: (projectId: string) => call<ProjectFiles>('GET', `/api/projects/${at(projectId)}/files`),
    upload: (projectId: string, form: FormData) => call<ProjectFiles>('POST', `/api/projects/${at(projectId)}/files`, { form }),
    indexRound: (projectId: string) => call<IndexRound>('POST', `/api/projects/${at(projectId)}/search-index`),
    suggestFiles: (projectId: string, question: string) =>
      call<FileSuggestions>('GET', `/api/projects/${at(projectId)}/suggest-files?${query({ q: question })}`),

    conversations: (projectId: string) => call<ProjectConversations>('GET', `/api/projects/${at(projectId)}/conversations`),
    conversation: (projectId: string, conversationId: string) =>
      call<ConversationDetail>('GET', `/api/projects/${at(projectId)}/conversations?${query({ conversationId })}`),
    removeConversation: (projectId: string, conversationId: string) =>
      call<DeletedResponse>('DELETE', `/api/projects/${at(projectId)}/conversations?${query({ conversationId })}`),

    instructions: (projectId: string) => call<InstructionsResponse>('GET', `/api/projects/${at(projectId)}/instructions`),
    updateInstructions: (projectId: string, body: UpdateInstructionsRequest) =>
      call<UpdateInstructionsResponse>('PUT', `/api/projects/${at(projectId)}/instructions`, { json: body }),
  },

  files: {
    remove: (fileId: string) => call<DeletedResponse>('DELETE', `/api/files/${at(fileId)}`),
  },

  conversations: () => call<AllConversations>('GET', '/api/conversations'),
  search: (q: string) => call<SearchResults>('GET', `/api/search?${query({ q })}`),

  // A successful answer streams back as NDJSON events (see
  // `lib/chat-stream.ts`). Anything that fails before the model starts
  // answering comes back as JSON with a status, and throws here.
  chat: async (body: ChatRequest): Promise<ReadableStream<Uint8Array>> => {
    const response = await send('POST', '/api/chat', { json: body });
    if (!response.ok) throw await failure(response);
    if (!response.body) throw new ApiRequestError(response.status, 'The model did not respond.');
    return response.body;
  },

  team: {
    get: () => call<TeamResponse>('GET', '/api/team'),
    invite: (body: InviteRequest) => call<InviteResponse>('POST', '/api/team', { json: body }),
    revokeInvite: (body: ByIdRequest) => call<RevokedResponse>('DELETE', '/api/team', { json: body }),
    updateMember: (memberId: string, body: UpdateMemberRequest) =>
      call<UpdateMemberResponse>('PATCH', `/api/team/members/${at(memberId)}`, { json: body }),
  },

  provider: {
    get: () => call<ProviderState>('GET', '/api/provider'),
    save: (body: SaveProviderRequest) => call<SaveProviderResponse>('PUT', '/api/provider', { json: body }),
    remove: (scope: 'mine' | 'team') => call<RemoveProviderResponse>('DELETE', `/api/provider?${query({ scope })}`),
  },

  usage: () => call<UsageResponse>('GET', '/api/usage'),

  admin: {
    audit: () => call<AuditLog>('GET', '/api/admin/audit'),
    settings: () => call<KillSwitchSettings>('GET', '/api/admin/settings'),
    updateSettings: (body: KillSwitchSettings) => call<KillSwitchSettings>('PUT', '/api/admin/settings', { json: body }),
    checkStorage: () => call<StorageCheck>('POST', '/api/admin/backup'),
  },

  sync: {
    get: () => call<SyncSetting>('GET', '/api/sync'),
    update: (body: UpdateSyncRequest) => call<UpdateSyncRequest>('PUT', '/api/sync', { json: body }),
    tokens: () => call<SyncCredentials>('GET', '/api/sync/token'),
    createToken: (body: CreateSyncTokenRequest) => call<CreateSyncTokenResponse>('POST', '/api/sync/token', { json: body }),
    revokeToken: (body: ByIdRequest) => call<RevokedResponse>('DELETE', '/api/sync/token', { json: body }),
  },

  driveStatus: () => call<DriveStatus>('GET', '/api/storage/google-drive/status'),
};
