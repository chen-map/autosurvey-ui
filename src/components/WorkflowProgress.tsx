import type { WorkflowSummary } from '@/types';
import { cn } from '@/lib/utils';

const statusColor: Record<string, string> = {
  done: 'var(--ok)',
  running: 'var(--run)',
  checkpoint: 'var(--warn-fg)',
  failed: 'var(--danger)',
  pending: 'var(--border)',
};

// 5W 分段进度（流水线监控的迷你版；完整版 B3 在里程碑 4）
export function WorkflowProgress({ workflows }: { workflows: WorkflowSummary[] }) {
  return (
    <div>
      <div className="flex gap-1">
        {workflows.map((w) => (
          <div
            key={w.id}
            className={cn('h-1.5 flex-1 rounded-full', w.status === 'running' && 'animate-pulse')}
            style={{ background: statusColor[w.status] }}
            title={`${w.id} ${w.name}：${w.status}（${w.progress}%）`}
          />
        ))}
      </div>
      <div className="mt-1.5 flex gap-1 text-xs leading-3 text-t3">
        {workflows.map((w) => (
          <div key={w.id} className="flex-1 text-center">
            {w.id}
          </div>
        ))}
      </div>
    </div>
  );
}
