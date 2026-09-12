import { useMemo, useState } from 'react';
import { Compass, Save, Check, Sparkles, ArrowRight, FileText } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';

// 研究方向画像（F17 静态版）+ AI 方向精炼（B14 mock 版）
// 与创建向导的预选双向共享 localStorage 键；AI 真实实现为后端代理（backend-todo.md §3）
const LS_CUSTOM_FIELDS = 'as.custom-fields';
const LS_LAST_FIELDS = 'as.last-fields';
const LS_GOAL = 'as.research-goal';

const PRESET_FIELDS = ['LLM 安全', '智能体', '多模态', 'GNN', '可解释性', '扩散模型', '时序预测', '联邦学习'];

function readJSON(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// RefinedDirection：未来 POST /direction/refine 的响应形状（契约见 backend-todo.md §3）
interface RefinedDirection {
  title: string;
  statement: string;
  questions: string[];
  gap: string;
  papers: { title: string; venue: string; year: number; reason: string }[];
}

export function DirectionPage() {
  const [savedCustom, setSavedCustom] = useState<string[]>(() => readJSON(LS_CUSTOM_FIELDS));
  const [tags, setTags] = useState<string[]>(() => readJSON(LS_LAST_FIELDS));
  const [customTag, setCustomTag] = useState('');
  const [goal, setGoal] = useState(() => localStorage.getItem(LS_GOAL) ?? '');
  const [saved, setSaved] = useState(false);

  const allFields = useMemo(
    () => [...PRESET_FIELDS, ...savedCustom.filter((t) => !PRESET_FIELDS.includes(t))],
    [savedCustom],
  );

  const toggleTag = (t: string) =>
    setTags((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));

  const addCustom = () => {
    const t = customTag.trim();
    if (!t) return;
    if (!allFields.includes(t)) {
      const next = [...savedCustom, t];
      setSavedCustom(next);
    }
    if (!tags.includes(t)) setTags((s) => [...s, t]);
    setCustomTag('');
  };

  const removeFromLibrary = (t: string) => {
    setSavedCustom((s) => s.filter((x) => x !== t));
    setTags((s) => s.filter((x) => x !== t));
  };

  const save = () => {
    localStorage.setItem(LS_CUSTOM_FIELDS, JSON.stringify(savedCustom));
    localStorage.setItem(LS_LAST_FIELDS, JSON.stringify(tags));
    localStorage.setItem(LS_GOAL, goal);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // ---- AI 方向精炼（B14 mock 版）：真实实现为 POST /direction/refine（后端 LLM 代理 + Semantic Scholar 检索） ----
  const [vague, setVague] = useState('');
  const [phase, setPhase] = useState<'idle' | 'thinking' | 'done'>('idle');
  const [refined, setRefined] = useState<RefinedDirection | null>(null);

  const refine = () => {
    if (!vague.trim()) return;
    setPhase('thinking');
    const kw = vague.trim();
    // mock 输出：仅演示交互与数据形状
    setTimeout(() => {
      setRefined({
        title: `${kw}：从现象描述到机制刻画的系统性研究`,
        statement: `围绕「${kw}」构建可复现的评测体系与机制分析框架，结合你关注的 ${tags[0] ?? '相关领域'} 视角，识别现有研究的覆盖缺口并提出对照性研究问题。`,
        questions: [
          `${kw} 相关问题中，哪些已被系统研究、覆盖度如何（可用 KG 覆盖缺口验证）？`,
          `现有方法在你的目标场景下的失效边界与失败模式是什么？`,
          `哪些交叉视角尚未被组合研究？`,
        ],
        gap: '现有工作偏重单点性能提升，缺少跨方法对照与失败案例分析；评测多基于合成设定，真实场景证据不足。',
        papers: [
          { title: 'A Survey on Evaluation Practices in Modern NLP Research', venue: 'arXiv', year: 2024, reason: '评测方法论对照框架' },
          { title: 'On the Generalization Gaps in Contemporary Machine Learning', venue: 'ACL', year: 2023, reason: '泛化缺口的量化分析范式' },
          { title: 'Reproducibility and Rigor in ML Empirical Studies', venue: 'Nature Machine Intelligence', year: 2022, reason: '可复现性规范来源' },
        ],
      });
      setPhase('done');
    }, 1800);
  };

  const adopt = () => {
    if (!refined) return;
    setGoal(`${refined.title} —— ${refined.statement}`);
    setSaved(false);
  };

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <h1 className="text-[24px] font-semibold leading-8">研究方向</h1>
      <p className="mt-1 text-[13px] text-t3">
        维护你的研究方向画像：领域组合会自动预选到新建项目的向导中；AI 方向精炼可以把模糊想法变成有研究水准的方向。
      </p>

      <div className="mt-6 space-y-5">
        <Card className="p-5">
          <div className="text-[14px] font-medium">我的研究领域</div>
          <p className="mt-1 text-[12.5px] text-t3">点击切换选中；自定义标签保存后进入快捷列表（单用户研究方向固定，常用标签建议保留在库中）</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {allFields.map((t) => {
              const isCustom = savedCustom.includes(t);
              return (
                <div key={t} className="relative">
                  <button
                    type="button"
                    onClick={() => toggleTag(t)}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-[13px] transition-all',
                      tags.includes(t) ? 'border-ink bg-ink text-white' : 'border-line text-t2 hover:border-ink/50',
                    )}
                  >
                    {t}
                  </button>
                  {isCustom && (
                    <button
                      type="button"
                      title="从我的领域库移除"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFromLibrary(t);
                      }}
                      className="absolute -right-1.5 -top-1.5 grid h-4 w-4 place-items-center rounded-full bg-ink text-[9px] text-white opacity-70 transition-opacity hover:opacity-100"
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex gap-2">
            <Input
              placeholder="添加自定义领域标签，回车确认"
              value={customTag}
              onChange={(e) => setCustomTag(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCustom()}
              className="flex-1"
            />
            <Button variant="secondary" onClick={addCustom}>添加</Button>
          </div>
        </Card>

        <Card className="p-5">
          <div className="text-[14px] font-medium">研究目标</div>
          <p className="mt-1 text-[12.5px] text-t3">一句话描述你的研究目标或当前关注点（例如：为 LLM Agent 安全建立攻击-防御对照的分类体系）</p>
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={3}
            className="mt-2 w-full resize-none rounded-lg border border-line bg-page px-3 py-2.5 text-[14px] text-t1 placeholder:text-t3 focus:border-ink focus:outline-none"
            placeholder="输入研究目标…"
          />
        </Card>

        {/* AI 方向精炼（B14 mock 版） */}
        <Card className="p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[14px] font-medium">
              <Sparkles size={15} className="text-t3" />
              AI 方向精炼
            </div>
            <Badge variant="warn">实验 · mock 数据</Badge>
          </div>
          <p className="mt-1.5 text-[12.5px] leading-5 text-t3">
            想不到好方向？用一段模糊的描述，AI 会结合你的领域标签，把它精炼成更专业、更有研究水准的方向，并附上可能的高质量论文。
          </p>
          <textarea
            value={vague}
            onChange={(e) => setVague(e.target.value)}
            rows={2}
            placeholder="随便写。例如：我想做大模型和图相关的东西，但不知道具体研究什么……"
            className="mt-3 w-full resize-none rounded-lg border border-line bg-page px-3 py-2.5 text-[14px] text-t1 placeholder:text-t3 focus:border-ink focus:outline-none"
          />
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[12px] text-t3">将结合你的领域标签：{tags.length > 0 ? tags.join(' / ') : '（尚未选择）'}</span>
            <Button onClick={refine} disabled={phase === 'thinking' || !vague.trim()}>
              {phase === 'thinking' ? '精炼中…' : '生成专业方向'}
            </Button>
          </div>

          {phase === 'thinking' && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center gap-2 text-[13px] text-t2">
                <span className="h-2 w-2 animate-pulse rounded-full bg-run" />
                结合领域标签分析研究空间…
              </div>
              <div className="h-2 w-full animate-pulse rounded bg-black/10" />
              <div className="h-2 w-4/5 animate-pulse rounded bg-black/10" />
            </div>
          )}

          {phase === 'done' && refined && (
            <div className="anim-rise mt-4 space-y-3 rounded-card border border-line/60 bg-page p-4">
              <div className="text-[15px] font-semibold leading-6">{refined.title}</div>
              <p className="text-[13px] leading-5 text-t2">{refined.statement}</p>
              <div>
                <div className="text-[12px] font-medium text-t3">研究问题</div>
                <ul className="mt-1 space-y-1">
                  {refined.questions.map((q) => (
                    <li key={q} className="flex gap-2 text-[13px] leading-5 text-t1">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink/70" />
                      {q}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-[12px] font-medium text-t3">为什么值得做（Gap）</div>
                <p className="mt-1 text-[13px] leading-5 text-t2">{refined.gap}</p>
              </div>
              <div>
                <div className="text-[12px] font-medium text-t3">可能的高质量论文（mock 演示数据；真实版经 Semantic Scholar 检索）</div>
                <ul className="mt-1 space-y-1.5">
                  {refined.papers.map((p) => (
                    <li key={p.title} className="flex items-start gap-2 text-[13px]">
                      <FileText size={13} className="mt-0.5 shrink-0 text-t3" />
                      <span>
                        <span className="text-t1">{p.title}</span>
                        <span className="ml-1.5 text-t3">{p.venue} {p.year}</span>
                        <span className="block text-[12px] text-t3">推荐理由：{p.reason}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={adopt}
              >
                <ArrowRight size={13} />
                采纳为我的研究目标
              </Button>
            </div>
          )}
        </Card>

        <div className="flex items-center gap-3">
          <Button onClick={save}>
            {saved ? <Check size={15} /> : <Save size={15} />}
            {saved ? '已保存' : '保存研究方向'}
          </Button>
          {saved && (
            <Badge variant="ok" withDot>已保存，新建项目时将自动预选领域</Badge>
          )}
        </div>

        <Card className="p-4">
          <div className="flex items-center gap-2 text-[13px] font-medium text-t2">
            <Compass size={14} className="text-t3" />
            与流水线的联动 · 规划中
          </div>
          <p className="mt-1.5 text-[12.5px] leading-5 text-t3">
            保存后的方向画像将作为 W3 Gap Analyzer 的输入：结合你的知识库与 KG 识别 coverage gaps，主动推送值得研究的选题（依赖后端接口，见 backend-todo.md §3）。
          </p>
        </Card>
      </div>
    </div>
  );
}
