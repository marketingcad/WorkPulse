import { sql } from 'drizzle-orm';
import { check, foreignKey, index, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { orgId, pk, tstz } from './_helpers';
import { memberships } from './identity';

/**
 * WorkPulse AI assistant (docs/superpowers/specs/2026-11-07-workpulse-ai-assistant-design.md §3).
 * Conversations belong to one member; both tables are tenant-owned (RLS) and tied to their
 * organization with composite foreign keys. Purged by the AI_CONVERSATIONS retention class.
 */
export type AssistantToolCallRow = { name: string; args: unknown; status: 'ok' | 'denied' | 'error' };

export const assistantConversations = pgTable(
  'assistant_conversations',
  {
    id: pk(),
    organizationId: orgId(),
    membershipId: uuid().notNull(),
    title: text().notNull(),
    /** set while a reply streams, so one conversation never streams twice at once */
    streamLockUntil: tstz(),
    createdAt: tstz().notNull().default(sql`now()`),
    updatedAt: tstz().notNull().default(sql`now()`),
    lastMessageAt: tstz(),
  },
  (t) => [
    unique('assistant_conversations_org_id_uq').on(t.organizationId, t.id),
    foreignKey({ columns: [t.organizationId, t.membershipId], foreignColumns: [memberships.organizationId, memberships.id] }),
    index('assistant_conversations_member_idx').on(t.organizationId, t.membershipId, sql`${t.lastMessageAt} desc`),
  ],
);

export const assistantMessages = pgTable(
  'assistant_messages',
  {
    id: pk(),
    organizationId: orgId(),
    conversationId: uuid().notNull(),
    role: text().$type<'user' | 'assistant'>().notNull(),
    content: text().notNull(),
    toolCalls: jsonb().$type<AssistantToolCallRow[]>(),
    navTargets: jsonb().$type<string[]>(),
    errorCode: text(),
    createdAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [
    foreignKey({ columns: [t.organizationId, t.conversationId], foreignColumns: [assistantConversations.organizationId, assistantConversations.id] }).onDelete('cascade'),
    check('assistant_messages_role_ck', sql`${t.role} in ('user', 'assistant')`),
    index('assistant_messages_conversation_idx').on(t.conversationId, t.createdAt),
  ],
);
