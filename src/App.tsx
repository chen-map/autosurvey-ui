import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
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
import { KnowledgeBasePage } from '@/pages/KnowledgeBasePage';
import { DirectionPage } from '@/pages/DirectionPage';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return user ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    // HashRouter：GitHub Pages 无 SPA 回退，哈希路由免 404
    <HashRouter>
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
          <Route path="/library" element={<KnowledgeBasePage />} />
          <Route path="/direction" element={<DirectionPage />} />
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
    </HashRouter>
  );
}
