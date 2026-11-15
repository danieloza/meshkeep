// Conversations, their messages and the chat request. See `common.ts` for how
// the contracts are used.

import { z } from 'zod';
import { id, isoDate, visibility } from './common';
import { effortLevel } from './providers';

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

// Where a passage sits in its file: a PDF page, a sheet of a workbook, or the
// Markdown headings above it (the full trail, outermost first, joined with
// ` › `). A passage without a place or a heading has no locator.
export const passageLocator = z.union([
  z.object({ page: z.number().int().min(1) }).strict(),
  z.object({ sheet: z.number().int().min(1) }).strict(),
  z.object({ heading: z.string().min(1) }).strict(),
]);
export type PassageLocator = z.infer<typeof passageLocator>;

// One chunk of a long file that was sent. Consecutive chunks with the same
// locator are sent as one run under one label, with the text between them.
export const contextPassage = z.object({
  // The chunk's position in its file (`file_chunks.ordinal`).
  ordinal: z.number().int().min(0),
  // The chunk's stamp: which content it had (`file_chunks.chunk_key`).
  chunkKey: z.string().regex(/^[0-9a-f]{20}$/),
  locator: passageLocator.optional(),
  // The characters this passage adds to its run's body: its own slice, plus
  // the text restored between it and the chunk before it in the same run.
  // The lengths of a run add up to its body, the text sent under its label.
  length: z.number().int().min(1),
});
export type ContextPassage = z.infer<typeof contextPassage>;

export const contextFile = z.object({
  id,
  path: z.string(),
  status: contextFileStatus,
  note: z.string().optional(),
  // A long file sent by its passages (`truncated`) lists them here, in file
  // order. Older answers have no list.
  passages: z.array(contextPassage).optional(),
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
  // New for each message the user sends. The same id twice is refused rather
  // than answered and paid for twice.
  clientRequestId: id.optional(),
  // The connection the model is reached through, as the chat's model list
  // says. Without it, the first connection offering the model answers.
  connectionId: id.optional(),
  // Sent as `reasoning_effort`, and only for a model marked as accepting it.
  effort: effortLevel.optional(),
});
export type ChatRequest = z.input<typeof chatRequest>;
