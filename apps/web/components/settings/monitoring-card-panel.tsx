'use client';
import type { OrgContextDto } from '@tallywork/contracts';
import { Panel, Switch, useToast } from '@tallywork/ui';
import { errorMessage, useOrgMutation } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { t } from '@/lib/i18n';

/**
 * Whether workers see the "What WorkPulse records" card in the desktop app (an organization
 * setting, hidden unless turned on). Saved as soon as it is switched; running apps pick it up with
 * their next heartbeat.
 */
export function MonitoringCardPanel() {
  const org = useOrg();
  const toast = useToast();
  const shown = (org.organization.settings as { showMonitoringCard?: boolean }).showMonitoringCard === true;
  const m = useOrgMutation<{ settings: { showMonitoringCard: boolean } }, OrgContextDto>('PATCH', '/', {
    onSuccess: (_r, b) => toast.success(`${t(b.settings.showMonitoringCard ? 'monitoringCard.shown' : 'monitoringCard.hidden')} ${t('monitoringCard.applies')}`),
  });
  if (!org.can('org:update')) return null;
  return (
    <Panel title={t('monitoringCard.title')} className="mb-4">
      <div className="flex flex-col gap-2 p-4">
        <Switch
          id="show-monitoring-card"
          checked={m.isPending ? !!m.variables?.settings.showMonitoringCard : shown}
          disabled={m.isPending}
          onCheckedChange={(v) => m.mutate({ settings: { showMonitoringCard: v } }, { onError: (e) => toast.error(errorMessage(e)) })}
          label={t('monitoringCard.label')}
          description={t('monitoringCard.description')}
        />
        {!shown && !m.isPending && <p className="text-xs text-text-muted">{t('monitoringCard.hiddenNote')}</p>}
      </div>
    </Panel>
  );
}
