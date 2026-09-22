import React from 'react';
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
import { RqDetailPage } from '@/pages/RqDetailPage';
import { ReportPage } from '@/pages/ReportPage';
import { AgentPage } from '@/pages/AgentPage';
import { KgPage } from '@/pages/KgPage';
import { KnowledgeBasePage } from '@/pages/KnowledgeBasePage';
import { DirectionPage } from '@/pages/DirectionPage';
import { ProfilePage } from '@/pages/ProfilePage';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return user ? children : <Navigate to="/login" replace />;
}

// 全局错误边界：渲染异常兜底显示（否则 React 18 直接卸载整树 → 无声白屏）
class ErrorBoundary extends React.Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('App 渲染异常', error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
          <h2 style={{ marginBottom: 12 }}>页面渲染异常</h2>
          <div>{String(this.state.error.stack || this.state.error.message || this.state.error)}</div>
          <button style={{ marginTop: 16 }} onClick={() => { this.setState({ error: null }); location.hash = '#/projects'; location.reload(); }}>
            返回项目列表
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    // HashRouter：GitHub Pages 无 SPA 回退，哈希路由免 404
    <HashRouter>
      <ErrorBoundary>
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
          <Route path="/me" element={<ProfilePage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/projects/:projectId" element={<ProjectLayout />}>
            <Route index element={<Navigate to="rq" replace />} />
            <Route path="rq" element={<RqPage />} />
            <Route path="rq/:rqId" element={<RqDetailPage />} />
            <Route path="pipeline" element={<PipelinePage />} />
            <Route path="corpus" element={<CorpusPage />} />
            <Route path="kg" element={<KgPage />} />
            <Route path="report" element={<ReportPage />} />
            <Route path="agent" element={<AgentPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Routes>
      </ErrorBoundary>
    </HashRouter>
  );
}
