'use client';
import { useId, useState } from 'react';
import type { AchievementAwardDto } from '@tallywork/contracts';
import { Button, Dialog, Field, Textarea, useToast } from '@tallywork/ui';
import { ApiError, errorMessage, useOrgMutation } from '@/lib/api';
import { t } from './i18n';
import './messages/achievement-forms';

/** Take back an award given by mistake, with a reason (kept in the audit log). Loaded when opened. */
export default function RevokeDialog({ award, onClose }: { award: AchievementAwardDto; onClose: () => void }) {
  const toast = useToast();
  const id = useId();
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const revoke = useOrgMutation<{ reason: string }>('POST', `/performance/awards/${award.id}/revoke`, { invalidate: ['/performance'] });
  const submit = async () => {
    setTried(true);
    if (!reason.trim()) return;
    try {
      await revoke.mutateAsync({ reason: reason.trim() });
      toast.success(t('perf.ach.revoke.done'));
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.title : errorMessage(e));
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('perf.ach.revoke.title', { name: award.name, who: award.recipient.name })}
      description={t('perf.ach.revoke.description')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="danger" onClick={submit} loading={revoke.isPending}>
            {t('perf.ach.revoke.confirm')}
          </Button>
        </>
      }
    >
      <Field label={t('perf.ach.revoke.reason')} htmlFor={`${id}-reason`} hint={t('perf.ach.revoke.reasonHint')} required error={tried && !reason.trim() ? t('perf.ach.revoke.reasonRequired') : null}>
        <Textarea id={`${id}-reason`} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={tried && !reason.trim()} />
      </Field>
    </Dialog>
  );
}
