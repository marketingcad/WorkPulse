import type { AgentAvatarDto } from '@tallywork/contracts';
import { Avatar, type AvatarImage } from '@tallywork/ui';
import type { AgentState } from '../../shared/ipc';
import { useMe } from './lib';

/**
 * The signed-in worker's own avatar: their picture or curated avatar from the server (only ever their
 * own), in the same colors as on the website. Offline, or before it loads, their initials.
 */
export function WorkerAvatar({ s, size = 28, className }: { s: AgentState; size?: number; className?: string }) {
  // Refreshed now and then, so a picture changed on the website shows here too.
  const q = useMe<AgentAvatarDto>('avatar', {}, { refreshMs: 10 * 60_000 });
  const a = q.data?.avatar;
  const image: AvatarImage = a?.kind === 'photo' ? { kind: 'photo', url: a.data_url } : a?.kind === 'preset' ? { kind: 'preset', preset: a.preset } : null;
  return <Avatar name={s.account?.name ?? ''} size={size} seed={s.account?.membershipId} image={image} className={className} />;
}
