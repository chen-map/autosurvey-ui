import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BookOpen, FileText, Link2, Plus, Trash2, Upload, X } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { confirmDialog, toast } from '@/components/ui/feedback';
import { cn } from '@/lib/utils';
import {
  bindSkill, createSkill, deleteSkill, getSkillContent, getSkillStudio, updateSkill,
  type SkillFile, type SkillSlot,
} from '@/services/api';

export function SkillStudioPage() {
  const { projectId = '' } = useParams();
  const [slots, setSlots] = useState<SkillSlot[]>([]);
  const [skills, setSkills] = useState<SkillFile[]>([]);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [draftSlot, setDraftSlot] = useState('');
  const [preview, setPreview] = useState<{ name: string; content: string } | null>(null);

  const reload = async () => {
    try {
      const d = await getSkillStudio(projectId);
      setSlots(d.slots);
      setSkills(d.skills);
      setNotice(d.notice);
    } catch (e) {
      toast(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId]);

  const groups = useMemo(() => {
    const g: Record<string, SkillSlot[]> = {};
    for (const s of slots) (g[s.group] ||= []).push(s);
    return g;
  }, [slots]);

  const saveNew = async () => {
    if (!draftName.trim() || !draftContent.trim()) { toast('名称和内容都要填'); return; }
    setBusy(true);
    try {
      await createSkill(projectId, { name: draftName.trim(), content: draftContent.trim(), slot: draftSlot || undefined });
      toast(draftSlot ? `已创建并绑定到 ${draftSlot}` : '技能已创建');
      setCreating(false); setDraftName(''); setDraftContent(''); setDraftSlot('');
      await reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : '创建失败');
    } finally { setBusy(false); }
  };

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${import.meta.env.VITE_API_BASE ?? '/api'}/projects/${projectId}/humanloop/upload?kind=skill`, {
        method: 'POST',
        headers: (() => {
          const tk = localStorage.getItem('as.token') ?? '';
          return (tk ? { Authorization: `Bearer ${tk}` } : {}) as Record<string, string>;
        })(),
        body: fd,
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.detail || '上传失败');
      toast('已上传');
      await reload();
    } catch (e) { toast(e instanceof Error ? e.message : '上传失败'); }
    finally { setBusy(false); }
  };

  const remove = async (name: string) => {
    if (!(await confirmDialog({ title: `删除技能「${name}」？`, body: '绑定关系会一并移除；流水线下一次运行不再加载。', danger: true }))) return;
    try { await deleteSkill(projectId, name); toast('已删除'); await reload(); }
    catch (e) { toast(e instanceof Error ? e.message : '删除失败'); }
  };

  const openPreview = async (name: string) => {
    try {
      const d = await getSkillContent(projectId, name);
      setPreview({ name: d.name, content: d.content });
    } catch (e) { toast(e instanceof Error ? e.message : '读取失败'); }
  };

  const bind = async (slot: string, name: string, action: 'bind' | 'unbind') => {
    try { await bindSkill(projectId, { slot, name, action }); await reload(); }
    catch (e) { toast(e instanceof Error ? e.message : '绑定失败'); }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold tracking-tight text-t1">Skill 工坊</h2>
          <p className="mt-1 max-w-3xl text-[12.5px] leading-5 text-t2">
            给 W3 / W5 的每个具体模块装技能：内置技能 + 你上传/编写的 <code className="rounded bg-black/5 px-1">.md</code>。
            流水线与工作台在对应步骤自动加载，不需要每次手动点选。
          </p>
        </div>
        <div className="flex gap-2">
          <label className={cn('inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-[12px] text-t2 hover:border-brand/50', busy && 'opacity-50')}>
            <Upload size={13} /> 上传 .md
            <input type="file" accept=".md" hidden disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.currentTarget.value = ''; }} />
          </label>
          <Button size="sm" className="border-transparent bg-brand text-white hover:bg-brand-strong" onClick={() => setCreating(true)}>
            <Plus size={13} /> 新建技能
          </Button>
        </div>
      </div>

      {notice && (
        <div className="rounded-xl border border-[#f0e2c8] bg-[#fdf8ee] px-4 py-2.5 text-[11.5px] text-[#8a6a1f]">{notice}</div>
      )}

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* 技能库 */}
        <Card className="h-fit p-4">
          <div className="flex items-center gap-2">
            <BookOpen size={14} className="text-t3" />
            <span className="text-[13px] font-semibold text-t1">技能库</span>
            <span className="rounded-full bg-black/5 px-1.5 text-[10.5px] text-t3">{skills.length}</span>
          </div>
          <div className="mt-3 space-y-2">
            {loading && <div className="py-6 text-center text-[12px] text-t3">加载中…</div>}
            {!loading && skills.length === 0 && (
              <div className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[11.5px] leading-5 text-t3">
                还没有技能。上传 .md 或点「新建技能」。
              </div>
            )}
            {skills.map((s) => (
              <div key={s.name} className="rounded-lg border border-line/60 bg-[#fafaf8] px-3 py-2.5">
                <div className="flex items-start gap-2">
                  <FileText size={13} className="mt-0.5 shrink-0 text-t3" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-medium text-t1" title={s.name}>{s.name.replace(/^\d{6}_/, '')}</div>
                    <div className="mt-0.5 text-[10.5px] text-t3">{s.chars} 字 · 绑定 {s.bound.length} 个模块</div>
                  </div>
                  <button type="button" onClick={() => void openPreview(s.name)} className="shrink-0 text-[10.5px] text-t3 hover:text-brand">预览</button>
                  <button type="button" onClick={() => void remove(s.name)} className="shrink-0 text-t3 hover:text-danger" title="删除"><Trash2 size={12} /></button>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* 模块槽位 */}
        <div className="space-y-4">
          {Object.entries(groups).map(([group, list]) => (
            <div key={group}>
              <div className="mb-2 flex items-center gap-2">
                <span className="rounded bg-ink px-2 py-0.5 text-[11px] font-semibold text-white">{group}</span>
                <span className="text-[11.5px] text-t3">{list.length} 个模块</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {list.map((s) => {
                  const available = skills.filter((k) => !s.bound.includes(k.name));
                  return (
                    <Card key={s.key} className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[13px] font-semibold text-t1">{s.label}</span>
                            <span className="rounded bg-black/5 px-1 py-0.5 font-mono text-[9.5px] text-t3">{s.key}</span>
                            {s.builtin && <Badge variant="ok">内置</Badge>}
                          </div>
                          <p className="mt-1 text-[11.5px] leading-5 text-t2">{s.desc}</p>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        <Link2 size={11} className="text-t3" />
                        {s.tools.length === 0 ? <span className="text-[10px] text-t3">无工具</span>
                          : s.tools.map((t) => <span key={t} className="rounded bg-page px-1.5 py-0.5 font-mono text-[9.5px] text-t3">{t}</span>)}
                      </div>
                      <div className="mt-3 space-y-1.5">
                        <div className="text-[10.5px] font-medium text-t3">已绑定技能</div>
                        {s.bound.length === 0 && <div className="text-[11px] text-t3">（未绑定）</div>}
                        {s.bound.map((name) => (
                          <div key={name} className="flex items-center gap-2 rounded bg-[#eef7f0] px-2 py-1 text-[11px] text-[#0a5a2d]">
                            <span className="min-w-0 flex-1 truncate" title={name}>{name.replace(/^\d{6}_/, '')}</span>
                            <button type="button" onClick={() => void bind(s.key, name, 'unbind')} className="text-[#0a5a2d]/60 hover:text-danger"><X size={11} /></button>
                          </div>
                        ))}
                        {available.length > 0 && (
                          <select value="" onChange={(e) => { if (e.target.value) void bind(s.key, e.target.value, 'bind'); }}
                            className="w-full rounded-lg border border-line bg-white px-2 py-1 text-[11px] text-t2 outline-none">
                            <option value="">＋ 绑定技能…</option>
                            {available.map((k) => <option key={k.name} value={k.name}>{k.name.replace(/^\d{6}_/, '')}</option>)}
                          </select>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 新建技能 */}
      {creating && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 px-4 pt-[10vh] backdrop-blur-[2px]" onClick={() => setCreating(false)}>
          <div className="w-[620px] max-w-full rounded-2xl bg-white p-5 shadow-[0_24px_64px_-12px_rgba(0,0,0,0.4)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="text-[15px] font-semibold text-t1">新建技能</div>
              <button type="button" onClick={() => setCreating(false)} className="text-t3 hover:text-t1"><X size={15} /></button>
            </div>
            <p className="mt-1 text-[11.5px] leading-5 text-t3">
              写一段可复用的指令模板（例如「新颖性必须落在 KG 已出现的概念上」）。保存后可绑定到任意模块。
            </p>
            <input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="技能名称（如：新颖性约束）"
              className="mt-3 w-full rounded-lg border border-line bg-page px-3 py-2 text-[12.5px] text-t1 outline-none focus:border-brand/50" />
            <textarea value={draftContent} onChange={(e) => setDraftContent(e.target.value)} rows={10}
              placeholder="技能内容（Markdown）：目标、约束、检查清单、反例…"
              className="mt-2 w-full resize-y rounded-lg border border-line bg-page px-3 py-2 font-mono text-[12px] leading-5 text-t1 outline-none focus:border-brand/50" />
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[11px] text-t3">保存后绑定到</span>
              <select value={draftSlot} onChange={(e) => setDraftSlot(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-line bg-white px-2 py-1 text-[11.5px] text-t2 outline-none">
                <option value="">暂不绑定</option>
                {slots.map((s) => <option key={s.key} value={s.key}>{s.group} · {s.label}</option>)}
              </select>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setCreating(false)}>取消</Button>
              <Button size="sm" disabled={busy} className="border-transparent bg-brand text-white hover:bg-brand-strong" onClick={() => void saveNew()}>
                {busy ? '保存中…' : '保存'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 预览 */}
      {preview && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 px-4 pt-[8vh] backdrop-blur-[2px]" onClick={() => setPreview(null)}>
          <div className="flex max-h-[78vh] w-[720px] max-w-full flex-col rounded-2xl bg-white shadow-[0_24px_64px_-12px_rgba(0,0,0,0.4)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line/60 px-5 py-3">
              <div className="min-w-0">
                <div className="truncate text-[13.5px] font-semibold text-t1">{preview.name.replace(/^\d{6}_/, '')}</div>
                <div className="text-[10.5px] text-t3">{preview.name}</div>
              </div>
              <button type="button" onClick={() => setPreview(null)} className="text-t3 hover:text-t1"><X size={15} /></button>
            </div>
            <textarea value={preview.content} onChange={(e) => setPreview({ ...preview, content: e.target.value })}
              className="min-h-0 flex-1 resize-none overflow-y-auto bg-[#fbfbfa] p-4 font-mono text-[12px] leading-5 text-t1 outline-none" />
            <div className="flex justify-end gap-2 border-t border-line/60 px-5 py-3">
              <Button variant="secondary" size="sm" onClick={() => setPreview(null)}>取消</Button>
              <Button size="sm" disabled={busy} className="border-transparent bg-brand text-white hover:bg-brand-strong"
                onClick={async () => {
                  setBusy(true);
                  try { await updateSkill(projectId, preview.name, preview.content); toast('已保存'); setPreview(null); await reload(); }
                  catch (e) { toast(e instanceof Error ? e.message : '保存失败'); }
                  finally { setBusy(false); }
                }}>保存修改</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
