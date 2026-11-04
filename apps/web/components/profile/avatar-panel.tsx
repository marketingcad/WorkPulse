'use client';
import { useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Camera, ImagePlus, Loader2, Shapes, Trash2 } from 'lucide-react';
import type { AvatarDto, MeDto } from '@tallywork/contracts';
import { AVATAR_UPLOAD } from '@tallywork/contracts/avatars';
import { Button, ConfirmDialog, Panel, cx, useToast } from '@tallywork/ui';
import { api, errorMessage } from '@/lib/api';
import { MyAvatar, useRefreshAvatars } from '@/lib/avatars';
import { t } from '@/lib/i18n';
import { precheck } from './crop';

// Loaded when opened: the editor and the collection stay out of every page's first load.
const AvatarEditor = dynamic(() => import('./avatar-editor').then((m) => m.AvatarEditor));
const AvatarPicker = dynamic(() => import('./avatar-picker').then((m) => m.AvatarPicker));

/** The picture's natural size, or null when the browser cannot open it. */
function readImage(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Profile picture settings: upload (with crop), a curated avatar, or initials. The server checks and
 * re-encodes every upload; the checks here only spare a round trip for obvious mistakes.
 */
export function AvatarPanel({ me }: { me: MeDto }) {
  const toast = useToast();
  const refresh = useRefreshAvatars();
  const input = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<{ url: string; width: number; height: number } | null>(null);
  const [picking, setPicking] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const avatar = me.user.avatar;

  const open = async (file: File | undefined) => {
    if (!file) return;
    const problem = precheck(file, { maxBytes: AVATAR_UPLOAD.maxBytes, types: AVATAR_UPLOAD.types });
    if (problem) return toast.error(t(problem === 'type' ? 'avatar.error.type' : 'avatar.error.size'));
    const url = URL.createObjectURL(file);
    const size = await readImage(url);
    if (!size) {
      URL.revokeObjectURL(url);
      return toast.error(t('avatar.error.read'));
    }
    if (size.width > AVATAR_UPLOAD.maxSide || size.height > AVATAR_UPLOAD.maxSide) {
      URL.revokeObjectURL(url);
      return toast.error(t('avatar.error.dimensions', { max: AVATAR_UPLOAD.maxSide }));
    }
    setEditing({ url, ...size });
  };

  const closeEditor = () => {
    if (editing) URL.revokeObjectURL(editing.url);
    setEditing(null);
    if (input.current) input.current.value = '';
  };

  const save = async (blob: Blob) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', new File([blob], blob.type === 'image/webp' ? 'avatar.webp' : 'avatar.png', { type: blob.type }));
      const r = await api<{ avatar: AvatarDto }>('/me/avatar', { method: 'POST', body: form });
      refresh(r.avatar);
      toast.success(t('avatar.saved'));
      closeEditor();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api('/me/avatar', { method: 'DELETE' });
      refresh(null);
      setRemoving(false);
      toast.success(t('avatar.removed'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title={t('avatar.title')}>
      <div
        className={cx('flex flex-col items-center gap-4 rounded-md border border-dashed p-4 text-center transition-colors sm:flex-row sm:items-start sm:text-left', dragging ? 'border-interactive bg-interactive-soft' : 'border-transparent')}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void open(e.dataTransfer.files[0]);
        }}
        aria-busy={busy}
      >
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          aria-label={t('avatar.change')}
          className="group relative shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-wait"
        >
          <MyAvatar size={96} className="text-3xl" />
          <span
            aria-hidden
            className={cx(
              'absolute inset-0 flex items-center justify-center rounded-full bg-text/55 text-surface transition-opacity duration-150 motion-reduce:transition-none',
              busy ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
            )}
          >
            {busy ? <Loader2 className="size-6 animate-spin" /> : <Camera className="size-6" />}
          </span>
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div>
            <div className="truncate font-semibold">{me.user.name}</div>
            <p className="mt-0.5 text-sm text-text-muted">{dragging ? t('avatar.drop') : t('avatar.description')}</p>
          </div>
          <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
            <Button variant="primary" size="sm" icon={<ImagePlus className="size-3.5" />} onClick={() => input.current?.click()} disabled={busy}>
              {avatar?.kind === 'photo' ? t('avatar.replace') : t('avatar.upload')}
            </Button>
            <Button size="sm" icon={<Shapes className="size-3.5" />} onClick={() => setPicking(true)} disabled={busy}>
              {t('avatar.choose')}
            </Button>
            {avatar && (
              <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setRemoving(true)} disabled={busy}>
                {t('avatar.remove')}
              </Button>
            )}
          </div>
          <p className="text-xs text-text-faint">{avatar ? t('avatar.constraints') : `${t('avatar.initials')} ${t('avatar.constraints')}`}</p>
          {busy && (
            <p role="status" className="text-xs text-text-muted">
              {t('avatar.saving')}
            </p>
          )}
        </div>
        <input ref={input} type="file" accept={AVATAR_UPLOAD.types.join(',')} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void open(e.target.files?.[0])} />
      </div>

      {editing && <AvatarEditor src={editing.url} width={editing.width} height={editing.height} saving={busy} onCancel={closeEditor} onSave={save} />}
      {picking && (
        <AvatarPicker
          name={me.user.name}
          current={avatar?.kind === 'preset' ? avatar.preset : null}
          onClose={() => setPicking(false)}
          onApplied={(a) => {
            refresh(a);
            setPicking(false);
            toast.success(t('avatar.presetSaved'));
          }}
        />
      )}
      <ConfirmDialog open={removing} onOpenChange={setRemoving} title={t('avatar.removeTitle')} description={t('avatar.removeBody')} confirmLabel={t('avatar.remove')} danger loading={busy} onConfirm={remove} />
    </Panel>
  );
}
