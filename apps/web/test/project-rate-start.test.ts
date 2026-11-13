import { describe, expect, it } from 'vitest';
import { projectPayload, type ProjectForm } from '../components/workspace/project-form';

/**
 * QA audit, 11 Nov 2026 (BUG-08): project rates always started today, so time already worked was
 * priced at 0. The form now has a "Rates start" date that is sent with the rates.
 */
// A blank form, as projectToForm(null) builds it.
const blank: ProjectForm = { name: '', client_id: '', description: '', color: '#4B4FC4', status: 'ACTIVE', billable_default: true, member_ids: [], team_ids: [], short_name: '', start_date: '', end_date: '', estimate: '', estimate_unit: 'HOURS', pay_rate: '', bill_rate: '', rates_from: '', breaks: [] };
const base = (over: Partial<ProjectForm> = {}): ProjectForm => ({ ...blank, name: 'Site', ...over });
const saved = (over: Partial<ProjectForm> = {}): ProjectForm => ({ ...base(), pay_rate: '25.00', bill_rate: '100.00', ...over });

describe('projectPayload: rate start date', () => {
  it('a new form starts with no rate date (the server picks the project start date or today)', () => {
    const body = projectPayload(base({ pay_rate: '25', bill_rate: '100' }), { canManageRates: true });
    expect(body).toMatchObject({ pay_rate_minor: 2500, bill_rate_minor: 10000 });
    expect(body).not.toHaveProperty('rate_effective_from');
  });

  it('sends the chosen date with the rates', () => {
    const body = projectPayload(base({ pay_rate: '25', bill_rate: '100', rates_from: '2026-11-01' }), { canManageRates: true });
    expect(body).toMatchObject({ pay_rate_minor: 2500, bill_rate_minor: 10000, rate_effective_from: '2026-11-01' });
  });

  it('editing: a date alone re-sends the unchanged amounts so they can start earlier', () => {
    const initial = saved();
    const body = projectPayload(saved({ rates_from: '2026-11-01' }), { canManageRates: true, initial });
    expect(body).toEqual({ pay_rate_minor: 2500, bill_rate_minor: 10000, rate_effective_from: '2026-11-01' });
  });

  it('editing without a date leaves unchanged rates out, as before', () => {
    const initial = saved();
    expect(projectPayload(saved({ name: 'Site 2' }), { canManageRates: true, initial })).toEqual({ name: 'Site 2' });
  });

  it('a date never clears an empty rate, and nothing is sent without rates:manage', () => {
    const initial = saved({ pay_rate: '' });
    expect(projectPayload(saved({ pay_rate: '', rates_from: '2026-11-01' }), { canManageRates: true, initial })).toEqual({ bill_rate_minor: 10000, rate_effective_from: '2026-11-01' });
    expect(projectPayload(saved({ rates_from: '2026-11-01' }), { canManageRates: false, initial: saved() })).toEqual({});
  });
});
