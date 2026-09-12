import { useMemo, useState } from 'react';
import { Compass, Save, Check } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';

// 研究方向画像（F17 静态版）：领域标签 + 研究目标，与创建向导的预选双向共享 localStorage 键
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

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <h1 className="text-[24px] font-semibold leading-8">研究方向</h1>
      <p className="mt-1 text-[13px] text-t3">
        维护你的研究方向画像：这里的内容会自动预选到新建项目的向导中，未来也将驱动选题推荐（Gap 分析，依赖后端）。
      </p>

      <div className="mt-6 space-y-5">
        <Card className="p-5">
          <div className="text-[14px] font-medium">我的研究领域</div>
          <p className="mt-1 text-[12.5px] text-t3">点击切换选中；自定义标签保存后会出现在快捷列表里（单用户研究方向固定，常用标签建议保留在库中）</p>
          <div className="mt-3 flex flex-wrap gap-2">
              {allFields.map((t: string) => {
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
            选题推荐（Gap 分析）· 规划中
          </div>
          <p className="mt-1.5 text-[12.5px] leading-5 text-t3">
            将基于流水线 W3-P1 Gap Analyzer 与你的知识库推荐研究方向（识别 coverage gaps）。该能力依赖后端接口，已登记 backend-todo.md 与需求变更池（F18）。
          </p>
        </Card>
      </div>
    </div>
  );
}
