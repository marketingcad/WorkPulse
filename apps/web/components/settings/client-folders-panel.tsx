'use client';
import type { OrgContextDto } from '@tallywork/contracts';
import { Panel, Switch, useToast } from '@tallywork/ui';
import { errorMessage, useOrgMutation } from '@/lib/api';
import { useOrg } from '@/lib/org';

/**
 * Whether Projects can be organized into client folders (an organization setting, off unless turned
 * on). Turning it off hides the folders and keeps them; projects are never changed either way.
 */
export function ClientFoldersPanel() {
  const org = useOrg();
  const toast = useToast();
  const on = (org.organization.settings as { clientFolders?: boolean }).clientFolders === true;
  const m = useOrgMutation<{ settings: { clientFolders: boolean } }, OrgContextDto>('PATCH', '/', {
    onSuccess: (_r, b) => toast.success(b.settings.clientFolders ? 'Client folders turned on. Find them on the Projects page.' : 'Client folders turned off. They are kept if you turn them on again.'),
  });
  if (!org.can('org:update')) return null;
  return (
    <Panel title="Client folders" className="mt-4">
      <div className="p-4">
        <Switch
          id="client-folders"
          checked={m.isPending ? !!m.variables?.settings.clientFolders : on}
          disabled={m.isPending}
          onCheckedChange={(v) => m.mutate({ settings: { clientFolders: v } }, { onError: (e) => toast.error(errorMessage(e)) })}
          label="Organize projects in client folders"
          description="Adds a Client folders view to Projects, with one folder per client. Projects stay with their client, and the project list works as before."
        />
      </div>
    </Panel>
  );
}
