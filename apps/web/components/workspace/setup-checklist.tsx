'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, X } from 'lucide-react';
import type { OffsetPage, ProjectDto } from '@tallywork/contracts';
import { IconButton, Panel, cx } from '@tallywork/ui';
import { useOrgQuery } from '@/lib/api';
import { useMemberOptions } from '@/lib/members';
import { useOrg } from '@/lib/org';

interface Step {
  key: string;
  label: string;
  hint: string;
  href: string;
  done: boolean | undefined;
}

/**
 * Getting started, for admins of a new organization: each step is marked done from real data
 * (someone invited, a project, rates, a desktop app connected, the tracking policy saved by someone:
 * every organization starts with an empty policy at version 1). It
 * disappears once every step is done, or when dismissed (remembered in this browser).
 */
export function SetupChecklist() {
  const org = useOrg();
  const admin = org.can('org:update');
  const storageKey = `tw.setupDismissed.${org.organization.id}`;
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(storageKey) === '1');
    } catch {
      setDismissed(false);
    }
  }, [storageKey]);
  const on = admin && !dismissed;

  const membersQ = useMemberOptions(on && org.can('members:read'));
  const projectsQ = useOrgQuery<ProjectDto[]>(on && org.can('projects:read') ? '/projects' : null);
  const ratesQ = useOrgQuery<unknown[]>(on && org.can('rates:read') ? '/rates' : null);
  const devicesQ = useOrgQuery<OffsetPage<unknown>>(on && org.can('devices:read') ? '/devices?page=1&page_size=1' : null);
  const policyQ = useOrgQuery<{ version: number }>(on && org.can('policies:read') ? `/policies/ORG/${org.organization.id}` : null);

  if (!on) return null;
  const steps: Step[] = [
    ...(org.can('members:read') ? [{ key: 'invite', label: 'Invite your team', hint: 'Members join with an email invitation.', href: '/workers', done: membersQ.data && membersQ.data.length > 1 }] : []),
    ...(org.can('projects:read') ? [{ key: 'project', label: 'Create a project', hint: 'Time is always tracked to a project.', href: '/projects', done: projectsQ.data && projectsQ.data.length > 0 }] : []),
    ...(org.can('rates:read') ? [{ key: 'rates', label: 'Set pay and bill rates', hint: 'Rates turn approved time into pay and invoices.', href: '/finance/billing', done: ratesQ.data && ratesQ.data.length > 0 }] : []),
    ...(org.can('devices:read') ? [{ key: 'desktop', label: 'Connect the desktop app', hint: 'Members install it and sign in to track time.', href: '/devices', done: devicesQ.data && devicesQ.data.total > 0 }] : []),
    ...(org.can('policies:read') ? [{ key: 'policy', label: 'Review what is tracked', hint: 'Choose activity, screenshots, apps and websites.', href: '/settings/policies', done: policyQ.data && policyQ.data.version > 1 }] : []),
  ];
  // Wait until every step's data is in, so the list does not flash before hiding itself.
  if (!steps.length || steps.some((s) => s.done === undefined)) return null;
  const finished = steps.filter((s) => s.done).length;
  if (finished === steps.length) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(storageKey, '1');
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  return (
    <Panel
      className="mb-4"
      title={`Get started: ${finished} of ${steps.length} done`}
      actions={
        <IconButton label="Hide getting started" size="xs" onClick={dismiss}>
          <X className="size-3.5" />
        </IconButton>
      }
    >
      <ol className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 lg:grid-cols-5" aria-label="Getting started">
        {steps.map((s) => (
          <li key={s.key} className="bg-surface">
            <Link href={`${org.base}${s.href}`} className="flex h-full items-start gap-2.5 px-4 py-3 hover:bg-surface-muted">
              <span className={cx('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border', s.done ? 'border-success bg-success text-on-accent' : 'border-border-strong')} aria-hidden>
                {s.done && <Check className="size-3" />}
              </span>
              <span className="min-w-0">
                <span className={cx('block text-sm font-medium', s.done && 'text-text-muted line-through')}>
                  {s.label}
                  <span className="sr-only">{s.done ? ' (done)' : ' (to do)'}</span>
                </span>
                <span className="block text-xs text-text-muted">{s.hint}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
