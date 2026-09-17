import { useEffect, useMemo, useState } from 'react';
import { Compass, Save, Sparkles, ArrowRight, FileText, Plus, Trash2, Pencil, Star } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';

// 研究方向库（F13 升级版）：多方向管理 + 默认预选（向导自动带出）+ AI 精炼一键入库
// localStorage 持久化；后端 CRUD 见 backend-todo.md §2
const LS_DIRECTIONS = 'as.directions';
const LS_ACTIVE = 'as.active-direction';
const LS_CUSTOM_FIELDS = 'as.custom-fields';
const LS_LAST_FIELDS = 'as.last-fields';
const PRESET_FIELDS = ['LLM 安全', '智能体', '多模态', 'GNN', '可解释性', '扩散模型', '时序预测', '联邦学习'];

interface Direction {
  id: string;
  title: string;
  fields: string[];
  goal: string;
  createdAt: string;
  updatedAt: string;
}

function readDirections(): Direction[] {
  try {
    const v = JSON.parse(localStorage.getItem(LS_DIRECTIONS) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function saveDirections(dirs: Direction[]) {
  localStorage.setItem(LS_DIRECTIONS, JSON.stringify(dirs));
}

function readJSON(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

interface RefinedDirection {
  title: string;
  statement: string;
  questions: string[];
  gap: string;
  papers: { title: string; venue: string; year: number; reason: string }[];
}

const EMPTY_FORM = { id: '', title: '', fields: [] as string[], goal: '' };
type Form = typeof EMPTY_FORM | null;

export function DirectionPage() {
  const [directions, setDirections] = useState<Direction[]>(readDirections);
  const [activeId, setActiveId] = useState<string | null>(() => localStorage.getItem(LS_ACTIVE));
  const [form, setForm] = useState<Form>(null);
  const [savedTip, setSavedTip] = useState(false);

  // 领域标签库（与创建向导共享）
  const [savedCustom, setSavedCustom] = useState<string[]>(() => readJSON(LS_CUSTOM_FIELDS));
  const [customTag, setCustomTag] = useState('');
  const allFields = useMemo(
    () => [...PRESET_FIELDS, ...savedCustom.filter((t) => !PRESET_FIELDS.includes(t))],
    [savedCustom],
  );

  // 旧数据迁移：首次进入时把单一画像（上次领域+目标）转成一条方向
  useEffect(() => {
    if (readDirections().length === 0) {
      const last = readJSON(LS_LAST_FIELDS);
      const goal = localStorage.getItem('as.research-goal') ?? '';
      if (last.length > 0 || goal) {
        const now = new Date().toLocaleString();
        const d: Direction = {
          id: `dir-${Date.now()}`,
          title: last.length ? `${last[0]} 等方向` : '我的研究方向',
          fields: last, goal, createdAt: now, updatedAt: now,
        };
        saveDirections([d]);
        localStorage.setItem(LS_ACTIVE, d.id);
        setDirections([d]);
        setActiveId(d.id);
      }
    }
  }, []);

  const persist = (dirs: Direction[], active: string | null = activeId) => {
    setDirections(dirs);
    saveDirections(dirs);
    if (active !== null) {
      localStorage.setItem(LS_ACTIVE, active);
      setActiveId(active);
    }
    setSavedTip(true);
    setTimeout(() => setSavedTip(false), 1500);
  };

  // ---- AI 方向精炼（B14 mock 版）：真实实现为 POST /direction/refine ----
  const [vague, setVague] = useState('');
  const [phase, setPhase] = useState<'idle' | 'thinking' | 'done'>('idle');
  const [refined, setRefined] = useState<RefinedDirection | null>(null);

  const ctxFields = directions[0]?.fields ?? [];

  const refine = () => {
    if (!vague.trim()) return;
    setPhase('thinking');
    const kw = vague.trim();
    setTimeout(() => {
      setRefined({
        title: `${kw}：从现象描述到机制刻画的系统性研究`,
        statement: `围绕「${kw}」构建可复现的评测体系与机制分析框架，结合你关注的 ${ctxFields[0] ?? '相关领域'} 视角，识别现有研究的覆盖缺口并提出对照性研究问题。`,
        questions: [
          `${kw} 相关问题中，哪些已被系统研究、覆盖度如何（可用 KG 覆盖缺口验证）？`,
          '现有方法在真实场景下的失效边界与失败模式是什么？',
          '哪些交叉视角尚未被组合研究？',
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

  const adoptRefined = () => {
    if (!refined) return;
    const now = new Date().toLocaleString();
    const d: Direction = {
      id: `dir-${Date.now()}`, title: refined.title,
      fields: [...ctxFields], goal: refined.statement,
      createdAt: now, updatedAt: now,
    };
    persist([d, ...directions], d.id);
    setRefined(null);
    setPhase('idle');
    setVague('');
  };

  // ---- 新建/编辑表单 ----
  const openNew = () => setForm({ ...EMPTY_FORM });
  const openEdit = (d: Direction) => setForm({ id: d.id, title: d.title, fields: [...d.fields], goal: d.goal });
  const saveForm = () => {
    if (!form || !form.title.trim()) return;
    const now = new Date().toLocaleString();
    if (form.id) {
      persist(directions.map((d) => (d.id === form.id ? { ...d, ...form, updatedAt: now } : d)));
    } else {
      const d: Direction = { ...form, id: `dir-${Date.now()}`, createdAt: now, updatedAt: now };
      persist([d, ...directions], d.id);
    }
    setForm(null);
  };
  const removeDirection = (id: string) => {
    const next = directions.filter((d) => d.id !== id);
    persist(next, activeId === id ? next[0]?.id ?? null : activeId);
  };

  const toggleFormTag = (t: string) =>
    setForm((f) => (f && !f.fields.includes(t) ? { ...f, fields: f.fields.filter((x) => x !== t) } : f));

  const addFormCustom = () => {
    const t = customTag.trim();
    if (!t) return;
    if (!allFields.includes(t)) setSavedCustom((s) => [...s, t]);
    setForm((f) => (f && !f.fields.includes(t) ? { ...f, fields: [...f.fields, t] } : f));
    setCustomTag('');
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-8 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-[24px] font-semibold leading-8">研究方向库</h1>
        {!form && (
          <Button onClick={openNew}>
            <Plus size={14} />
            新建方向
          </Button>
        )}
        {savedTip && <Badge variant="ok" withDot>已保存</Badge>}
      </div>
      <p className="text-[13px] text-t3">
        把研究方向当作条目来管理：可建多条，设一条为「默认预选」——新建项目向导会自动带出它的领域标签；AI 精炼的结果也可一键入库。
      </p>

      {/* 方向列表 */}
      {!form && (
        <div className="stagger space-y-3">
          {directions.length === 0 && (
            <Card className="px-8 py-12 text-center">
              <Compass size={28} className="mx-auto text-t3" />
              <p className="mt-3 text-[14px] text-t2">方向库还是空的</p>
              <p className="mt-1 text-[13px] text-t3">点击「新建方向」，或用下方 AI 精炼把模糊想法变成一条方向</p>
            </Card>
          )}
          {directions.map((d) => (
            <Card key={d.id} className={cn('p-4 transition-shadow hover:shadow-s2', activeId === d.id && 'border-ink/60')}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-semibold text-t1">{d.title}</span>
                    {activeId === d.id && <Badge variant="ok" withDot>默认预选</Badge>}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {d.fields.map((f) => <Badge key={f} variant="info">{f}</Badge>)}
                  </div>
                  {d.goal && <p className="mt-2 line-clamp-2 text-[13px] leading-5 text-t2">{d.goal}</p>}
                  <div className="mt-1.5 text-[11px] text-t3">更新于 {d.updatedAt}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  {activeId !== d.id && (
                    <Button variant="ghost" size="sm" onClick={() => persist(directions, d.id)}>
                      <Star size={13} />
                      设为预选
                    </Button>
                  )}
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(d)}><Pencil size={13} />编辑</Button>
                    <Button variant="ghost" size="sm" onClick={() => removeDirection(d.id)} title="删除"><Trash2 size={13} /></Button>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* 新建/编辑表单 */}
      {form && (
        <Card className="anim-rise p-5">
          <div className="text-[14px] font-medium">{form.id ? '编辑方向' : '新建方向'}</div>
          <div className="mt-4 space-y-4">
            <div>
              <div className="text-[13px] text-t2">方向标题 *</div>
              <Input className="mt-1.5" placeholder="例如：LLM Agent 安全的攻防对照体系" value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div>
              <div className="text-[13px] text-t2">领域标签</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {allFields.map((t) => (
                  <button key={t} type="button" onClick={() => toggleFormTag(t)}
                    className={cn('rounded-full border px-3 py-1 text-[12.5px] transition-all',
                      form.fields.includes(t) ? 'border-ink bg-ink text-white' : 'border-line text-t2 hover:border-ink/50')}>
                    {t}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <Input placeholder="自定义领域标签，回车添加" value={customTag}
                  onChange={(e) => setCustomTag(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addFormCustom()} className="flex-1" />
                <Button variant="secondary" size="sm" onClick={addFormCustom}>添加</Button>
              </div>
            </div>
            <div>
              <div className="text-[13px] text-t2">研究目标</div>
              <textarea rows={3}
                className="mt-1.5 w-full resize-none rounded-lg border border-line bg-page px-3 py-2.5 text-[14px] text-t1 placeholder:text-t3 focus:border-ink focus:outline-none"
                placeholder="一句话描述这个方向要解决什么、做到什么程度"
                value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} />
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setForm(null)}>取消</Button>
            <Button size="sm" onClick={saveForm} disabled={!form.title.trim()}>
              <Save size={13} />
              {form.id ? '保存修改' : '加入方向库'}
            </Button>
          </div>
        </Card>
      )}

      {/* AI 方向精炼 */}
      {!form && (
        <Card className="p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[14px] font-medium">
              <Sparkles size={15} className="text-t3" />
              AI 方向精炼
            </div>
            <Badge variant="warn">实验 · mock 数据</Badge>
          </div>
          <p className="mt-1.5 text-[12.5px] leading-5 text-t3">
            用一段模糊描述，AI 会结合你的领域标签，把它精炼成更专业、更有研究水准的方向——生成后一键入库。
          </p>
          <textarea
            value={vague} onChange={(e) => setVague(e.target.value)} rows={2}
            placeholder="随便写。例如：我想做大模型和图相关的东西，但不知道具体研究什么……"
            className="mt-3 w-full resize-none rounded-lg border border-line bg-page px-3 py-2.5 text-[14px] text-t1 placeholder:text-t3 focus:border-ink focus:outline-none"
          />
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[12px] text-t3">
              将结合领域标签：{ctxFields.length > 0 ? ctxFields.join(' / ') : '（默认方向未设标签）'}
            </span>
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
              <Button variant="secondary" size="sm" onClick={adoptRefined}>
                <ArrowRight size={13} />
                采纳并存入方向库
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* 与流水线联动说明 */}
      {!form && (
        <Card className="p-4">
          <div className="flex items-center gap-2 text-[13px] font-medium text-t2">
            <Compass size={14} className="text-t3" />
            与流水线的联动 · 规划中
          </div>
          <p className="mt-1.5 text-[12.5px] leading-5 text-t3">
            默认预选的方向将作为 W3 Gap Analyzer 的输入：结合你的知识库与 KG 识别 coverage gaps，主动推送值得研究的选题（依赖后端接口，见 backend-todo.md §3）。
          </p>
        </Card>
      )}
    </div>
  );
}
