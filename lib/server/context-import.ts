import 'server-only';

import { ApiError } from './http';

export type ImportedMessage = { role: 'user' | 'assistant' | 'system'; content: string };
export type ImportedConversation = { title: string; messages: ImportedMessage[] };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function messageFrom(value: unknown): ImportedMessage | null {
  const row = asRecord(value);
  if (!row) return null;
  const nestedMessage = asRecord(row.message);
  if (nestedMessage) return messageFrom(nestedMessage);
  const author = asRecord(row.author);
  const senderValue = row.role ?? author?.role ?? row.sender ?? row.type;
  const sender = typeof senderValue === 'string' ? senderValue.toLocaleLowerCase('en-US') : '';
  const role = sender.includes('assistant') || sender.includes('model') ? 'assistant' : sender.includes('system') ? 'system' : sender.includes('user') || sender.includes('human') ? 'user' : null;
  if (!role) return null;
  const contentObject = asRecord(row.content);
  const parts = Array.isArray(contentObject?.parts) ? contentObject.parts.filter((part): part is string => typeof part === 'string').join('\n') : null;
  const content = typeof row.content === 'string' ? row.content : typeof row.text === 'string' ? row.text : typeof row.message === 'string' ? row.message : parts;
  if (!content?.trim()) return null;
  return { role, content: content.trim().slice(0, 200_000) };
}

function conversationFrom(value: unknown, index: number): ImportedConversation | null {
  const row = asRecord(value);
  if (!row) return null;
  let candidates: unknown[] = [];
  if (Array.isArray(row.messages)) candidates = row.messages;
  else if (Array.isArray(row.chat_messages)) candidates = row.chat_messages;
  else if (Array.isArray(row.turns)) candidates = row.turns;
  else {
    const mapping = asRecord(row.mapping);
    if (mapping) {
      candidates = Object.values(mapping).sort((left, right) => {
        const l = Number(asRecord(asRecord(left)?.message)?.create_time ?? 0);
        const r = Number(asRecord(asRecord(right)?.message)?.create_time ?? 0);
        return l - r;
      });
    }
  }
  const normalized = candidates.map(messageFrom).filter((message): message is ImportedMessage => Boolean(message)).slice(0, 500);
  if (!normalized.length) return null;
  const title = typeof row.title === 'string' ? row.title : typeof row.name === 'string' ? row.name : `Imported conversation ${index + 1}`;
  return { title: title.trim().slice(0, 100) || `Imported conversation ${index + 1}`, messages: normalized };
}

export function normalizeContextFile(value: unknown): ImportedConversation[] {
  const root = asRecord(value);
  const candidates = Array.isArray(value) ? value : Array.isArray(root?.conversations) ? root.conversations : Array.isArray(root?.chats) ? root.chats : root ? [root] : [];
  const conversations = candidates.map(conversationFrom).filter((item): item is ImportedConversation => Boolean(item)).slice(0, 500);
  if (!conversations.length) throw new ApiError(422, 'No supported conversations were found. Export the history as JSON.');
  return conversations;
}
