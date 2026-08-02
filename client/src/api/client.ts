import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import { authTokenGetters } from '@/store/authStore';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1';

/**
 * Shared axios instance. `withCredentials` lets the browser send the
 * httpOnly refresh-token cookie to the refresh endpoint (doc §3.3).
 */
export const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

// Attach the bearer access token to every request.
api.interceptors.request.use((config) => {
  const token = authTokenGetters.getToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ---- Token refresh handling -------------------------------------------------
// On a 401 we attempt a single silent refresh, then replay the original
// request. Concurrent 401s share the same in-flight refresh promise.
let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const refreshToken = authTokenGetters.getRefreshToken();
  if (!refreshToken) throw new Error('No refresh token available');
  const resp = await axios.post(
    `${API_URL}/auth/refresh`,
    { refreshToken },
    { withCredentials: true },
  );
  const token: string | undefined = resp.data?.data?.accessToken ?? resp.data?.accessToken;
  if (!token) throw new Error('No access token in refresh response');
  authTokenGetters.setToken(token);
  return token;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined;
    const status = error.response?.status;
    const isAuthCall = original?.url?.includes('/auth/login') || original?.url?.includes('/auth/refresh');

    if (status === 401 && original && !original._retry && !isAuthCall) {
      original._retry = true;
      try {
        refreshPromise = refreshPromise ?? refreshAccessToken();
        const token = await refreshPromise;
        refreshPromise = null;
        original.headers = original.headers ?? {};
        (original.headers as Record<string, string>).Authorization = `Bearer ${token}`;
        return api(original);
      } catch (refreshErr) {
        refreshPromise = null;
        authTokenGetters.clear();
        // Hard redirect to login; router guards will also catch this.
        if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
          window.location.assign('/login');
        }
        return Promise.reject(refreshErr);
      }
    }

    return Promise.reject(error);
  },
);

/** Normalised API error shape: { error: { code, message, details? } }. */
export interface ApiErrorShape {
  code?: string;
  message: string;
  details?: unknown;
}

export function extractApiError(err: unknown): ApiErrorShape {
  if (axios.isAxiosError(err)) {
    const payload = err.response?.data as { error?: ApiErrorShape } | undefined;
    if (payload?.error) return payload.error;
    return { message: err.message };
  }
  if (err instanceof Error) return { message: err.message };
  return { message: 'Unexpected error' };
}

/**
 * Human-readable API error. For Zod 400s the envelope is
 * `{ error: { code: "validation_error", message: "Request validation failed", details: flatten() } }`
 * — this surfaces field messages (e.g. "password: Password must include a digit")
 * instead of the generic top-level message alone.
 */
export function formatApiErrorMessage(err: unknown): string {
  const api = extractApiError(err);
  const details = api.details;
  if (details && typeof details === 'object') {
    const flat = details as {
      formErrors?: string[];
      fieldErrors?: Record<string, string[] | undefined>;
    };
    const parts: string[] = [];
    if (Array.isArray(flat.formErrors)) {
      parts.push(...flat.formErrors.filter(Boolean));
    }
    if (flat.fieldErrors) {
      for (const [field, msgs] of Object.entries(flat.fieldErrors)) {
        if (!msgs?.length) continue;
        for (const m of msgs) parts.push(`${field}: ${m}`);
      }
    }
    if (parts.length > 0) return parts.join(' · ');
  }
  return api.message;
}

/** Unwrap the standard `{ data: ... }` success envelope. */
export function unwrap<T>(payload: { data: T } | T): T {
  if (payload && typeof payload === 'object' && 'data' in (payload as Record<string, unknown>)) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}
