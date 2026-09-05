import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const timestamp = (name: string) =>
  integer(name, { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

export const members = sqliteTable(
  'members',
  {
    id: text('id').primaryKey(),
    providerUserId: text('provider_user_id').notNull(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    role: text('role', { enum: ['owner', 'member'] }).notNull().default('member'),
    status: text('status', { enum: ['active', 'suspended'] }).notNull().default('active'),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (table) => [
    uniqueIndex('members_provider_user_id_uq').on(table.providerUserId),
    uniqueIndex('members_email_uq').on(table.email),
  ],
);

export const invites = sqliteTable(
  'invites',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    role: text('role', { enum: ['member'] }).notNull().default('member'),
    tokenHash: text('token_hash'),
    createdBy: text('created_by').notNull().references(() => members.id),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' }),
    createdAt: timestamp('created_at'),
  },
  (table) => [uniqueIndex('invites_email_uq').on(table.email)],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull(),
    memberId: text('member_id').notNull().references(() => members.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: timestamp('created_at'),
    lastSeenAt: timestamp('last_seen_at'),
  },
  (table) => [
    uniqueIndex('sessions_token_hash_uq').on(table.tokenHash),
    index('sessions_member_idx').on(table.memberId),
    index('sessions_expires_idx').on(table.expiresAt),
  ],
);

export const syncTokens = sqliteTable(
  'sync_tokens',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull(),
    memberId: text('member_id').notNull().references(() => members.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    createdAt: timestamp('created_at'),
  },
  (table) => [
    uniqueIndex('sync_tokens_token_hash_uq').on(table.tokenHash),
    index('sync_tokens_member_idx').on(table.memberId),
    index('sync_tokens_expires_idx').on(table.expiresAt),
  ],
);

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull().references(() => members.id),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    visibility: text('visibility', {
      enum: ['private', 'selected', 'team'],
    })
      .notNull()
      .default('private'),
    storageProvider: text('storage_provider', { enum: ['r2', 'google_drive'] })
      .notNull()
      .default('r2'),
    driveFolderId: text('drive_folder_id'),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (table) => [index('projects_owner_idx').on(table.ownerId)],
);

export const projectMembers = sqliteTable(
  'project_members',
  {
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    memberId: text('member_id').notNull().references(() => members.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['reader', 'editor'] }).notNull().default('reader'),
    createdAt: timestamp('created_at'),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.memberId] }),
    index('project_members_member_idx').on(table.memberId),
  ],
);

export const files = sqliteTable(
  'files',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    uploadedBy: text('uploaded_by').notNull().references(() => members.id),
    objectKey: text('object_key').notNull(),
    relativePath: text('relative_path').notNull(),
    name: text('name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    createdAt: timestamp('created_at'),
  },
  (table) => [
    uniqueIndex('files_object_key_uq').on(table.objectKey),
    index('files_project_idx').on(table.projectId),
  ],
);

export const conversations = sqliteTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    createdBy: text('created_by').notNull().references(() => members.id),
    title: text('title').notNull(),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (table) => [index('conversations_project_idx').on(table.projectId)],
);

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
    memberId: text('member_id').references(() => members.id),
    role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
    content: text('content').notNull(),
    model: text('model'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    createdAt: timestamp('created_at'),
  },
  (table) => [index('messages_conversation_idx').on(table.conversationId)],
);

export const usageEvents = sqliteTable(
  'usage_events',
  {
    id: text('id').primaryKey(),
    memberId: text('member_id').notNull().references(() => members.id),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    createdAt: timestamp('created_at'),
  },
  (table) => [index('usage_events_member_date_idx').on(table.memberId, table.createdAt)],
);

export const memberLimits = sqliteTable('member_limits', {
  memberId: text('member_id').primaryKey().references(() => members.id, { onDelete: 'cascade' }),
  dailyTokens: integer('daily_tokens').notNull().default(400_000),
  monthlyTokens: integer('monthly_tokens').notNull().default(8_000_000),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  updatedAt: timestamp('updated_at'),
});

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at'),
});

// Dziennik zdarzeń administracyjnych i bezpieczeństwa. Świadomie NIE zapisuje
// treści rozmów, promptów, zawartości plików ani żadnych sekretów — ma pozwolić
// właścicielowi rozpoznać nadużycie i awarię bez zaglądania w cudze rozmowy.
// Etykiety aktora i celu są kopiami wartości z chwili zdarzenia, żeby wpis
// pozostał czytelny po usunięciu konta albo projektu.
export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id').references(() => members.id, { onDelete: 'set null' }),
    actorLabel: text('actor_label').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    targetLabel: text('target_label'),
    detail: text('detail'),
    createdAt: timestamp('created_at'),
  },
  (table) => [
    index('audit_events_created_idx').on(table.createdAt),
    index('audit_events_actor_idx').on(table.actorId),
  ],
);

// Provider configuration. One row per scope: the literal 'team' row is the
// default the owner sets for everyone, and any other row is keyed by a member
// id and overrides the default for that person only. Member ids are UUIDs, so
// they cannot collide with 'team', which keeps the primary key doing the
// uniqueness work instead of a partial index over a nullable column.
//
// Provider credentials are encrypted with AES-GCM before they reach D1. The
// non-secret preview lets the UI identify a configured key without decrypting
// it or sending the credential to the browser.
export const providers = sqliteTable('providers', {
  scope: text('scope').primaryKey(),
  label: text('label').notNull(),
  baseUrl: text('base_url').notNull(),
  apiKeyCiphertext: text('api_key_ciphertext').notNull(),
  keyPreview: text('key_preview').notNull(),
  // Model list as returned by the provider, cached as JSON so that opening the
  // app does not call an external service on every load.
  models: text('models').notNull().default('[]'),
  modelsFetchedAt: integer('models_fetched_at', { mode: 'timestamp_ms' }),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
});
