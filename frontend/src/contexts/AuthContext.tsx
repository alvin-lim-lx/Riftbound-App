/**
 * AuthContext — React context for global auth state.
 * Provides: user, token, isAuthenticated, login(), register(), logout()
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { User } from '../shared/types';
import {
  login as apiLogin,
  register as apiRegister,
  logout as apiLogout,
  getAuthState,
} from '../services/authService';

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Rehydrate from localStorage on mount
  useEffect(() => {
    const state = getAuthState();
    setUser(state.user);
    setToken(state.token);
    setIsLoading(false);
  }, []);

  const handleLogin = useCallback(async (username: string, password: string) => {
    const result = await apiLogin(username, password);
    if (result.success && result.user && result.token) {
      setUser(result.user);
      setToken(result.token);
    }
    return result;
  }, []);

  const handleRegister = useCallback(async (username: string, password: string) => {
    const result = await apiRegister(username, password);
    if (result.success && result.user && result.token) {
      setUser(result.user);
      setToken(result.token);
    }
    return result;
  }, []);

  const handleLogout = useCallback(() => {
    apiLogout();
    setUser(null);
    setToken(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!user && !!token,
        isLoading,
        login: handleLogin,
        register: handleRegister,
        logout: handleLogout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
