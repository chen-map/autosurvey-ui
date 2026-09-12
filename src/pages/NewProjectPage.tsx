import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, X } from 'lucide-react';
import { createProject } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

const PRESET_FIELDS = ['LLM 安全', '智能体', '多模态', 'GNN', '可解释性', '扩散模型', '时序预测', '联邦学习'];
const PLATFORMS = ['Semantic Scholar', 'arXiv', 'IEEE', 'ACM', 'Springer', 'Elsevier', 'Google Scholar'];
const STEPS = ['研究领域', '主题与种子', '本地资料', '参数配置', '确认创建'];
const LS_CUSTOM_FIELDS = 'as.custom-fields'; // 用户自定义领域库（持久化，跨会话复用）
const LS_LAST_FIELDS = 'as.last-fields'; // 上次使用的领域组合（自动预选）

// B2 创建向导：研究领域标签 → 主题+种子 → 本地资料 → 参数 → 确认
export function NewProjectPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState('');
  const [title, setTitle] = useState('');
  const [seeds, setSeeds] = useState<string[]>([]);
  const [locals, setLocals] = useState<string[]>([]);
  const [prescore, setPrescore] = useState(0.25);
  const [stage, setStage] = useState('标准（六阶段全开）');
  const [platforms, setPlatforms] = useState<string[]>(['Semantic Scholar', 'arXiv']);
  const [paperCap, setPaperCap] = useState(500);
  const [creating, setCreating] = useState(false);

  // 自定义领域库：持久化保存，下次打开向导直接出现在快捷 chips 里
  const [savedCustom, setSavedCustom] = useState<string[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(LS_CUSTOM_FIELDS) ?? '[]');
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  });
  const allFields = useMemo(
    () => [...PRESET_FIELDS, ...savedCustom.filter((t) => !PRESET_FIELDS.includes(t))],
    [savedCustom],
  );

  // 单用户研究方向固定：自动预选上次使用的领域组合
  useEffect(() => {
    try {
      const last = JSON.parse(localStorage.getItem(LS_LAST_FIELDS) ?? '[]');
      if (Array.isArray(last) && last.length > 0) setTags(last);
    } catch {
      /* 忽略损坏数据 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const removeFromLibrary = (t: string) => {
    const next = savedCustom.filter((x) => x !== t);
    setSavedCustom(next);
    localStorage.setItem(LS_CUSTOM_FIELDS, JSON.stringify(next));
    setTags((s) => s.filter((x) => x !== t));
  };

  const togglePlatform = (p: string) =>
    setPlatforms((s) => (s.includes(p) ? (s.length > 1 ? s.filter((x) => x !== p) : s) : [...s, p]));

  const toggleTag = (t: string) =>
    setTags((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));

  const addCustom = () => {
    const t = customTag.trim();
    if (!t) return;
    // 新自定义领域入库（持久化），下次向导直接出现在快捷 chips
    if (!allFields.includes(t)) {
      const next = [...savedCustom, t];
      setSavedCustom(next);
      localStorage.setItem(LS_CUSTOM_FIELDS, JSON.stringify(next));
    }
    if (!tags.includes(t)) setTags((s) => [...s, t]);
    setCustomTag('');
  };

  const fakeUpload = (setter: typeof setSeeds) => (e: ChangeEvent<HTMLInputElement>) => {
    const names = Array.from(e.target.files ?? []).map((f) => f.name);
    if (names.some((n) => !n.toLowerCase().endsWith('.pdf'))) {
      // 行内校验提示由下方红字展示（此处简单标记）
      setter((s) => [...s, ...names.filter((n) => n.toLowerCase().endsWith('.pdf'))]);
      return;
    }
    setter((s) => [...s, ...names]);
  };

  const create = async () => {
    setCreating(true);
    localStorage.setItem(LS_LAST_FIELDS, JSON.stringify(tags)); // 记住本次领域组合，下次自动预选
    await createProject({ title, fieldTags: tags });
    navigate('/projects');
  };

  const canNext = [tags.length > 0, title.trim().length > 0 && seeds.length > 0, true, true][step];

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <h1 className="text-[24px] font-semibold leading-8">新建综述项目</h1>

      {/* 步骤条 */}
      <div className="mt-5 flex items-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s} className="flex flex-1 items-center gap-2">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'grid h-6 w-6 place-items-center rounded-full text-[12px] font-semibold',
                  i < step ? 'bg-ok text-white' : i === step ? 'bg-ink text-white' : 'bg-black/10 text-t2',
                )}
              >
                {i < step ? '✓' : i + 1}
              </span>
              <span className={cn('hidden text-[13px] md:inline', i === step ? 'font-medium text-t1' : 'text-t3')}>{s}</span>
            </div>
            {i < STEPS.length - 1 && <div className="h-px flex-1 bg-line" />}
          </div>
        ))}
      </div>

      <Card className="mt-6 p-6">
        {step === 0 && (
          <div>
            <div className="text-[14px] font-medium">研究领域 <span className="text-danger">*</span></div>
            <p className="mt-1 text-[12.5px] text-t3">选择 1–3 个领域，用于生成检索式与 Gap 分析的聚焦范围</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {allFields.map((t: string) => {
                const isCustom = savedCustom.includes(t);
                return (
                  <div key={t} className="relative">
                    <button
                      type="button"
                      onClick={() => toggleTag(t)}
                      className={cn(
                        'anim-rise rounded-full border px-3 py-1.5 text-[13px] transition-all',
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
            {/* 已选标签回显（可移除）——修复"添加后无可见反馈" */}
            <div className="mt-3 flex min-h-[28px] flex-wrap items-center gap-1.5">
              <span className="text-[12px] text-t3">已选（{tags.length}）：</span>
              {tags.length === 0 && <span className="text-[12px] text-t3">尚未选择</span>}
              {tags.map((t) => (
                <Badge key={t} variant="info" className="pr-1">
                  {t}
                  <button
                    type="button"
                    title="移除"
                    className="rounded-full p-0.5 transition-colors hover:bg-black/10"
                    onClick={() => toggleTag(t)}
                  >
                    <X size={11} />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <Input
                placeholder="自定义领域标签，回车添加"
                value={customTag}
                onChange={(e) => setCustomTag(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addCustom()}
                className="flex-1"
              />
              <Button variant="secondary" onClick={addCustom}>添加</Button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <div>
              <div className="text-[14px] font-medium">综述主题 <span className="text-danger">*</span></div>
              <p className="mt-1 text-[12.5px] text-t3">输入完整的研究主题或选题关键词，获得更好的生成效果</p>
              <Input
                className="mt-2"
                placeholder="例如：大语言模型 Agent 安全攻击与防御综述"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div>
              <div className="text-[14px] font-medium">种子论文 <span className="text-danger">*</span></div>
              <p className="mt-1 text-[12.5px] text-t3">1–3 篇代表性 PDF，系统将提取关键词构建 Golden Set 检索式（覆盖率 ≥80% 验证）</p>
              <label className="mt-2 flex cursor-pointer flex-col items-center gap-2 rounded-card border-2 border-dashed border-line px-4 py-8 text-t3 transition-colors hover:border-ink/50 hover:text-t2">
                <Upload size={20} />
                <span className="text-[13px]">点击或拖拽上传 PDF</span>
                <input type="file" multiple accept=".pdf" className="hidden" onChange={fakeUpload(setSeeds)} />
              </label>
              {seeds.map((f) => (
                <div key={f} className="mt-2 flex items-center justify-between rounded-lg bg-page px-3 py-2 text-[13px]">
                  <span className="truncate text-t1">{f}</span>
                  <button type="button" onClick={() => setSeeds((s) => s.filter((x) => x !== f))} className="text-t3 hover:text-danger">
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <div className="text-[14px] font-medium">本地资料合并（可选）</div>
            <p className="mt-1 text-[12.5px] text-t3">对应流水线 W1-P7：上传你已有的本地论文，统一并入语料库元数据</p>
            <label className="mt-3 flex cursor-pointer flex-col items-center gap-2 rounded-card border-2 border-dashed border-line px-4 py-8 text-t3 transition-colors hover:border-ink/50 hover:text-t2">
              <Upload size={20} />
              <span className="text-[13px]">批量上传本地 PDF（可跳过）</span>
              <input type="file" multiple accept=".pdf" className="hidden" onChange={fakeUpload(setLocals)} />
            </label>
            {locals.map((f) => (
              <div key={f} className="mt-2 flex items-center justify-between rounded-lg bg-page px-3 py-2 text-[13px]">
                <span className="truncate text-t1">{f}</span>
                <button type="button" onClick={() => setLocals((s) => s.filter((x) => x !== f))} className="text-t3 hover:text-danger">
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <div>
              <div className="text-[14px] font-medium">论文搜索平台 <span className="text-[12px] font-normal text-t3">（可多选，至少一个）</span></div>
              <div className="mt-2 flex flex-wrap gap-2">
                {PLATFORMS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => togglePlatform(p)}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-[13px] transition-all',
                      platforms.includes(p) ? 'border-ink bg-ink text-white' : 'border-line text-t2 hover:border-ink/50',
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-[14px] font-medium">
                <span>使用论文数量上限</span>
                <span className="tabular-nums text-t2">{paperCap} 篇</span>
              </div>
              <input
                type="range" min={100} max={2000} step={100} value={paperCap}
                onChange={(e) => setPaperCap(Number(e.target.value))}
                className="mt-2 w-full accent-black"
              />
              <p className="mt-1 text-[12.5px] text-t3">
                限制进入语料库的论文规模（默认 500）。直接决定 W1 筛选量与 W2 KG 构建耗时：500 篇 ≈ 13 万论文对 ≈ 3–4h
              </p>
            </div>
            <div>
              <div className="text-[14px] font-medium">检索式预览</div>
              <div className="mt-2 rounded-lg bg-page px-3 py-2.5 font-mono text-[12.5px] leading-5 text-t2">
                ( "{tags[0] ?? 'LLM'}" OR "{tags[1] ?? 'survey'}" ) AND ( "survey" OR "review" OR "taxonomy" )
                <span className="ml-2 text-t3">· 由领域标签与种子论文 TF-IDF top-30 生成</span>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-[14px] font-medium">
                <span>论文对预评分阈值（prescore）</span>
                <span className="tabular-nums text-t2">{prescore.toFixed(2)}</span>
              </div>
              <input
                type="range" min={0.1} max={0.5} step={0.05} value={prescore}
                onChange={(e) => setPrescore(Number(e.target.value))}
                className="mt-2 w-full accent-black"
              />
              <p className="mt-1 text-[12.5px] text-t3">默认 0.25。调高 → 进入详细关系判断的论文对更少、更快；调低 → 召回更高</p>
            </div>
            <div>
              <div className="text-[14px] font-medium">筛选档位</div>
              <select
                value={stage}
                onChange={(e) => setStage(e.target.value)}
                className="mt-2 h-10 w-full rounded-lg border border-line bg-card px-3 text-[13px] text-t2 focus:border-ink focus:outline-none"
              >
                <option>标准（六阶段全开）</option>
                <option>快速（跳过质量评估）</option>
                <option>严格（提高纳入门槛）</option>
              </select>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3">
            <div className="text-[14px] font-medium">确认创建</div>
            {[
              ['研究领域', tags.join('、') || '—'],
              ['综述主题', title],
              ['种子论文', `${seeds.length} 篇`],
              ['本地资料', `${locals.length} 篇`],
              ['搜索平台', platforms.join('、')],
              ['论文数量上限', `${paperCap} 篇`],
              ['prescore 阈值', String(prescore)],
              ['筛选档位', stage],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-line/40 pb-2 text-[13.5px]">
                <span className="text-t3">{k}</span>
                <span className="text-right text-t1">{v}</span>
              </div>
            ))}
            <div className="rounded-lg bg-info px-3 py-2 text-[12.5px] leading-5 text-info-fg">
              创建后即启动 W1 语料库构建；演示环境下流水线以 mock 数据回放。
            </div>
          </div>
        )}

        {/* 步骤导航 */}
        <div className="mt-6 flex items-center justify-between border-t border-line/50 pt-4">
          <Button variant="ghost" size="sm" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
            上一步
          </Button>
          {step < STEPS.length - 1 ? (
            <Button disabled={!canNext} onClick={() => setStep((s) => s + 1)}>下一步</Button>
          ) : (
            <Button disabled={creating} onClick={create}>{creating ? '创建中…' : '创建并启动流水线'}</Button>
          )}
        </div>
      </Card>
    </div>
  );
}
