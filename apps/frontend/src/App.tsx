import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ApiClientError } from '@/lib/api';
import { AuthProvider } from '@/lib/auth';
import { ThemeProvider } from '@/lib/theme';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { RequireAdmin, RequireAuth } from '@/components/RequireAuth';
import { AppShell } from '@/components/layout/AppShell';
import { LoginPage } from '@/pages/LoginPage';
import { QueuePage } from '@/pages/QueuePage';
import { SubmissionPage } from '@/pages/SubmissionPage';
import { ActivitiesPage } from '@/pages/ActivitiesPage';
import { ActivityDetailPage } from '@/pages/ActivityDetailPage';
import { ContextPage } from '@/pages/ContextPage';
import { ProcessesPage } from '@/pages/ProcessesPage';
import { OverviewPage } from '@/pages/OverviewPage';
import { UsersPage } from '@/pages/UsersPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { PromptsPage } from '@/pages/PromptsPage';
import { AiCallsPage } from '@/pages/AiCallsPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Reintentar un 4xx sólo alarga la espera: el servidor ya ha dicho que no.
      retry: (failureCount, error) => {
        if (error instanceof ApiClientError && error.status >= 400 && error.status < 500) {
          return false;
        }
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
    mutations: { retry: false },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ThemeProvider>
          <TooltipProvider delayDuration={300}>
            <AuthProvider>
              <Routes>
                <Route path="/login" element={<LoginPage />} />

                <Route element={<RequireAuth />}>
                  {/* Pantalla de foco: sin barra de navegación, la acción manda. */}
                  <Route path="/entrega/:id" element={<SubmissionPage />} />

                  <Route element={<AppShell />}>
                    <Route index element={<QueuePage />} />
                    <Route path="/actividades" element={<ActivitiesPage />} />
                    <Route path="/actividades/:id" element={<ActivityDetailPage />} />
                    <Route path="/contexto" element={<ContextPage />} />
                    <Route path="/procesos" element={<ProcessesPage />} />
                    <Route path="/panel" element={<OverviewPage />} />

                    {/*
                      Ajustes deja de ser sólo de administración: el token de
                      Moodle es de cada profesor —decide qué cursos ve— y tiene
                      que poder ponerlo él. Lo que sí es de instalación (IA,
                      URL de Moodle, SMTP, planificador) se oculta dentro de la
                      pantalla según el rol.
                    */}
                    <Route path="/ajustes" element={<SettingsPage />} />

                    <Route element={<RequireAdmin />}>
                      <Route path="/usuarios" element={<UsersPage />} />
                      <Route path="/prompts" element={<PromptsPage />} />
                      <Route path="/registro-ia" element={<AiCallsPage />} />
                    </Route>

                    <Route path="*" element={<NotFoundPage />} />
                  </Route>
                </Route>
              </Routes>
            </AuthProvider>
          </TooltipProvider>
          <Toaster />
        </ThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
