import { sql } from 'drizzle-orm';
import { bigint, boolean, index, integer, numeric, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { RateKind, RateScope } from '@tallywork/domain';
import { orgId, pk, timestamps, tstz } from './_helpers';

export const billingRates = pgTable(
  'billing_rates',
  {
    id: pk(),
    organizationId: orgId(),
    kind: text().$type<RateKind>().notNull(),
    scope: text().$type<RateScope>().notNull(),
    scopeId: text(),
    amountMinor: bigint({ mode: 'number' }).notNull(),
    currency: text().notNull(),
    effectiveFrom: text().notNull(),
    effectiveTo: text(),
    createdBy: uuid(),
    ...timestamps,
  },
  (t) => [index().on(t.organizationId, t.kind, t.scope, t.scopeId)],
);

/** Price snapshot created when a timesheet is approved. */
export const billingEntries = pgTable(
  'billing_entries',
  {
    id: pk(),
    organizationId: orgId(),
    timeEntryId: uuid().notNull(),
    revision: integer().notNull(),
    timesheetId: uuid(),
    membershipId: uuid().notNull(),
    projectId: uuid().notNull(),
    clientId: uuid(),
    taskId: uuid(),
    localDate: text().notNull(),
    seconds: integer().notNull(),
    billable: boolean().notNull(),
    billRateId: uuid(),
    payRateId: uuid(),
    billAmountMinor: bigint({ mode: 'number' }).notNull().default(0),
    payAmountMinor: bigint({ mode: 'number' }).notNull().default(0),
    currency: text().notNull(),
    invoiceLineId: uuid(),
    voidedAt: tstz(),
    createdAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex('billing_entries_active_uq').on(t.timeEntryId).where(sql`${t.voidedAt} is null`),
    index().on(t.organizationId, t.clientId, t.localDate),
    index().on(t.organizationId, t.membershipId, t.localDate),
  ],
);

export const budgets = pgTable(
  'budgets',
  {
    id: pk(),
    organizationId: orgId(),
    subjectType: text().$type<'PROJECT' | 'CLIENT'>().notNull(),
    subjectId: uuid().notNull(),
    kind: text().$type<'HOURS' | 'MONEY'>().notNull(),
    /** seconds for HOURS, minor units for MONEY */
    amount: bigint({ mode: 'number' }).notNull(),
    period: text().$type<'TOTAL' | 'MONTHLY'>().notNull().default('TOTAL'),
    warnPct: integer().notNull().default(80),
    includeNonBillable: boolean().notNull().default(false),
    startDate: text(),
    endDate: text(),
    lastNotifiedLevel: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [unique().on(t.organizationId, t.subjectType, t.subjectId)],
);

export const fileObjects = pgTable('file_objects', {
  id: pk(),
  organizationId: orgId(),
  purpose: text().$type<'SCREENSHOT' | 'THUMBNAIL' | 'RECEIPT' | 'INVOICE_PDF' | 'EXPORT' | 'AVATAR'>().notNull(),
  storageKey: text().notNull(),
  contentType: text().notNull(),
  bytes: integer(),
  sha256: text(),
  uploadedBy: uuid(),
  createdAt: tstz().notNull().default(sql`now()`),
});

export const expenses = pgTable(
  'expenses',
  {
    id: pk(),
    organizationId: orgId(),
    membershipId: uuid().notNull(),
    projectId: uuid(),
    clientId: uuid(),
    category: text().notNull(),
    description: text(),
    amountMinor: bigint({ mode: 'number' }).notNull(),
    currency: text().notNull(),
    spentOn: text().notNull(),
    receiptFileId: uuid(),
    billable: boolean().notNull().default(false),
    reimbursable: boolean().notNull().default(true),
    status: text().$type<'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'REIMBURSED'>().notNull().default('SUBMITTED'),
    decidedBy: uuid(),
    decidedAt: tstz(),
    reimbursedAt: tstz(),
    invoiceLineId: uuid(),
    ...timestamps,
  },
  (t) => [index().on(t.organizationId, t.status), index().on(t.organizationId, t.membershipId, t.spentOn)],
);

export const invoiceSequences = pgTable('invoice_sequences', {
  organizationId: uuid().primaryKey(),
  prefix: text().notNull().default('INV-'),
  next: integer().notNull().default(1001),
});

export const invoices = pgTable(
  'invoices',
  {
    id: pk(),
    organizationId: orgId(),
    clientId: uuid().notNull(),
    number: text().notNull(),
    status: text().$type<'DRAFT' | 'SENT' | 'VOID'>().notNull().default('DRAFT'),
    issueDate: text().notNull(),
    dueDate: text().notNull(),
    periodStart: text(),
    periodEnd: text(),
    currency: text().notNull(),
    subtotalMinor: bigint({ mode: 'number' }).notNull().default(0),
    taxMinor: bigint({ mode: 'number' }).notNull().default(0),
    totalMinor: bigint({ mode: 'number' }).notNull().default(0),
    paidMinor: bigint({ mode: 'number' }).notNull().default(0),
    notes: text(),
    sentAt: tstz(),
    voidedAt: tstz(),
    createdBy: uuid(),
    ...timestamps,
  },
  (t) => [unique().on(t.organizationId, t.number), index().on(t.organizationId, t.clientId), index().on(t.organizationId, t.status)],
);

export const invoiceLines = pgTable(
  'invoice_lines',
  {
    id: pk(),
    organizationId: orgId(),
    invoiceId: uuid().notNull().references(() => invoices.id, { onDelete: 'cascade' }),
    kind: text().$type<'TIME' | 'EXPENSE' | 'CUSTOM'>().notNull(),
    description: text().notNull(),
    quantity: numeric({ precision: 12, scale: 4, mode: 'number' }).notNull(),
    unitPriceMinor: bigint({ mode: 'number' }).notNull(),
    taxRateBps: integer().notNull().default(0),
    amountMinor: bigint({ mode: 'number' }).notNull(),
    taxMinor: bigint({ mode: 'number' }).notNull().default(0),
    projectId: uuid(),
    position: integer().notNull().default(0),
  },
  (t) => [index().on(t.invoiceId)],
);

export const payments = pgTable(
  'payments',
  {
    id: pk(),
    organizationId: orgId(),
    clientId: uuid(),
    provider: text().notNull().default('manual'),
    providerRef: text(),
    amountMinor: bigint({ mode: 'number' }).notNull(),
    currency: text().notNull(),
    receivedOn: text().notNull(),
    status: text().$type<'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED'>().notNull().default('SUCCEEDED'),
    note: text(),
    createdBy: uuid(),
    ...timestamps,
  },
  (t) => [uniqueIndex('payments_provider_ref_uq').on(t.provider, t.providerRef).where(sql`${t.providerRef} is not null`), index().on(t.organizationId, t.receivedOn)],
);

export const paymentAllocations = pgTable(
  'payment_allocations',
  {
    id: pk(),
    organizationId: orgId(),
    paymentId: uuid().notNull().references(() => payments.id, { onDelete: 'cascade' }),
    invoiceId: uuid().notNull().references(() => invoices.id),
    amountMinor: bigint({ mode: 'number' }).notNull(),
    createdAt: tstz().notNull().default(sql`now()`),
  },
  (t) => [index().on(t.invoiceId)],
);
