import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { LoginRequest, MeResponse, User } from '@vega/shared';
import { api, clearToken, getToken, onUnauthorized, setToken } from './api';
import { queryKeys } from './queryKeys';

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  login: (credentials: LoginRequest) => Promise<User>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setTokenState] = useState<string | null>(() => getToken());

  // El cliente HTTP borra el token cuando el servidor devuelve 401; aquí sólo
  // ponemos la sesión al día para que la UI reaccione sin esperar al reload.
  useEffect(() => onUnauthorized(() => setTokenState(null)), []);

  const meQuery = useQuery({
    queryKey: queryKeys.me,
    queryFn: ({ signal }) => api.me(signal),
    enabled: token !== null,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  // Un token caducado o inválido no sirve de nada guardado.
  useEffect(() => {
    if (meQuery.isError) {
      clearToken();
      setTokenState(null);
    }
  }, [meQuery.isError]);

  const login = useCallback(
    async (credentials: LoginRequest) => {
      const response = await api.login(credentials);
      setToken(response.token);
      setTokenState(response.token);
      const me: MeResponse = { user: response.user };
      queryClient.setQueryData(queryKeys.me, me);
      return response.user;
    },
    [queryClient],
  );

  const logout = useCallback(() => {
    clearToken();
    setTokenState(null);
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: token === null ? null : (meQuery.data?.user ?? null),
      isLoading: token !== null && meQuery.isLoading,
      login,
      logout,
    }),
    [token, meQuery.data, meQuery.isLoading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return context;
}
