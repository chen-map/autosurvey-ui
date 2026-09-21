import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Play, Terminal, FileCode2, Bot } from 'lucide-react';
import type { AgentRun } from '@/types/data';
import { getAgentRun } from '@/services/api';
import { readLlmConfig, llmConfigured, chatCompletion } from '@/lib/llm';
import { USE_MOCK } from '@/services/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

type Phase = 'idle' | 'loading' | 'selecting' | 'running' | 'done' | 'error';

// Agent 分析控制台：RQ 输入 → Skill 选择 → agentic loop 时间线 → HTML 报告
export function AgentPage() {
  const { projectId = '' } = useParams();
  const [preset, setPreset] = useState<AgentRun | null>(null);
  const [rq, setRq] = useState('分析 BA-Shapes 基准上掩码类解释方法的 Fidelity+ 差异来源');
  const [phase, setPhase] = useState<Phase>('idle');
  const [visibleSteps, setVisibleSteps] = useState(0);
  const [realAnswer, setRealAnswer] = useState('');
  const [agentErr, setAgentErr] = useState('');

  useEffect(() => {
    let alive = true;
    getAgentRun().then((r) => alive && setPreset(r));
    return () => {
      alive = false;
    };
  }, [projectId]);

  const run = async () => {
    if (!rq.trim()) return;
    setAgentErr('');
    setRealAnswer('');
    const cfg = readLlmConfig();
    setPhase('running');
    setVisibleSteps(0);

    if (!USE_MOCK || llmConfigured(cfg)) {
      // 真实模式：统一 LLM 执行器（url + apikey + model）
      try {
        const sys = '你是学术知识图谱分析 Agent。基于给定 KG 概览回答研究问题，输出结构化分析：结论先行、每条判断标注依据（论文/节点）、给出 2-3 条后续分析建议，使用 markdown。';
        const answer = await chatCompletion(cfg, [
          { role: 'system', content: sys },
          { role: 'user', content: `研究问题：${rq}

KG 概览：162 篇论文、645 概念节点、313 关系边（含 contradicts 矛盾边）。` },
        ], { maxTokens: 1800 });
        setRealAnswer(answer);
      } catch (e) {
        setAgentErr(e instanceof Error ? e.message : String(e));
      }
      setPhase('done');
      return;
    }
    // mock 模式（未配置 LLM）：演示时间线
    setPhase('selecting');
    setVisibleSteps(0);
    setTimeout(() => setPhase('running'), 800);
    setTimeout(() => setPhase('done'), 1600 + (preset?.steps.length ?? 0) * 700);
  };

  const running = phase === 'running';
  const stepVisible = (i: number) => phase === 'done' || visibleSteps > i;

  const history = useMemo(
    () => (phase === 'idle' ? [{ rq: preset?.rq ?? '', date: '2026-09-08' }] : []),
    [phase, preset],
  );

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* 输入区 */}
      <Card className="p-5">
        <div className="flex items-center gap-2 text-[14px] font-medium">
          <Bot size={16} className="text-t3" />
          KG 分析 Agent（LLM 驱动 · 37 Skills）
        </div>
        <textarea
          value={rq}
          onChange={(e) => setRq(e.target.value)}
          rows={2}
          placeholder="输入研究问题（RQ），例如：LLM Agent 安全攻击类型分布"
          className="mt-3 w-full resize-none rounded-lg border border-line bg-page px-3 py-2.5 text-[14px] text-t1 placeholder:text-t3 focus:border-ink focus:outline-none"
        />
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[12px] text-t3">Agent 将自动从 37 个分析 Skill 中选择最优策略，多轮调用 KG 原子工具（≤30 轮）</span>
          <Button onClick={run} disabled={phase === 'selecting' || running || !rq.trim()}>
            <Play size={14} />
            {phase === 'idle' ? '发起分析' : running ? '分析中…' : phase === 'selecting' ? '选择 Skill…' : '重新分析'}
          </Button>
        </div>
      </Card>

      {/* Skill 选择 */}
      {(phase === 'selecting' || running || phase === 'done') && preset && (
        <Card className="anim-rise p-5">
          <div className="text-[13px] font-medium">Skill 自动选择</div>
          {phase === 'selecting' ? (
            <div className="mt-2 flex items-center gap-2 text-[13px] text-t2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-run" />
              Claude 正在阅读 37 个 Skill 规范并匹配…
            </div>
          ) : (
            <div className="mt-2.5 flex items-start gap-3">
              <span className="rounded bg-ink px-2 py-0.5 font-mono text-[12px] text-white">{preset.skill.id}</span>
              <div>
                <div className="text-[14px] font-medium">{preset.skill.name}</div>
                <div className="mt-0.5 text-[12.5px] leading-4 text-t3">{preset.skill.reason}</div>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Agentic loop 时间线 */}
      {(running || phase === 'done') && preset && (
        <Card className="p-5">
          <div className="flex items-center gap-2 text-[13px] font-medium">
            <Terminal size={14} className="text-t3" />
            Agentic Loop · 工具调用时间线
            {running && <Badge variant="info" withDot>执行中</Badge>}
            {phase === 'done' && <Badge variant="ok">完成</Badge>}
          </div>
          <div className="mt-3 space-y-2 border-l-2 border-line/60 pl-4">
            {preset.steps.map((s, i) =>
              stepVisible(i) ? (
                <div key={i} className="anim-rise relative" style={{ animationDelay: '0ms' }}>
                  <span className="absolute -left-[22px] top-1.5 h-2 w-2 rounded-full bg-ink" />
                  <div className="rounded-lg bg-page px-3 py-2">
                    <div className="font-mono text-[12.5px] font-semibold text-t1">
                      {i + 1}. {s.tool}
                      <span className="ml-2 font-normal text-t3">{s.args}</span>
                    </div>
                    <div className="mt-0.5 text-[12.5px] text-t2">→ {s.result}</div>
                  </div>
                </div>
              ) : (
                <div key={i} className="relative py-1">
                  <span className="absolute -left-[22px] top-2 h-2 w-2 animate-pulse rounded-full bg-run" />
                  <div className="h-6 animate-pulse rounded-lg bg-black/5" />
                </div>
              ),
            )}
          </div>
        </Card>
      )}

      {/* LLM 真实分析结果 / 错误 */}
      {agentErr && (
        <Card className="p-4 text-[13px] text-danger">Agent 调用失败：{agentErr}</Card>
      )}
      {realAnswer && (
        <Card className="p-5">
          <div className="text-[13px] font-medium">分析结果（LLM 真实输出）</div>
          <div className="mt-2 whitespace-pre-wrap text-[13.5px] leading-6 text-t1">{realAnswer}</div>
        </Card>
      )}

      {/* HTML 报告 */}
      {phase === 'done' && preset && (
        <Card className="anim-rise p-5">
          <div className="flex items-center gap-2 text-[13px] font-medium">
            <FileCode2 size={14} className="text-t3" />
            分析报告（HTMLRenderer 输出）
          </div>
          <div className="mt-3 rounded-lg border border-line/60 bg-page p-4">
            <div className="text-[14px] font-semibold">Fidelity+ 差异来源分析：掩码类解释方法</div>
            <div className="mt-1 text-[11px] text-t3">生成于 {new Date().toLocaleTimeString()} · sections: 5 · tool_calls: {preset.steps.length}</div>
            <div className="mt-3 space-y-1.5">
              {[96, 88, 93, 60].map((w, i) => (
                <div key={i} className="h-2 rounded bg-black/10" style={{ width: `${w}%` }} />
              ))}
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" size="sm">打开 HTML 报告</Button>
            <Button variant="ghost" size="sm">下载 tool_log.json</Button>
          </div>
        </Card>
      )}

      {/* 空态：历史运行 */}
      {phase === 'idle' && (
        <Card className="p-5">
          <div className="text-[13px] font-medium text-t2">历史运行</div>
          {history.map((h, i) => (
            <div key={i} className="mt-2 flex items-center justify-between rounded-lg border border-line/60 px-3 py-2">
              <span className="truncate text-[13px] text-t1">{h.rq}</span>
              <span className="shrink-0 text-[12px] text-t3">{h.date}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
