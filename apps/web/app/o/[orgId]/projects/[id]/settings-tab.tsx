'use client';
/**
 * The project Settings tab (details form, archive), loaded only when the tab is opened: the form
 * carries the rate fields and the pricing confirmation (bundle budget, QA audit Phase 1).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArchiveRestore } from 'lucide-react';
import type { ClientDto, ProjectDto } from '@tallywork/contracts';
import { Button, ConfirmDialog, Panel, fmtDate, useToast } from '@tallywork/ui';
import { ApiError, errorMessage, useOrgQuery } from '@/lib/api';
import { todayIn, useOrg } from '@/lib/org';
import { useRatePricingConfirm } from '@/components/finance/rate-pricing-confirm';
import { previewRatesFromBody } from '@/components/finance/rate-pricing';
import { ProjectFields } from '@/components/workspace/project-fields';
import { projectPayload, type ProjectForm } from '@/components/workspace/project-form';
import { clientsForProject, projectToForm, useHoursPerDay, useOrgAction } from '@/components/workspace/shared';

export function SettingsTab({ project }: { project: ProjectDto }) {
  const org = useOrg();
  const run = useOrgAction();
  const toast = useToast();
  const clientsQ = useOrgQuery<ClientDto[]>(org.can('clients:read') ? '/clients' : null);
  const hoursPerDay = useHoursPerDay();
  const [f, setF] = useState<ProjectForm>(projectToForm(project, hoursPerDay));
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const pricing = useRatePricingConfirm();
  // The form follows the saved project only while it has no unsaved changes (or right after a save):
  // a background refresh (window focus, someone's timer updating the totals) must not wipe edits.
  const loaded = useRef(projectToForm(project, hoursPerDay));
  const justSaved = useRef(false);
  useEffect(() => {
    const next = projectToForm(project, hoursPerDay);
    setF((cur) => (justSaved.current || JSON.stringify(cur) === JSON.stringify(loaded.current) ? next : cur));
    loaded.current = next;
    justSaved.current = false;
  }, [project, hoursPerDay]);

  // Keep the current client selectable even if it is archived.
  const clients = useMemo(() => clientsForProject(clientsQ.data ?? [], project) ?? [], [clientsQ.data, project]);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const body = projectPayload(f, { hoursPerDay, initial: projectToForm(project, hoursPerDay), canManageRates: org.can('rates:manage') });
      // Rates that would price approved time with no rate are confirmed first (BUG-08).
      const currency = clients.find((c) => c.id === f.client_id)?.currency ?? org.organization.currency;
      if (!(await pricing.confirm(previewRatesFromBody(body, { scope: 'PROJECT', scopeId: project.id }, currency, todayIn(org.organization.timezone))))) return;
      // Before the request: the action refreshes the project before it returns.
      justSaved.current = true;
      await run('PATCH', `/projects/${project.id}`, body);
      toast.success('Project saved');
    } catch (e) {
      justSaved.current = false;
      if (e instanceof ApiError) setErr(e);
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const setArchived = async (archived: boolean) => {
    setBusy(true);
    try {
      await run('POST', `/projects/${project.id}/${archived ? 'archive' : 'restore'}`);
      toast.success(archived ? 'Project archived' : 'Project restored');
      setConfirm(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Panel className="lg:col-span-2" title="Details">
        <form
          className="p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <ProjectFields f={f} setF={setF} err={err} clients={clients} showAssignments={false} projectId={project.id} />
          {pricing.dialog}
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={() => setF(projectToForm(project, hoursPerDay))}>Reset</Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!f.name.trim()}>
              Save changes
            </Button>
          </div>
        </form>
      </Panel>
      <Panel title={project.archived_at ? 'Archived' : 'Archive'}>
        <div className="flex flex-col gap-3 p-4 text-sm text-text-muted">
          {project.archived_at ? (
            <>
              <p>This project was archived on {fmtDate(project.archived_at)}. Nobody can track new time to it.</p>
              <Button icon={<ArchiveRestore className="size-3.5" />} loading={busy} onClick={() => setArchived(false)} className="self-start">
                Restore project
              </Button>
            </>
          ) : (
            <>
              <p>Archiving hides the project from timers and pickers. Tracked time, budgets and invoices are kept.</p>
              <Button variant="danger" icon={<Archive className="size-3.5" />} onClick={() => setConfirm(true)} className="self-start">
                Archive project
              </Button>
            </>
          )}
        </div>
      </Panel>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Archive ${project.name}?`}
        description="Nobody can track new time to it. You can restore it later."
        confirmLabel="Archive"
        danger
        loading={busy}
        onConfirm={() => setArchived(true)}
      />
    </div>
  );
}
