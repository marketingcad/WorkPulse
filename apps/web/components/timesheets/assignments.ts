import type { ProjectDto, TaskDto } from '@tallywork/contracts';
import type { Assignment } from '../project-task-picker';

/**
 * The projects and tasks another member can log time to, from /projects, /tasks and the member's
 * teams: active projects they are on directly or through a team, with the tasks not done.
 * Pure (unit-tested in test/assignments.test.ts).
 *
 * QA audit 11 Nov 2026 (BUG-09): the list used to be built before the member's teams had loaded, so a
 * manager adding time for a team member saw "not assigned to any active project" until it arrived (or
 * for good, when that request failed). `teamIds` undefined means "not loaded yet": the answer is then
 * undefined too, never an empty list.
 */
export function assignmentsForMember(membershipId: string, projects: ProjectDto[] | undefined, tasks: TaskDto[] | undefined, teamIds: string[] | undefined): Assignment[] | undefined {
  if (!projects || !tasks || !teamIds) return undefined;
  const teams = new Set(teamIds);
  return projects
    .filter((p) => !p.archived_at && p.status === 'ACTIVE' && (p.member_ids.includes(membershipId) || p.team_ids.some((t) => teams.has(t))))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map<Assignment>((p) => ({
      project_id: p.id,
      project_name: p.name,
      color: p.color,
      client_name: p.client_name,
      tasks: tasks.filter((t) => t.project_id === p.id && t.status !== 'DONE').map((t) => ({ id: t.id, title: t.title, status: t.status })),
    }));
}
