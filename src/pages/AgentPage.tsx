import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Play, Terminal, FileCode2, Bot, AlertTriangle } from 'lucide-react';
import type { AgentRun } from '@/types/data';
import { getAgentRun, getKg, USE_MOCK } from '@/services/api';
import type { KgGraphData } from '@/services/api';
import { readLlmConfig, llmConfigured, chatCompletion } from '@/lib/llm';
import { TYPE_LABELS, type KgType } from '@/mock/kg';
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
  const [kg, setKg] = useState<KgGraphData | null>(null);
  const [kgLoaded, setKgLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    getAgentRun().then((r) => alive && setPreset(r));
    // W2 真实 KG：Agent 分析的数据底座（主参考 §3.4 单 RQ 分析）
    if (!USE_MOCK) {
      getKg(projectId)
        .then((d) => { if (alive) { setKg(d); setKgLoaded(true); } })
        .catch(() => { if (alive) setKgLoaded(true); });
    } else {
      setKgLoaded(true);
    }
    return () => {
      alive = false;
    };
  }, [projectId]);

  // 真实 KG 统计：喂给分析 Agent 的概览（数据层全量，提示词取统计 + 高连接概念采样）
  const kgStats = useMemo(() => {
    if (!kg || !kg.nodes.length) return null;
    const deg = new Map<string, number>();
    for (const e of kg.edges) {
      deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
      deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
    }
    const byType: Record<string, number> = {};
    for (const n of kg.nodes) byType[n.type] = (byType[n.type] ?? 0) + 1;
    const papers = kg.nodes.filter((n) => n.type.toLowerCase() === 'paper');
    const concepts = kg.nodes.filter((n) => n.type.toLowerCase() !== 'paper');
    const top = [...concepts]
      .sort((a, b) => (deg.get(b.id) ?? 0) - (deg.get(a.id) ?? 0))
      .slice(0, 30);
    const typeSummary = Object.entries(byType)
      .filter(([t]) => t.toLowerCase() !== 'paper')
      .map(([t, c]) => `${TYPE_LABELS[t as KgType] ?? t} ${c}`)
      .join(' · ');
    return {
      papers: kg.paperCount ?? papers.length,
      nodeCount: kg.nodes.length,
      edgeCount: kg.edges.length,
      typeSummary,
      topConcepts: top.map((n) => `${n.label}［${TYPE_LABELS[n.type as KgType] ?? n.type}·度${deg.get(n.id) ?? 0}］`),
      paperSample: papers.slice(0, 20).map((p) => p.label),
    };
  }, [kg]);

  const run = async () => {
    if (!rq.trim()) return;
    setAgentErr('');
    setRealAnswer('');
    const cfg = readLlmConfig();
    setPhase('running');
    setVisibleSteps(0);

    if (!USE_MOCK || llmConfigured(cfg)) {
      // 真实模式：统一 LLM 执行器（url + apikey + model）
      const overview = kgStats
        ? `本项目 W2 知识图谱真实产物：
- 规模：${kgStats.papers} 篇论文，${kgStats.nodeCount} 个概念节点（${kgStats.typeSummary}），${kgStats.edgeCount} 条关系边
- 高连接概念（度数 Top）：${kgStats.topConcepts.join('；')}
- 论文样本：${kgStats.paperSample.slice(0, 12).join('；')}`
        : 'KG 概览：162 篇论文、645 概念节点、313 关系边（含 contradicts 矛盾边）。';
      try {
        const sys = '你是学术知识图谱分析 Agent。基于给定 KG 概览回答研究问题，输出结构化分析：结论先行、每条判断标注依据（论文/节点）、给出 2-3 条后续分析建议，使用 markdown。';
        const answer = await chatCompletion(cfg, [
          { role: 'system', content: sys },
          { role: 'user', content: `研究问题：${rq}\n\n${overview}` },
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
        {/* W2 KG 数据底座状态 */}
        {!USE_MOCK && kgLoaded && (
          kgStats ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-lg border border-ok/30 bg-ok/5 px-3 py-2 text-[12.5px] text-t2">
              <Badge variant="ok" withDot>KG 已接入</Badge>
              <span>{kgStats.papers} 篇论文 · {kgStats.nodeCount} 概念节点 · {kgStats.edgeCount} 关系边</span>
              <span className="text-t3">{kgStats.typeSummary}</span>
            </div>
          ) : (
            <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-lg border border-warn-fg/30 bg-warn/10 px-3 py-2 text-[12.5px] text-t2">
              <AlertTriangle size={14} className="text-warn-fg" />
              该项目还没有 W2 知识图谱——Agent 将无真实数据可分析。
              <Link to={`/projects/${projectId}/kg`} className="text-info-fg hover:underline">去 KG 页启动 W2 →</Link>
            </div>
          )
        )}
        <textarea
          value={rq}
          onChange={(e) => setRq(e.target.value)}
          rows={2}
          placeholder="输入研究问题（RQ），例如：LLM Agent 安全攻击类型分布"
          className="mt-3 w-full resize-none rounded-lg border border-line bg-page px-3 py-2.5 text-[14px] text-t1 placeholder:text-t3 focus:border-ink focus:outline-none"
        />
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[12px] text-t3">
            {kgStats ? 'Agent 将基于本项目 W2 真实图谱进行结构化分析' : 'Agent 将自动从 37 个分析 Skill 中选择最优策略，多轮调用 KG 原子工具（≤30 轮）'}
          </span>
          <Button onClick={run} disabled={phase === 'selecting' || running || !rq.trim() || (!USE_MOCK && kgLoaded && !kgStats)}>
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
