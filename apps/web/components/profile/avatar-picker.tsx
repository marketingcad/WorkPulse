'use client';
import { useState } from 'react';
import { Check } from 'lucide-react';
import type { AvatarDto, AvatarPresetId } from '@tallywork/contracts';
import { AVATAR_PRESET_GROUPS, Avatar, Button, Dialog, cx, useToast } from '@tallywork/ui';
import { api, errorMessage } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { t } from '@/lib/i18n';

/** Choose one of the curated avatars, with a preview before applying it. */
export function AvatarPicker({ name, current, onClose, onApplied }: { name: string; current: string | null; onClose: () => void; onApplied: (a: AvatarDto) => void }) {
  const org = useOrg();
  const toast = useToast();
  const [chosen, setChosen] = useState<string | null>(current);
  const [saving, setSaving] = useState(false);

  const apply = async () => {
    if (!chosen) return;
    setSaving(true);
    try {
      const r = await api<{ avatar: AvatarDto }>('/me/avatar', { method: 'PUT', body: { preset: chosen as AvatarPresetId } });
      onApplied(r.avatar);
    } catch (e) {
      toast.error(errorMessage(e));
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !saving && onClose()}
      title={t('avatar.picker.title')}
      description={t('avatar.picker.description')}
      width={520}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            {t('avatar.picker.cancel')}
          </Button>
          <Button variant="primary" loading={saving} disabled={!chosen || chosen === current} onClick={apply}>
            {t('avatar.picker.apply')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3 rounded-md bg-surface-muted p-3">
          <Avatar name={name} size={56} seed={org.membership.id} image={chosen ? { kind: 'preset', preset: chosen } : null} label={t('avatar.picker.preview')} className="text-xl transition-transform duration-150 motion-reduce:transition-none" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{name}</div>
            <div className="text-xs text-text-muted">{t('avatar.picker.preview')}</div>
          </div>
        </div>
        {AVATAR_PRESET_GROUPS.map((g) => (
          <fieldset key={g.id} className="flex flex-col gap-2">
            <legend className="mb-1 text-xs font-semibold text-text-muted">{t(`avatar.picker.group.${g.id}`)}</legend>
            <div className="flex flex-wrap gap-2">
              {g.presets.map((p, i) => {
                const on = chosen === p;
                return (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={on}
                    aria-label={t('avatar.picker.option', { group: t(`avatar.picker.group.${g.id}`), n: i + 1 })}
                    onClick={() => setChosen(p)}
                    className={cx(
                      'relative rounded-full p-0.5 transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                      on ? 'ring-2 ring-interactive' : 'ring-1 ring-border hover:ring-border-strong',
                    )}
                  >
                    <Avatar name={name} size={48} image={{ kind: 'preset', preset: p }} />
                    {on && (
                      <span aria-hidden className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-interactive text-on-accent">
                        <Check className="size-3" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
    </Dialog>
  );
}
