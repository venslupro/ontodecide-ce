/**
 * App root — HashRouter route definitions matching FR-1 page list.
 * Wraps routes in guards (AnonymousOnly / AuthGuard / AdminGuard) + AppShell.
 *
 * Route matrix (FR-1):
 *   /login                           → anonymous only, no shell
 *   /auth/change-password            → logged-in users
 *   /dashboard, /                    → dashboard home
 *   /graph/ontology|entities|explore → graph explorer
 *   /graph/situation/:id             → situation detail
 *   /decisions/scenario|recommend|agent
 *   /ingest/sync|file, /ingest/jobs/:id
 *   /admin/users|audit|config|cleanup → admin only
 *   /401, *                          → error pages (no shell)
 */
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ToastProvider } from '@/components/ui/Toast';

import AppShell from '@/components/shared/shell/AppShell';
import {
  AuthGuard,
  AdminGuard,
  AnonymousOnly,
} from '@/components/shared/guards';

import LoginPage from '@/pages/login/index';
import ChangePasswordPage from '@/pages/auth/change-password';
import DashboardPage from '@/pages/dashboard/index';
import GraphOntologyPage from '@/pages/graph/ontology';
import GraphEntitiesPage from '@/pages/graph/entities';
import GraphSituationPage from '@/pages/graph/situation';
import GraphExplorePage from '@/pages/graph/explore';
import DecisionScenarioPage from '@/pages/decisions/scenario';
import DecisionRecommendPage from '@/pages/decisions/recommend';
import DecisionAgentPage from '@/pages/decisions/agent';
import IngestSyncPage from '@/pages/ingest/sync';
import IngestFilePage from '@/pages/ingest/file';
import IngestJobPage from '@/pages/ingest/job';
import AdminUsersPage from '@/pages/admin/users';
import AdminAuditPage from '@/pages/admin/audit';
import AdminConfigPage from '@/pages/admin/config';
import AdminCleanupPage from '@/pages/admin/cleanup';
import Page401 from '@/pages/401';
import Page404 from '@/pages/404';

export default function App() {
  return (
    <ToastProvider>
      <HashRouter>
        <Routes>
          <Route
            path="/login"
            element={
              <AnonymousOnly>
                <LoginPage />
              </AnonymousOnly>
            }
          />
          <Route
            path="/auth/change-password"
            element={
              <AuthGuard>
                <ChangePasswordPage />
              </AuthGuard>
            }
          />
          <Route
            path="/"
            element={
              <AuthGuard>
                <AppShell>
                  <DashboardPage />
                </AppShell>
              </AuthGuard>
            }
          />
          <Route
            path="/dashboard"
            element={
              <AuthGuard>
                <AppShell>
                  <DashboardPage />
                </AppShell>
              </AuthGuard>
            }
          />
          <Route
            path="/graph/ontology"
            element={
              <AuthGuard>
                <AppShell>
                  <GraphOntologyPage />
                </AppShell>
              </AuthGuard>
            }
          />
          <Route
            path="/graph/entities"
            element={
              <AuthGuard>
                <AppShell>
                  <GraphEntitiesPage />
                </AppShell>
              </AuthGuard>
            }
          />
          <Route
            path="/graph/situation/:id"
            element={
              <AuthGuard>
                <AppShell>
                  <GraphSituationPage />
                </AppShell>
              </AuthGuard>
            }
          />
          <Route
            path="/graph/explore"
            element={
              <AuthGuard>
                <AppShell>
                  <GraphExplorePage />
                </AppShell>
              </AuthGuard>
            }
          />
          <Route
            path="/decisions/scenario"
            element={
              <AuthGuard>
                <AppShell>
                  <DecisionScenarioPage />
                </AppShell>
              </AuthGuard>
            }
          />
          <Route
            path="/decisions/recommend"
            element={
              <AuthGuard>
                <AppShell>
                  <DecisionRecommendPage />
                </AppShell>
              </AuthGuard>
            }
          />
          <Route
            path="/decisions/agent"
            element={
              <AuthGuard>
                <AppShell>
                  <DecisionAgentPage />
                </AppShell>
              </AuthGuard>
            }
          />
          <Route
            path="/ingest/sync"
            element={
              <AuthGuard>
                <AppShell>
                  <IngestSyncPage />
                </AppShell>
              </AuthGuard>
            }
          />
          <Route
            path="/ingest/file"
            element={
              <AuthGuard>
                <AppShell>
                  <IngestFilePage />
                </AppShell>
              </AuthGuard>
            }
          />
          <Route
            path="/ingest/jobs/:id"
            element={
              <AuthGuard>
                <AppShell>
                  <IngestJobPage />
                </AppShell>
              </AuthGuard>
            }
          />
          <Route
            path="/admin/users"
            element={
              <AdminGuard>
                <AppShell>
                  <AdminUsersPage />
                </AppShell>
              </AdminGuard>
            }
          />
          <Route
            path="/admin/audit"
            element={
              <AdminGuard>
                <AppShell>
                  <AdminAuditPage />
                </AppShell>
              </AdminGuard>
            }
          />
          <Route
            path="/admin/config"
            element={
              <AdminGuard>
                <AppShell>
                  <AdminConfigPage />
                </AppShell>
              </AdminGuard>
            }
          />
          <Route
            path="/admin/cleanup"
            element={
              <AdminGuard>
                <AppShell>
                  <AdminCleanupPage />
                </AppShell>
              </AdminGuard>
            }
          />
          <Route path="/401" element={<Page401 />} />
          <Route path="/403" element={<Navigate to="/401" replace />} />
          <Route path="*" element={<Page404 />} />
        </Routes>
      </HashRouter>
    </ToastProvider>
  );
}
