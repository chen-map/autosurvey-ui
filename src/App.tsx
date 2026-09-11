import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@/store/auth';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { ProjectLayout } from '@/components/layout/ProjectLayout';
import { LoginPage } from '@/pages/LoginPage';
import { ProjectsPage } from '@/pages/ProjectsPage';
import { NewProjectPage } from '@/pages/NewProjectPage';
import { AdminPage } from '@/pages/AdminPage';
import { PipelinePage } from '@/pages/PipelinePage';
import { CorpusPage } from '@/pages/CorpusPage';
import { RqPage } from '@/pages/RqPage';
import { EvidencePage } from '@/pages/EvidencePage';
import { ReportPage } from '@/pages/ReportPage';
import { AgentPage } from '@/pages/AgentPage';
import { KgPage } from '@/pages/KgPage';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return user ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/new" element={<NewProjectPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/projects/:projectId" element={<ProjectLayout />}>
            <Route index element={<Navigate to="rq" replace />} />
            <Route path="rq" element={<RqPage />} />
            <Route path="rq/:rqId" element={<EvidencePage />} />
            <Route path="pipeline" element={<PipelinePage />} />
            <Route path="corpus" element={<CorpusPage />} />
            <Route path="kg" element={<KgPage />} />
            <Route path="report" element={<ReportPage />} />
            <Route path="agent" element={<AgentPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
