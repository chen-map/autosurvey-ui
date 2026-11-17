import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { USE_MOCK } from '@/services/api';

/**
 * 订阅项目事件流（SSE）——后端检测到工作流状态文件 / PDF 变化时推送 'state' 事件。
 * 收到事件 → 失效该项目的所有查询（TanStack 自动 refetch 已挂载的）。
 *
 * EventSource 不支持自定义 Header，认证走 ?t=（与 evidence-image 同款折衷）。
 * 断线自动重连由 EventSource 原生处理；USE_MOCK（公开快照）无后端，直接跳过。
 */
export function useProjectEvents(projectId: string, token: string | null) {
  const qc = useQueryClient();
  useEffect(() => {
    if (USE_MOCK || !projectId || !token) return;
    const es = new EventSource(`/api/projects/${projectId}/events?t=${encodeURIComponent(token)}`);
    es.addEventListener('state', () => {
      // 状态文件变化 → 失效该项目全部查询（流水线/语料/RQ/报告按需 refetch）
      qc.invalidateQueries({ queryKey: ['project', projectId] });
    });
    return () => es.close();
  }, [projectId, token, qc]);
}
