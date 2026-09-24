'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { MeDto } from '@tallywork/contracts';
import { Logo, Spinner } from '@tallywork/ui';
import { api } from '@/lib/api';

/** Entry: route to the last-used (or first) organization, or to sign-in. */
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    api<MeDto>('/me')
      .then((me) => {
        let last: string | null = null;
        try {
          last = localStorage.getItem('tw.lastOrg');
        } catch {
          /* ignore */
        }
        const target = me.organizations.find((o) => o.id === last) ?? me.organizations[0];
        router.replace(target ? `/o/${target.id}` : '/welcome');
      })
      .catch(() => router.replace('/login'));
  }, [router]);
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3">
      <Logo size={36} className="text-[#0f2240] dark:text-white" />
      <Spinner />
    </div>
  );
}
