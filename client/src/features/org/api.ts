import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import type { OrgProfile } from '@/types/domain';

export interface OrgProfileInput {
  name: string;
  address: string;
}

/** The active org profile — rendered in the app header and used for reports. */
export function useActiveOrgProfile() {
  return useQuery({
    queryKey: ['org-profile', 'active'],
    queryFn: async () => {
      try {
        return unwrap<OrgProfile>((await api.get('/org-profile/active')).data);
      } catch {
        // No active profile configured yet — header falls back to a default.
        return null;
      }
    },
  });
}

export function useOrgProfiles() {
  return useQuery({
    queryKey: ['org-profile', 'list'],
    queryFn: async () => {
      const payload = unwrap((await api.get('/org-profile')).data) as {
        items?: OrgProfile[];
      };
      const items = Array.isArray(payload) ? (payload as OrgProfile[]) : payload.items ?? [];
      return items;
    },
  });
}

export function useAddOrgProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: OrgProfileInput) =>
      unwrap<OrgProfile>((await api.post('/org-profile', input)).data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-profile'] }),
  });
}

export function useUpdateOrgProfile(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<OrgProfileInput> & { isActive?: boolean }) =>
      unwrap<OrgProfile>((await api.patch(`/org-profile/${id}`, input)).data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-profile'] }),
  });
}

export function useDeleteOrgProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => (await api.delete(`/org-profile/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-profile'] }),
  });
}

/** Mark a profile active (single-active-row invariant enforced server-side). */
export function useSetActiveOrgProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) =>
      unwrap<OrgProfile>((await api.patch(`/org-profile/${id}`, { isActive: true })).data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-profile'] }),
  });
}

/**
 * The header background image lives behind auth, so a plain <img src> can't
 * carry the Bearer token — fetch it as a blob and resolve to an object URL.
 * Mirrors UsersPage's UserAvatar pattern. Re-fetches when the stored image
 * path changes (e.g. after an upload or switching the active profile).
 */
export function useOrgImageUrl(id: number | undefined, imagePath: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!id || !imagePath) {
      setUrl(null);
      return;
    }
    let active = true;
    let objectUrl: string | null = null;
    api
      .get(`/org-profile/${id}/image`, { responseType: 'blob' })
      .then((res) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(res.data as Blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        /* no image — caller falls back to a plain background */
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, imagePath]);
  return url;
}
