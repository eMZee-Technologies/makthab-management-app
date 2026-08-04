import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthUser as SharedAuthUser, Role as SharedRole } from '@makthab/shared';

export type Role = SharedRole;
export type AuthUser = SharedAuthUser;

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
  setAuth: (accessToken: string, refreshToken: string, user: AuthUser) => void;
  setAccessToken: (token: string) => void;
  setSession: (accessToken: string, refreshToken?: string, user?: AuthUser) => void;
  clear: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      setAuth: (accessToken, refreshToken, user) => set({ accessToken, refreshToken, user }),
      setAccessToken: (accessToken) => set({ accessToken }),
      setSession: (accessToken, refreshToken, user) =>
        set((s) => ({
          accessToken,
          refreshToken: refreshToken ?? s.refreshToken,
          user: user ?? s.user,
        })),
      clear: () => set({ accessToken: null, refreshToken: null, user: null }),
      isAuthenticated: () => Boolean(get().accessToken && get().user),
    }),
    { name: 'marthab-auth' },
  ),
);

/** Non-reactive accessors for use inside the axios interceptor. */
export const authTokenGetters = {
  getToken: () => useAuthStore.getState().accessToken,
  getRefreshToken: () => useAuthStore.getState().refreshToken,
  setToken: (t: string) => useAuthStore.getState().setAccessToken(t),
  setSession: (accessToken: string, refreshToken?: string, user?: AuthUser) =>
    useAuthStore.getState().setSession(accessToken, refreshToken, user),
  clear: () => useAuthStore.getState().clear(),
};
