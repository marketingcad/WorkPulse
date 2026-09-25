import { Hono } from 'hono';
import { z } from 'zod';
import {
  budgetInput,
  dateRangeQuery,
  decisionInput,
  expenseInput,
  holidayInput,
  invoiceCreateInput,
  paymentInput,
  rateInput,
  scheduleInput,
  timeOffAdjustInput,
  timeOffPolicyInput,
  timeOffRequestInput,
  breakTypeInput,
  overtimeRulesInput,
} from '@tallywork/contracts';
import type { AppEnv } from '../context';
import { body, idList, query } from '../lib/http';
import { requirePermission } from '../middleware/tenant';
import { ctx } from '../services/ctx';
import {
  addHoliday,
  adjustBalance,
  balances,
  decideTimeOff,
  deleteHoliday,
  deleteSchedule,
  listAttendance,
  listHolidays,
  listSchedules,
  listShifts,
  listTimeOffPolicies,
  listTimeOffRequests,
  requestTimeOff,
  upsertSchedule,
  upsertTimeOffPolicy,
  archiveTimeOffPolicy,
  archiveBreakType,
  getOvertimeRules,
  listBreakTypes,
  setOvertimeRules,
  upsertBreakType,
} from '../services/operations';
import {
  amountsOwed,
  createExpense,
  createInvoice,
  decideExpense,
  deleteBudget,
  deleteRate,
  getInvoice,
  listBudgets,
  listExpenses,
  listInvoices,
  listPayments,
  listRates,
  previewInvoice,
  recordPayment,
  sendInvoice,
  setRate,
  upsertBudget,
  voidInvoice,
  deletePayment,
  deleteDraftInvoice,
} from '../services/finance';
import { renderInvoicePdf } from '../lib/invoice-pdf';

const range = dateRangeQuery.and(z.object({ membership_ids: idList }));

export const opsRoutes = new Hono<AppEnv>()
  .get('/schedules', requirePermission('schedules:read'), async (c) => c.json(await listSchedules(ctx(c), query(c, z.object({ membership_ids: idList })).membership_ids)))
  .post('/schedules', async (c) => c.json(await upsertSchedule(ctx(c), null, await body(c, scheduleInput)), 201))
  .put('/schedules/:id', async (c) => c.json(await upsertSchedule(ctx(c), c.req.param('id'), await body(c, scheduleInput))))
  .delete('/schedules/:id', async (c) => {
    await deleteSchedule(ctx(c), c.req.param('id'));
    return c.body(null, 204);
  })
  .get('/shifts', requirePermission('schedules:read'), async (c) => {
    const q = query(c, range);
    return c.json(await listShifts(ctx(c), q.from, q.to, q.membership_ids));
  })
  .get('/attendance', requirePermission('attendance:read'), async (c) => {
    const q = query(c, range);
    return c.json(await listAttendance(ctx(c), q.from, q.to, q.membership_ids));
  })
  .get('/break-types', async (c) => c.json(await listBreakTypes(ctx(c))))
  .post('/break-types', async (c) => c.json(await upsertBreakType(ctx(c), null, await body(c, breakTypeInput)), 201))
  .put('/break-types/:id', async (c) => c.json(await upsertBreakType(ctx(c), c.req.param('id'), await body(c, breakTypeInput))))
  .delete('/break-types/:id', async (c) => {
    await archiveBreakType(ctx(c), c.req.param('id'));
    return c.body(null, 204);
  })
  .get('/overtime-rules', requirePermission('org:read'), async (c) => c.json(await getOvertimeRules(ctx(c))))
  .put('/overtime-rules', async (c) => c.json(await setOvertimeRules(ctx(c), await body(c, overtimeRulesInput))))
  .get('/holidays', async (c) => c.json(await listHolidays(ctx(c), query(c, z.object({ year: z.coerce.number().int().optional() })).year)))
  .post('/holidays', async (c) => c.json(await addHoliday(ctx(c), await body(c, holidayInput)), 201))
  .delete('/holidays/:id', async (c) => {
    await deleteHoliday(ctx(c), c.req.param('id'));
    return c.body(null, 204);
  })
  .get('/time-off/policies', async (c) => c.json(await listTimeOffPolicies(ctx(c))))
  .post('/time-off/policies', async (c) => c.json(await upsertTimeOffPolicy(ctx(c), null, await body(c, timeOffPolicyInput)), 201))
  .put('/time-off/policies/:id', async (c) => c.json(await upsertTimeOffPolicy(ctx(c), c.req.param('id'), await body(c, timeOffPolicyInput))))
  .post('/time-off/policies/:id/archive', async (c) => {
    await archiveTimeOffPolicy(ctx(c), c.req.param('id'));
    return c.body(null, 204);
  })
  .get('/time-off/balances', async (c) => {
    const x = ctx(c);
    return c.json(await balances(x, query(c, z.object({ membership_id: z.uuid().optional() })).membership_id ?? x.actor.membershipId));
  })
  .post('/time-off/balances/adjust', async (c) => c.json(await adjustBalance(ctx(c), await body(c, timeOffAdjustInput))))
  .get('/time-off/requests', requirePermission('time_off:read'), async (c) => {
    const q = query(c, z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(), from: z.iso.date().optional(), to: z.iso.date().optional(), membership_ids: idList }));
    return c.json(await listTimeOffRequests(ctx(c), { status: q.status, from: q.from, to: q.to, membershipIds: q.membership_ids }));
  })
  .post('/time-off/requests', async (c) => c.json(await requestTimeOff(ctx(c), await body(c, timeOffRequestInput)), 201))
  .post('/time-off/requests/:id/:action{approve|reject|cancel}', async (c) => {
    const i = await body(c, decisionInput);
    await decideTimeOff(ctx(c), c.req.param('id'), c.req.param('action').toUpperCase() as 'APPROVE', i.comment ?? null);
    return c.body(null, 204);
  });

export const financeRoutes = new Hono<AppEnv>()
  .get('/rates', async (c) => c.json(await listRates(ctx(c))))
  .post('/rates', async (c) => c.json(await setRate(ctx(c), await body(c, rateInput)), 201))
  .delete('/rates/:id', async (c) => {
    await deleteRate(ctx(c), c.req.param('id'));
    return c.body(null, 204);
  })
  .get('/billing/amounts-owed', async (c) => {
    const q = query(c, dateRangeQuery);
    return c.json(await amountsOwed(ctx(c), q.from, q.to));
  })
  .get('/budgets', async (c) => c.json(await listBudgets(ctx(c))))
  .put('/budgets', async (c) => c.json(await upsertBudget(ctx(c), await body(c, budgetInput))))
  .delete('/budgets/:id', async (c) => {
    await deleteBudget(ctx(c), c.req.param('id'));
    return c.body(null, 204);
  })
  .get('/expenses', requirePermission('expenses:read'), async (c) => c.json(await listExpenses(ctx(c), query(c, z.object({ status: z.string().max(20).optional(), from: z.iso.date().optional(), to: z.iso.date().optional() })))))
  .post('/expenses', async (c) => c.json(await createExpense(ctx(c), await body(c, expenseInput)), 201))
  .post('/expenses/:id/:action{approve|reject|reimburse}', async (c) => {
    await decideExpense(ctx(c), c.req.param('id'), c.req.param('action').toUpperCase() as 'APPROVE');
    return c.body(null, 204);
  })
  .get('/invoices', async (c) => c.json(await listInvoices(ctx(c), query(c, z.object({ status: z.string().max(20).optional(), client_id: z.uuid().optional() })))))
  .post('/invoices/preview', async (c) => c.json(await previewInvoice(ctx(c), await body(c, invoiceCreateInput))))
  .post('/invoices', async (c) => c.json(await createInvoice(ctx(c), await body(c, invoiceCreateInput)), 201))
  .get('/invoices/:id', async (c) => c.json(await getInvoice(ctx(c), c.req.param('id'))))
  .get('/invoices/:id/pdf', async (c) => {
    const x = ctx(c);
    const inv = await getInvoice(x, c.req.param('id'));
    const pdf = await renderInvoicePdf(inv, x.org);
    return new Response(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${inv.number}.pdf"`, 'Cache-Control': 'private, no-store' } });
  })
  .post('/invoices/:id/send', async (c) => c.json(await sendInvoice(ctx(c), c.req.param('id'))))
  .post('/invoices/:id/void', async (c) => c.json(await voidInvoice(ctx(c), c.req.param('id'))))
  .get('/payments', async (c) => c.json(await listPayments(ctx(c))))
  .post('/payments', async (c) => c.json(await recordPayment(ctx(c), await body(c, paymentInput)), 201))
  .delete('/payments/:id', async (c) => {
    await deletePayment(ctx(c), c.req.param('id'));
    return c.body(null, 204);
  })
  .delete('/invoices/:id', async (c) => {
    await deleteDraftInvoice(ctx(c), c.req.param('id'));
    return c.body(null, 204);
  });
