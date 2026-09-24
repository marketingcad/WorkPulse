'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, CircleCheck, CircleMinus, Laptop } from 'lucide-react';
import type { MeDto } from '@tallywork/contracts';
import { Button, Spinner, cx } from '@tallywork/ui';
import { AuthShell } from '@/components/auth-shell';
import { ApiError, api } from '@/lib/api';

/**
 * Strict loopback check for the desktop app's redirect (RFC 8252 §7.3):
 * only http://127.0.0.1:<port>/… or http://localhost:<port>/…, explicit port,
 * no credentials and no fragment.
 */
function validateRedirect(raw: string | null): URL | null {
  if (!raw || raw.length > 2000) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:') return null;
  if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') return null;
  if (!/^\d{1,5}$/.test(u.port)) return null;
  const port = Number(u.port);
  if (port < 1 || port > 65535) return null;
  if (u.username || u.password || u.hash) return null;
  // Reject anything the URL parser normalised away (e.g. "http://127.0.0.1:80@evil.com").
  if (!raw.toLowerCase().startsWith(`http://${u.hostname}:${u.port}/`) && raw.toLowerCase() !== `http://${u.hostname}:${u.port}`) return null;
  return u;
}

const CHALLENGE_RE = /^[A-Za-z0-9\-._~]{43,128}$/;

export default function DeviceAuthorizePage() {
  return (
    <AuthShell title="Sign in to the Tallywork desktop app" subtitle="Connect this computer to your organization so you can track time from the desktop.">
      <Suspense
        fallback={
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        }
      >
        <Authorize />
      </Suspense>
    </AuthShell>
  );
}

function Authorize() {
  const params = useSearchParams();
  const challenge = params.get('code_challenge');
  const state = params.get('state');
  const redirect = useMemo(() => validateRedirect(params.get('redirect_uri')), [params]);
  const paramError = !redirect ? 'The desktop app sent an invalid return address. Only http://127.0.0.1:<port> or http://localhost:<port> is accepted.' : !challenge || !CHALLENGE_RE.test(challenge) ? 'The sign-in request is missing a valid code challenge.' : state !== null && state.length > 512 ? 'The sign-in request state is too long.' : null;

  const [me, setMe] = useState<MeDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (paramError) return;
    let cancelled = false;
    (async () => {
      const res = await fetch('/api/v1/me', { credentials: 'same-origin' }).catch(() => null);
      if (cancelled) return;
      if (res?.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        return;
      }
      if (!res || !res.ok) {
        setLoadError('Could not load your account. Try again.');
        return;
      }
      const data = (await res.json()) as MeDto;
      setMe(data);
      let last: string | null = null;
      try {
        last = localStorage.getItem('tw.lastOrg');
      } catch {
        /* ignore */
      }
      setOrgId((data.organizations.find((o) => o.id === last) ?? data.organizations[0])?.id ?? '');
    })();
    return () => {
      cancelled = true;
    };
  }, [paramError]);

  if (paramError)
    return (
      <div role="alert" className="flex items-start gap-2.5 rounded-sm bg-danger-soft px-3 py-3 text-sm text-danger">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div>
          <p className="font-medium">This sign-in link cannot be used</p>
          <p className="mt-0.5">{paramError} Start sign-in again from the desktop app.</p>
        </div>
      </div>
    );
  if (loadError)
    return (
      <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
        {loadError}
      </p>
    );
  if (!me)
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  if (!me.organizations.length)
    return (
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-text-muted">You are signed in as {me.user.email}, but you are not a member of any organization yet. Ask your admin for an invitation, or create an organization first.</p>
        <Link href="/welcome" className="font-medium text-interactive hover:underline">
          Create an organization
        </Link>
      </div>
    );

  const authorize = async () => {
    if (!orgId || !redirect || !challenge) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const r = await api<{ code: string }>('/agent/authorize', { method: 'POST', body: { code_challenge: challenge, organization_id: orgId } });
      const target = new URL(redirect.toString());
      target.searchParams.set('code', r.code);
      if (state !== null) target.searchParams.set('state', state);
      setDone(true);
      window.location.assign(target.toString());
    } catch (e) {
      setSubmitError(e instanceof ApiError ? e.title : 'Could not authorize the desktop app');
      setSubmitting(false);
    }
  };

  if (done)
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <CircleCheck className="size-8 text-success" aria-hidden />
        <p className="font-medium">Desktop app connected</p>
        <p className="text-sm text-text-muted">You can close this tab and return to the Tallywork desktop app.</p>
      </div>
    );

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-text-muted">
        Signed in as <span className="font-medium text-text">{me.user.email}</span>.
      </p>

      <fieldset>
        <legend className="mb-2 text-xs font-medium text-text-muted">Organization</legend>
        <div className="flex flex-col gap-1.5">
          {me.organizations.map((o) => (
            <label key={o.id} className={cx('flex cursor-pointer items-center gap-3 rounded-sm border px-3 py-2 text-sm', orgId === o.id ? 'border-interactive bg-interactive-soft/40' : 'border-border hover:bg-surface-muted')}>
              <input type="radio" name="org" value={o.id} checked={orgId === o.id} onChange={() => setOrgId(o.id)} className="accent-[var(--color-interactive)]" />
              <span className="min-w-0 flex-1 truncate font-medium">{o.name}</span>
              <span className="text-xs text-text-muted">{o.role_name}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <section className="rounded-sm border border-border bg-surface-muted/50 p-3 text-sm">
        <h2 className="mb-2 flex items-center gap-2 font-semibold">
          <Laptop className="size-4 text-text-muted" aria-hidden /> What the desktop app does
        </h2>
        <ul className="flex flex-col gap-1.5 text-text-muted">
          <li className="flex gap-2">
            <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-interactive" aria-hidden />
            Tracks time on the projects and tasks you choose, only while the timer runs.
          </li>
          <li className="flex gap-2">
            <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-interactive" aria-hidden />
            Depending on your organization’s policy: activity levels (counts of input, never keystrokes), idle time, screenshots, app names and websites.
          </li>
          <li className="flex gap-2">
            <CircleMinus className="mt-0.5 size-3.5 shrink-0 text-text-faint" aria-hidden />
            Nothing is collected when tracking is stopped. Location is never collected.
          </li>
        </ul>
        {orgId && (
          <Link href={`/o/${orgId}/me/monitoring`} target="_blank" className="mt-2 inline-block text-xs font-medium text-interactive hover:underline">
            See exactly what this organization monitors →
          </Link>
        )}
      </section>

      {submitError && (
        <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
          {submitError}
        </p>
      )}
      <Button variant="primary" size="md" className="w-full" loading={submitting} disabled={!orgId} onClick={authorize}>
        Authorize desktop app
      </Button>
      <p className="text-xs text-text-faint">
        Only approve this if you just started sign-in from the Tallywork desktop app on this computer. You will be returned to{' '}
        <span className="font-mono">
          {redirect!.hostname}:{redirect!.port}
        </span>
        .
      </p>
    </div>
  );
}
