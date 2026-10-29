// Conversations, their messages and the chat request. See `common.ts` for how
// the contracts are used.

import { z } from 'zod';
import { id, isoDate, visibility } from './common';

export const conversationSummary = z.object({
  id,
  title: z.string(),
  updatedAt: isoDate,
  messageCount: z.number().int(),
});
export type ConversationSummary = z.infer<typeof conversationSummary>;

// GET /api/projects/[id]/conversations
export const projectConversations = z.object({ conversations: z.array(conversationSummary) });
export type ProjectConversations = z.infer<typeof projectConversations>;

// GET /api/conversations: every project the member can read, with the
// project each conversation belongs to.
export const conversationRow = conversationSummary.extend({
  projectId: id,
  projectName: z.string(),
  projectVisibility: visibility,
});
export type ConversationRow = z.infer<typeof conversationRow>;

export const allConversations = z.object({ conversations: z.array(conversationRow) });
export type AllConversations = z.infer<typeof allConversations>;

// What happened to a selected file on its way into the model context. The
// answer shows this per file, so "the model saw your file" is never a guess.
export const contextFileStatus = z.enum(['included', 'truncated', 'unreadable', 'skipped']);
export type ContextFileStatus = z.infer<typeof contextFileStatus>;

export const contextFile = z.object({
  id,
  path: z.string(),
  status: contextFileStatus,
  note: z.string().optional(),
});
export type ContextFile = z.infer<typeof contextFile>;

export const storedMessage = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  model: z.string().nullable(),
  contextFiles: z.array(contextFile),
  createdAt: isoDate,
});
export type StoredMessage = z.infer<typeof storedMessage>;

// GET /api/projects/[id]/conversations?conversationId=…
export const conversationDetail = z.object({
  conversation: z.object({ id, title: z.string(), updatedAt: isoDate }),
  messages: z.array(storedMessage),
});
export type ConversationDetail = z.infer<typeof conversationDetail>;

// POST /api/chat. The answer streams back as events, see `lib/chat-stream.ts`.
export const chatRequest = z.object({
  projectId: id,
  conversationId: id.optional(),
  model: z.string().trim().min(1).max(200),
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string().trim().min(1).max(32_000),
  })).min(1).max(30),
  attachmentIds: z.array(id).max(8).default([]),
  temperature: z.number().min(0).max(1.5).default(0.4),
  maxTokens: z.number().int().min(64).max(4096).default(2048),
});
export type ChatRequest = z.input<typeof chatRequest>;
