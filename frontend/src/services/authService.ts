/**
 * Auth Service — login, register, token management
 * Tokens stored in localStorage under 'rb_token'.
 * Provides a typed fetch wrapper that auto-injects the Bearer token.
 */

import type { AuthResponse, User } from '../shared/types';

const API = '/api';
const TOKEN_KEY = 'rb_token';
const USER_KEY = 'rb_user';

export interface AuthState {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
}

// ─── Token persistence ────────────────────────────────────────

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getStoredUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setStoredUser(user: User): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getAuthState(): AuthState {
  const token = getToken();
  const user = getStoredUser();
  return { token, user, isAuthenticated: !!token && !!user };
}

// ─── Auth fetch helper ─────────────────────────────────────────

function authHeaders(): Record<string, string> {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

// ─── Auth operations ──────────────────────────────────────────

export interface LoginResult {
  success: boolean;
  error?: string;
  user?: User;
  token?: string;
}

export interface RegisterResult {
  success: boolean;
  error?: string;
  user?: User;
  token?: string;
}

export async function login(username: string, password: string): Promise<LoginResult> {
  try {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data: AuthResponse & { error?: string } = await res.json();

    if (!res.ok) {
      return { success: false, error: data.error ?? 'Login failed' };
    }

    setToken(data.token);
    setStoredUser(data.user);
    return { success: true, user: data.user, token: data.token };
  } catch (err) {
    return { success: false, error: 'Network error — is the server running?' };
  }
}

export async function register(username: string, password: string): Promise<RegisterResult> {
  try {
    const res = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data: AuthResponse & { error?: string } = await res.json();

    if (!res.ok) {
      return { success: false, error: data.error ?? 'Registration failed' };
    }

    setToken(data.token);
    setStoredUser(data.user);
    return { success: true, user: data.user, token: data.token };
  } catch {
    return { success: false, error: 'Network error — is the server running?' };
  }
}

export function logout(): void {
  clearToken();
}

// ─── Auth-aware fetch helper for API calls ─────────────────────
// Use this instead of raw fetch() when calling /api/decks and other auth-required endpoints.
// Automatically refreshes the token once on 401, then retries the original request.

export async function authFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const doFetch = (token: string | null): Promise<Response> =>
    fetch(url, {
      ...options,
      headers: {
        ...authHeaders(),
        ...(options.headers ?? {}),
      },
    });

  const token = getToken();
  let res = await doFetch(token);

  // If 401, try refreshing the token once
  if (res.status === 401) {
    const refreshRes = await fetch(`${API}/auth/refresh`, {
      method: 'POST',
      headers: { ...authHeaders() },
    });
    if (refreshRes.ok) {
      const { token: newToken } = await refreshRes.json() as { token: string };
      setToken(newToken);
      // Retry the original request with the new token
      res = await doFetch(newToken);
    }
  }

  return res;
}
