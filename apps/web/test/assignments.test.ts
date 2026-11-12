import { describe, expect, it } from 'vitest';
import type { ProjectDto, TaskDto } from '@tallywork/contracts';
import { assignmentsForMember } from '../components/timesheets/assignments';

/**
 * QA audit, 11 Nov 2026 (BUG-09): a manager adding time for a team member saw "not assigned to any
 * active project" because the list was built before the member's teams had loaded.
 */
const project = (over: Partial<ProjectDto>): ProjectDto => ({ id: 'p', name: 'Site', color: '#2563eb', client_name: 'Acme', member_ids: [], team_ids: [], archived_at: null, status: 'ACTIVE', ...over }) as ProjectDto;
const task = (over: Partial<TaskDto>): TaskDto => ({ id: 't', project_id: 'p', title: 'Build', status: 'TODO', ...over }) as TaskDto;

const projects = [
  project({ id: 'team', name: 'Team project', team_ids: ['team-1'] }),
  project({ id: 'direct', name: 'Direct project', member_ids: ['wes'] }),
  project({ id: 'other', name: 'Other team', team_ids: ['team-2'] }),
  project({ id: 'archived', name: 'Archived', member_ids: ['wes'], archived_at: '2026-11-01T00:00:00Z' }),
  project({ id: 'held', name: 'On hold', member_ids: ['wes'], status: 'ON_HOLD' }),
];
const tasks = [task({ id: 't1', project_id: 'team', title: 'Open' }), task({ id: 't2', project_id: 'team', title: 'Finished', status: 'DONE' })];

describe('assignmentsForMember', () => {
  it('is not decided while the member’s teams are still loading (the bug: an empty list said "not assigned")', () => {
    expect(assignmentsForMember('wes', projects, tasks, undefined)).toBeUndefined();
    expect(assignmentsForMember('wes', undefined, tasks, ['team-1'])).toBeUndefined();
    expect(assignmentsForMember('wes', projects, undefined, ['team-1'])).toBeUndefined();
  });

  it('lists active projects the member is on directly or through a team, by name, with open tasks', () => {
    const list = assignmentsForMember('wes', projects, tasks, ['team-1'])!;
    expect(list.map((a) => a.project_id)).toEqual(['direct', 'team']);
    expect(list.find((a) => a.project_id === 'team')!.tasks).toEqual([{ id: 't1', title: 'Open', status: 'TODO' }]);
  });

  it('is an empty list only once everything has loaded', () => {
    expect(assignmentsForMember('nina', projects, tasks, [])).toEqual([]);
  });
});
