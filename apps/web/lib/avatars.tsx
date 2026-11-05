'use client';
import { useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeDto, MemberAvatarDto } from '@tallywork/contracts';
import { Avatar, PersonCell, type AvatarImage } from '@tallywork/ui';
import { api, useOrgId, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';

/**
 * Members' profile pictures: one cached request per organization for a whole screen (the server
 * returns only the members the caller may see; anyone else shows initials). The picture addresses
 * change when a picture does, so the browser keeps the images themselves.
 */
export function useMemberAvatars(): Map<string, AvatarImage> {
  const q = useOrgQuery<MemberAvatarDto[]>('/avatars', { staleTime: 5 * 60_000 });
  return useMemo(() => new Map((q.data ?? []).map((a) => [a.membership_id, a.avatar])), [q.data]);
}

/** A member's avatar: their picture when the caller may see it, otherwise their initials. */
export function MemberAvatar({ membershipId, name, size, className, label }: { membershipId: string | null | undefined; name: string; size?: number; className?: string; label?: string }) {
  const avatars = useMemberAvatars();
  return <Avatar name={name} size={size} className={className} label={label} seed={membershipId ?? undefined} image={membershipId ? avatars.get(membershipId) : null} />;
}

/** The signed-in person's own avatar (from /me, so it changes as soon as they save a new one). */
export function MyAvatar({ size, className, label }: { size?: number; className?: string; label?: string }) {
  const org = useOrg();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<MeDto>('/me') }).data;
  return <Avatar name={me?.user.name ?? ''} size={size} className={className} label={label} seed={org.membership.id} image={me?.user.avatar} />;
}

/** After the person changes their picture: their own and the organization's avatar lists refresh. */
export function useRefreshAvatars() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  return (me?: MeDto['user']['avatar']) => {
    if (me !== undefined) qc.setQueryData<MeDto>(['me'], (old) => (old ? { ...old, user: { ...old.user, avatar: me } } : old));
    void qc.invalidateQueries({ queryKey: ['me'] });
    void qc.invalidateQueries({ queryKey: ['org', orgId, '/avatars'] });
  };
}

/** A member's name with their avatar (the shared PersonCell, with their picture when visible). */
export function MemberCell({ membershipId, name, sub, size }: { membershipId: string | null | undefined; name: string; sub?: ReactNode; size?: number }) {
  const avatars = useMemberAvatars();
  return <PersonCell name={name} sub={sub} size={size} seed={membershipId ?? undefined} image={membershipId ? avatars.get(membershipId) : null} />;
}
