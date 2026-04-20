import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useMsal, useIsAuthenticated } from '@azure/msal-react';
import { InteractionStatus } from '@azure/msal-browser';
import { tokenRequest } from '../config/msalConfig';

export interface AuthUser {
  id: string;
  name: string;
  role: 'admin' | 'manager' | 'employee';
  departmentId: string;
  departmentName: string;
  positionId: string;
  positionName: string;
  agentId?: string;
  channels?: string[];
  email?: string;
  mustChangePassword?: boolean;
}

type AuthMode = 'azure' | 'local' | null;

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  authMode: AuthMode;
  loginWithMicrosoft: () => Promise<void>;
  loginWithPassword: (employeeId: string, password: string) => Promise<void>;
  logout: () => void;
  updateToken: (newToken: string) => void;
  getAccessToken: () => Promise<string | null>;
  isAdmin: boolean;
  isManager: boolean;
  isEmployee: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null, loading: true, authMode: null,
  loginWithMicrosoft: async () => {}, loginWithPassword: async () => {},
  logout: () => {}, updateToken: () => {},
  getAccessToken: async () => null,
  isAdmin: false, isManager: false, isEmployee: false,
});

export function useAuth() { return useContext(AuthContext); }

export function AuthProvider({ children }: { children: ReactNode }) {
  const { instance, accounts, inProgress } = useMsal();
  const isMsalAuthenticated = useIsAuthenticated();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode>(null);

  // ── Azure AD token acquisition ────────────────────────────────────────
  const getAzureToken = useCallback(async (): Promise<string | null> => {
    if (accounts.length === 0) return null;
    try {
      const response = await instance.acquireTokenSilent({
        ...tokenRequest,
        account: accounts[0],
      });
      return response.idToken;
    } catch {
      try {
        const response = await instance.acquireTokenPopup(tokenRequest);
        return response.idToken;
      } catch {
        return null;
      }
    }
  }, [instance, accounts]);

  // ── Unified token getter (used by api/client.ts) ─────────────────────
  const getAccessToken = useCallback(async (): Promise<string | null> => {
    if (authMode === 'azure') {
      return getAzureToken();
    }
    // Local JWT — read from localStorage
    return localStorage.getItem('openclaw_token');
  }, [authMode, getAzureToken]);

  // Expose globally for the API client
  useEffect(() => {
    (window as any).__openclaw_getToken = getAccessToken;
    return () => { delete (window as any).__openclaw_getToken; };
  }, [getAccessToken]);

  // ── Fetch user profile from backend ───────────────────────────────────
  const fetchMe = useCallback(async (token: string): Promise<AuthUser | null> => {
    try {
      const resp = await fetch('/api/v1/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.ok) return await resp.json() as AuthUser;
    } catch { /* ignore */ }
    return null;
  }, []);

  // ── Restore session: check Azure AD first, then localStorage ──────────
  useEffect(() => {
    if (inProgress !== InteractionStatus.None) return;

    let cancelled = false;
    (async () => {
      // Try Azure AD
      if (isMsalAuthenticated && accounts.length > 0) {
        const token = await getAzureToken();
        if (token && !cancelled) {
          const me = await fetchMe(token);
          if (me && !cancelled) {
            setUser(me);
            setAuthMode('azure');
            setLoading(false);
            return;
          }
        }
      }

      // Try local JWT
      const saved = localStorage.getItem('openclaw_token');
      if (saved && !cancelled) {
        const me = await fetchMe(saved);
        if (me && !cancelled) {
          setUser(me);
          setAuthMode('local');
          setLoading(false);
          return;
        }
        localStorage.removeItem('openclaw_token');
      }

      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [isMsalAuthenticated, accounts, inProgress, getAzureToken, fetchMe]);

  // ── Login: Microsoft ──────────────────────────────────────────────────
  const loginWithMicrosoft = async () => {
    await instance.loginRedirect(tokenRequest);
  };

  // ── Login: Password ───────────────────────────────────────────────────
  const loginWithPassword = async (employeeId: string, password: string) => {
    const resp = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId, password }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: 'Login failed' }));
      throw new Error(err.detail || 'Login failed');
    }
    const data = await resp.json();
    localStorage.setItem('openclaw_token', data.token);
    setUser({ ...data.employee as AuthUser, mustChangePassword: data.mustChangePassword ?? false });
    setAuthMode('local');
  };

  // ── Update token (after password change) ──────────────────────────────
  const updateToken = (newToken: string) => {
    localStorage.setItem('openclaw_token', newToken);
    try {
      const payload = JSON.parse(atob(newToken.split('.')[1]));
      setUser(prev => prev ? { ...prev, mustChangePassword: payload.mustChangePassword ?? false } : prev);
    } catch { /* ignore */ }
  };

  // ── Logout ────────────────────────────────────────────────────────────
  const logout = () => {
    setUser(null);
    if (authMode === 'azure') {
      setAuthMode(null);
      instance.logoutRedirect({ postLogoutRedirectUri: window.location.origin });
    } else {
      localStorage.removeItem('openclaw_token');
      setAuthMode(null);
    }
  };

  return (
    <AuthContext.Provider value={{
      user, loading, authMode, loginWithMicrosoft, loginWithPassword,
      logout, updateToken, getAccessToken,
      isAdmin: user?.role === 'admin',
      isManager: user?.role === 'manager',
      isEmployee: user?.role === 'employee',
    }}>
      {children}
    </AuthContext.Provider>
  );
}
