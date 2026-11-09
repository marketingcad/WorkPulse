import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { assistantConversations, assistantMessages, type Tx } from '@tallywork/db';
import { isUuid, newId, notFound } from '@tallywork/domain';
import { resolveNav } from '@tallywork/domain/assistant';
import type { AssistantConversationDto, AssistantMessageDto, OffsetPage } from '@tallywork/contracts';
import type { Ctx } from '../ctx';

type ConversationRow = typeof assistantConversations.$inferSelect;
type MessageRow = typeof assistantMessages.$inferSelect;

const MESSAGE_LIMIT = 200;

const toDto = (r: ConversationRow): AssistantConversationDto => ({
  id: r.id,
  title: r.title,
  created_at: r.createdAt.toISOString(),
  last_message_at: r.lastMessageAt ? r.lastMessageAt.toISOString() : null,
});

/** Nav links are resolved again from the stored keys, so a lost permission drops the link. */
export function toMessageDto(x: Ctx, m: MessageRow): AssistantMessageDto {
  const nav = (m.navTargets ?? []).flatMap((k) => {
    const r = resolveNav(x.actor.grants, x.org.id, k);
    return r ? [r] : [];
  });
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    tool_calls: (m.toolCalls ?? []).map((c) => ({ name: c.name, status: c.status })),
    nav,
    error_code: m.errorCode,
    created_at: m.createdAt.toISOString(),
  };
}

/** The member's own conversation. Someone else's, another organization's or a bad id is a 404. */
export async function ownedConversation(tx: Tx, x: Ctx, id: string): Promise<ConversationRow> {
  if (!isUuid(id)) throw notFound('conversation');
  const [row] = await tx
    .select()
    .from(assistantConversations)
    .where(and(eq(assistantConversations.id, id), eq(assistantConversations.organizationId, x.org.id), eq(assistantConversations.membershipId, x.actor.membershipId)))
    .limit(1);
  if (!row) throw notFound('conversation');
  return row;
}

export async function listConversations(x: Ctx, q: { page: number; pageSize: number }): Promise<OffsetPage<AssistantConversationDto>> {
  const where = and(eq(assistantConversations.organizationId, x.org.id), eq(assistantConversations.membershipId, x.actor.membershipId));
  const [count] = await x.tx.select({ n: sql<number>`count(*)::int` }).from(assistantConversations).where(where);
  const rows = await x.tx
    .select()
    .from(assistantConversations)
    .where(where)
    .orderBy(sql`coalesce(${assistantConversations.lastMessageAt}, ${assistantConversations.createdAt}) desc`, desc(assistantConversations.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  return { data: rows.map(toDto), total: count?.n ?? 0, page: q.page, page_size: q.pageSize };
}

export async function createConversation(x: Ctx, title?: string): Promise<AssistantConversationDto> {
  const [row] = await x.tx
    .insert(assistantConversations)
    .values({ id: newId(), organizationId: x.org.id, membershipId: x.actor.membershipId, title: title ?? 'New chat' })
    .returning();
  return toDto(row!);
}

export async function getConversation(x: Ctx, id: string): Promise<AssistantConversationDto & { messages: AssistantMessageDto[] }> {
  const conv = await ownedConversation(x.tx, x, id);
  const rows = await x.tx
    .select()
    .from(assistantMessages)
    .where(and(eq(assistantMessages.organizationId, x.org.id), eq(assistantMessages.conversationId, conv.id)))
    .orderBy(asc(assistantMessages.createdAt), asc(assistantMessages.id))
    .limit(MESSAGE_LIMIT);
  return { ...toDto(conv), messages: rows.map((m) => toMessageDto(x, m)) };
}

export async function renameConversation(x: Ctx, id: string, title: string): Promise<AssistantConversationDto> {
  const conv = await ownedConversation(x.tx, x, id);
  const [row] = await x.tx
    .update(assistantConversations)
    .set({ title, updatedAt: x.deps.now() })
    .where(and(eq(assistantConversations.id, conv.id), eq(assistantConversations.organizationId, x.org.id), eq(assistantConversations.membershipId, x.actor.membershipId)))
    .returning();
  return toDto(row!);
}

export async function deleteConversation(x: Ctx, id: string): Promise<void> {
  const conv = await ownedConversation(x.tx, x, id);
  await x.tx.delete(assistantConversations).where(and(eq(assistantConversations.id, conv.id), eq(assistantConversations.organizationId, x.org.id), eq(assistantConversations.membershipId, x.actor.membershipId)));
}
