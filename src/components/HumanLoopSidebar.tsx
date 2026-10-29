import { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft, ChevronRight, FileText, Highlighter, Send, Sparkles, Trash2, Upload, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Markdown from 'react-markdown';
import { RewriteModal } from './RewriteModal';

// 空引用清洗：剔除 LLM 输出里的无内容引用标记（[]、[ ]、\cite{} 等）
const cleanCitations = (t: string): string => (t || '')
  .replace(/\[[\s,;·]*\]/g, '')
  .replace(/\\cite\{[\s,]*\}/g, '')
  .replace(/【[\s,;]*】/g, '')
  .replace(/[ 	]{2,}/g, ' ');

// Human Loop 分屏侧边栏：常驻分屏、挤占主区不覆盖、浅黄暖色。
// 只作用于当前 RQ 界面：聊天 → AI 预更改（红绿 diff）→ 用户确认 → 写回证据矩阵。
// Skill 与参考文件有专门管理面板（仿 harness：已安装列表 + 预览 + 启用 + 删除）。

interface LitRef {
  title: string; year?: number; authors?: string; venue?: string;
  doi?: string; cited_by?: number; abstract?: string;
}

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  proposals?: Proposal[];
  ts?: string;
  model?: string;
  reasoning?: string;
  tools?: { name: string; args: Record<string, unknown>; result_brief: string }[];
  references?: LitRef[];
}

interface Proposal {
  id: string;
  target_kind: 'sub_rq' | 'macro_rq' | 'sub_rq_evidence' | 'outline_node' | 'paper_section';
  rq_id: string;
  sub_rq_id?: string;
  outline_id?: string;
  field?: string;
  file?: string;
  mode?: string;
  old_text?: string;
  new_text?: string;
  add_paper_ids?: string[];
  remove_paper_ids?: string[];
  paper_ids?: string[];
  reason?: string;
  backup?: string;
  reverted?: boolean;
}

interface FileRef { name: string; size: number }

const API = import.meta.env.VITE_API_BASE ?? '/api';
const authHeaders = (): Record<string, string> => {
  const t = localStorage.getItem('as.token') ?? '';
  return t ? { Authorization: `Bearer ${t}` } : {};
};

const fmtSize = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}M` : `${Math.max(1, Math.round(n / 1024))}K`);

function DiffBody({ oldText, newText }: { oldText: string; newText: string }) {
  const [expand, setExpand] = useState(false);
  const MAX = 12;
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const long = oldLines.length + newLines.length > MAX;
  const cut = (ls: string[]) => (expand || !long ? ls : ls.slice(0, 6));
  return (
    <div className="px-3 py-2 font-mono leading-[1.7]">
      {cut(oldLines).map((l, i) => (
        <div key={`o${i}`} className="rounded bg-red-50 px-1.5 text-red-700/90 line-through decoration-red-400/50">{l || ' '}</div>
      ))}
      {long && !expand && <div className="px-1.5 text-[10.5px] text-stone-400">…（旧文 {oldLines.length} 行，展开查看）</div>}
      {cut(newLines).map((l, i) => (
        <div key={`n${i}`} className="rounded bg-emerald-50 px-1.5 text-stone-800">{l || ' '}</div>
      ))}
      {long && !expand && <div className="px-1.5 text-[10.5px] text-stone-400">…（新文 {newLines.length} 行）</div>}
      {long && (
        <button type="button" onClick={() => setExpand((e) => !e)}
          className="mt-1 text-[10.5px] text-stone-500 underline hover:text-stone-700">
          {expand ? '收起' : '展开全部对照'}
        </button>
      )}
    </div>
  );
}

function DiffBlock({ p, applied, onApply, onDismiss, onUndo, applyBusy }: {
  p: Proposal; applied: boolean; onApply: () => void; onDismiss: () => void; onUndo: () => void; applyBusy: boolean;
}) {
  return (
    <div className={cn('mt-2 overflow-hidden rounded-lg border text-[12px]',
      applied ? 'border-emerald-300/70 bg-emerald-50/60' : 'border-stone-200 bg-white/70')}>
      <div className="flex items-center justify-between border-b border-stone-200/70 bg-stone-50/60 px-3 py-1.5">
        <span className="font-medium text-stone-600">
          预更改 · {p.target_kind === 'paper_section' ? `正文${p.mode === 'whole_file' ? '（整节重写）' : ''} ${p.file || ''}` : p.target_kind === 'outline_node' ? `大纲 ${p.outline_id || ''}` : p.target_kind === 'macro_rq' ? `宏观 ${p.rq_id}` : p.target_kind === 'sub_rq_evidence' ? `证据 ${p.sub_rq_id}` : p.sub_rq_id}
        </span>
        {applied
          ? <span className="flex items-center gap-2">
              <span className="text-emerald-600">✓ 已应用</span>
              {p.backup && !p.reverted && (
                <button type="button" onClick={onUndo}
                  className="rounded border border-stone-300 px-1.5 py-0.5 text-[10.5px] text-stone-500 hover:border-red-300 hover:text-red-500" title="恢复到修改前">
                  撤销
                </button>
              )}
              {p.reverted && <span className="text-stone-400">（已撤销）</span>}
            </span>
          : (
            <span className="flex gap-1.5">
              <button type="button" onClick={onApply} disabled={applyBusy}
                className="rounded-md bg-[#18181B] px-2.5 py-0.5 text-[11px] font-medium text-white transition-opacity hover:opacity-85 disabled:opacity-50">
                {applyBusy ? '保存并编译中…' : '应用修改'}</button>
              <button type="button" onClick={onDismiss}
                className="rounded-md border border-stone-300 px-2 py-0.5 text-[11px] text-stone-500 hover:border-stone-500 hover:text-stone-700">忽略</button>
            </span>
          )}
      </div>
      {p.target_kind === 'sub_rq_evidence' ? (
        <div className="px-3 py-2 font-mono leading-[1.8] text-[12px]">
          {(p.remove_paper_ids ?? []).map((id) => (
            <div key={`r-${id}`} className="rounded bg-red-50 px-1.5 text-red-700">− {id}</div>
          ))}
          {(p.add_paper_ids ?? []).map((id) => (
            <div key={`a-${id}`} className="rounded bg-emerald-50 px-1.5 text-emerald-700">+ {id}</div>
          ))}
          {p.paper_ids && <div className="text-stone-600">替换为：{p.paper_ids.join(', ')}</div>}
          {!(p.add_paper_ids?.length || p.remove_paper_ids?.length || p.paper_ids?.length) && (
            <div className="text-stone-400">（无证据变更）</div>
          )}
        </div>
      ) : !applied ? (
        <DiffBody oldText={p.old_text || '（整节原文，确认后整体替换）'} newText={p.new_text ?? ''} />
      ) : (
        <div className="px-3 py-2 font-mono leading-[1.7] text-stone-700">
          {(p.new_text ?? '').split('\n').map((l, i) => <div key={`a${i}`}>{l}</div>)}
        </div>
      )}
      {p.reason && <div className="border-t border-stone-200/70 px-3 py-1.5 text-[11.5px] text-stone-500">理由：{p.reason}</div>}
    </div>
  );
}

/* ---------------- Skill / 文件管理面板（专门界面，仿 harness） ---------------- */
function ManagePanel({ projectId, uploads, skills, useUploads, useSkills,
  onToggle, onRefresh, onClose }: {
  projectId: string;
  uploads: FileRef[]; skills: FileRef[];
  useUploads: string[]; useSkills: string[];
  onToggle: (kind: 'u' | 's', name: string) => void;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'skill' | 'file'>('skill');
  const [preview, setPreview] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const skillInput = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setBusy(true); setErr('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${API}/projects/${projectId}/humanloop/upload?kind=${tab === 'skill' ? 'skill' : 'file'}`, {
        method: 'POST', headers: authHeaders(), body: fd,
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || '上传失败');
      onRefresh();
      onToggle(tab === 'skill' ? 's' : 'u', d.name);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '上传失败');
    } finally { setBusy(false); }
  };

  const remove = async (kind: 'u' | 's', name: string) => {
    setBusy(true); setErr('');
    try {
      const res = await fetch(`${API}/projects/${projectId}/humanloop/files?kind=${kind === 's' ? 'skill' : 'file'}&name=${encodeURIComponent(name)}`, {
        method: 'DELETE', headers: authHeaders(),
      });
      if (!res.ok) throw new Error('删除失败');
      onRefresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '删除失败');
    } finally { setBusy(false); }
  };

  const list = tab === 'skill' ? skills : uploads;
  const useList = tab === 'skill' ? useSkills : useUploads;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 p-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[#E7E5E4] bg-[#FFFFFF] shadow-xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <div className="text-[15px] font-semibold text-[#44403C]">扩展面板</div>
          <button type="button" onClick={onClose} className="rounded p-1 text-stone-400 hover:bg-stone-200/60 hover:text-stone-600"><X size={16} /></button>
        </div>
        {/* Tab */}
        <div className="flex gap-1 px-5">
          {([['skill', '已安装 Skill'], ['file', '参考文件']] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => { setTab(k); setPreview(''); }}
              className={cn('rounded-t-lg px-3.5 py-1.5 text-[12.5px] font-medium transition-colors',
                tab === k ? 'bg-white text-[#44403C] shadow-sm' : 'text-stone-400 hover:text-stone-600')}>
              {label}（{(k === 'skill' ? skills : uploads).length}）
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-[#E7E5E4] bg-white/70 p-4">
          {(<>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[11.5px] text-stone-500">
              {tab === 'skill' ? '.md 指令模板，聊天时点选注入' : 'txt / md / csv / json / pdf（自动提取文本）'}
            </span>
            <button type="button" disabled={busy} onClick={() => (tab === 'skill' ? skillInput.current : fileInput.current)?.click()}
              className="flex items-center gap-1 rounded-lg border border-[#D6D3D1] bg-[#FAFAF9] px-2.5 py-1 text-[11.5px] font-medium text-[#57534E] hover:border-[#A8A29E] disabled:opacity-50">
              <Upload size={11} />{busy ? '处理中…' : '上传'}
            </button>
          </div>
          {list.length === 0 && (
            <div className="py-10 text-center text-[12.5px] text-stone-400">
              还没有{tab === 'skill' ? ' skill —— 上传 .md 模板（分析方法/专家角色/工作流指令）' : '参考文件 —— 上传数据或论文供 AI 结合分析'}
            </div>
          )}
          <div className="space-y-1.5">
            {list.map((f) => {
              const on = useList.includes(f.name);
              return (
                <div key={f.name} className="rounded-xl border border-[#F1EBDB] bg-white/80 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => onToggle(tab === 'skill' ? 's' : 'u', f.name)}
                      className={cn('h-4 w-4 shrink-0 rounded border text-[10px] leading-none text-white transition-colors',
                        on ? 'border-[#18181B] bg-[#18181B]' : 'border-stone-300 bg-white hover:border-[#18181B]')}>
                      {on && '✓'}
                    </button>
                    <FileText size={13} className="shrink-0 text-stone-400" />
                    <button type="button" className="min-w-0 flex-1 truncate text-left text-[12px] text-stone-700 hover:text-[#57534E]"
                      onClick={() => setPreview(preview === f.name ? '' : f.name)} title="点击预览/收起">
                      {f.name.slice(7)}
                    </button>
                    <span className="shrink-0 text-[10.5px] text-stone-400">{fmtSize(f.size)}</span>
                    <button type="button" disabled={busy} onClick={() => remove(tab === 'skill' ? 's' : 'u', f.name)}
                      className="shrink-0 rounded p-1 text-stone-300 hover:bg-red-50 hover:text-red-500" title="删除">
                      <Trash2 size={12} />
                    </button>
                  </div>
                  {preview === f.name && (
                    <div className="mt-2 max-h-48 overflow-y-auto rounded-lg bg-[#FFFFFF] p-2.5 font-mono text-[11px] leading-5 text-stone-600">
                      预览需下载（v3 接入）；当前仅展示元信息。
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {err && <div className="mt-2 text-[11.5px] text-red-500">{err}</div>}
          </>
          )}
        </div>
        <input ref={fileInput} type="file" hidden accept=".txt,.md,.csv,.json,.pdf"
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <input ref={skillInput} type="file" hidden accept=".md"
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </div>
    </div>
  );
}

/* ---------------- 主侧边栏 ---------------- */
export function HumanLoopSidebar({ projectId, rqId, subs, ctxSubId, scope = 'rq' }: {
  projectId: string;
  rqId?: string;
  subs?: { id: string; text: string }[];
  ctxSubId?: string;
  scope?: 'rq' | 'outline';
}) {
  const [open, setOpen] = useState(true); // 默认展开（分屏常驻，必要时收起成细条）
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [recompiling, setRecompiling] = useState<'' | 'run' | 'busy' | 'done' | 'fail'>('');
  const [savedHint, setSavedHint] = useState<'' | 'saved' | 'saved-nopdf'>('');
  const [applyBusy, setApplyBusy] = useState(false);
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [savedPage, setSavedPage] = useState(0);
  const [model, setModel] = useState<string | null>(null);
  const [uploads, setUploads] = useState<FileRef[]>([]);
  const [skills, setSkills] = useState<FileRef[]>([]);
  const [useUploads, setUseUploads] = useState<string[]>([]);
  const [useSkills, setUseSkills] = useState<string[]>([]);
  const [ctxSub, setCtxSub] = useState(ctxSubId ?? '');
  const [appliedIds, setAppliedIds] = useState<string[]>([]);
  const [savedRefs, setSavedRefs] = useState<string[]>([]);
  const [refBusy, setRefBusy] = useState<Record<string, boolean>>({});
  const [refNotes, setRefNotes] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [manage, setManage] = useState(false);
  const [brushing, setBrushing] = useState(false);
  const [quotes, setQuotes] = useState<string[]>([]);
  const [models, setModels] = useState<{ use_case?: string; vendor_id?: number; vendor?: string; label?: string; model: string; thinking?: boolean }[]>([]);
  const [useModel, setUseModel] = useState('');      // 'use_case|model'
  const [thinking, setThinking] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const reloadSession = () => {
    fetch(`${API}/projects/${projectId}/humanloop/session?scope=${scope}`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setMsgs(d.messages ?? []);
        setUploads(d.uploads ?? []);
        setSkills(d.skills ?? []);
        setModel(d.model);
        setModels(d.models ?? []);
      })
      .catch(() => {});

  };
  useEffect(reloadSession, [projectId]);

  // 引用刷 + 圈选：圈选即引用；刷模式下选区持久淡黄高亮并累积多段
  useEffect(() => {
    document.body.classList.toggle('hl-brushing', brushing);
    return () => document.body.classList.remove('hl-brushing');
  }, [brushing]);
  useEffect(() => {
    const onUp = () => {
      const sel = window.getSelection();
      const text = (sel?.toString() || '').trim();
      const anc = sel?.anchorNode as HTMLElement | Text | null;
      const ancEl = anc ? (anc.nodeType === 3 ? anc.parentElement : anc as HTMLElement) : null;
      const inside = ancEl?.closest?.('.hl-sidebar, aside, [data-hl-panel]');
      if (!text || text.length < 8 || text.length > 3000 || inside) return;
      if (brushing) {
        try {
          document.execCommand('styleWithCSS', false, 'true');
          document.execCommand('hiliteColor', false, '#FFF3C4');
        } catch { /* 高亮失败不影响引用 */ }
        setQuotes((q) => [...q, text]);
        window.getSelection()?.removeAllRanges();
      } else {
        setQuotes([text]);
      }
    };
    document.addEventListener('mouseup', onUp);
    return () => document.removeEventListener('mouseup', onUp);
  }, [brushing]);

  const clearBrush = () => {
    setQuotes([]);
    setBrushing(false);
    // 清掉页面上的淡黄高亮（hiliteColor 产生的 span）
    document.querySelectorAll('span[style*="255, 243, 196"], span[style*="#FFF3C4"], span[style*="fff3c4"]').forEach((el) => {
      const span = el as HTMLElement;
      span.style.backgroundColor = '';
      if (!span.getAttribute('style')) span.removeAttribute('style');
    });
  };


  const toggleUse = (list: string[], setList: (v: string[]) => void, name: string) => {
    setList(list.includes(name) ? list.filter((x) => x !== name) : [...list, name]);
  };

  const persist = (next: ChatMsg[]) => {
    fetch(`${API}/projects/${projectId}/humanloop/session`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ messages: next.slice(-200), scope }),
    }).catch(() => {});
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setErr('');
    setBusy(true);
    const SEP = '\n————\n';
    const quoted = quotes.length
      ? `【用户标注的原文】\n${quotes.join(SEP)}\n\n【用户反馈】\n${text}`
      : text;
    const userMsg: ChatMsg = { role: 'user', content: quoted, ts: new Date().toLocaleTimeString() };
    setQuotes([]);
    setBrushing(false);
    const history = [...msgs, userMsg];
    setMsgs(history);
    setInput('');
    try {
      const res = await fetch(`${API}/projects/${projectId}/humanloop/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          messages: history.map(({ role, content }) => ({ role, content })),
          scope,
          rq_context: rqId ? { rq_id: rqId, sub_rq_id: ctxSub || undefined } : null,
          use_skills: useSkills,
          use_uploads: useUploads,
          ...(useModel.startsWith('v:') ? { vendor_id: Number(useModel.slice(2).split('|')[0]), model: useModel.split('|')[1] }
            : useModel ? { use_case: useModel.split('|')[0], model: useModel.split('|')[1] } : {}),
          thinking,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || `请求失败 ${res.status}`);
      const aiMsg: ChatMsg = { role: 'assistant', content: d.reply, proposals: d.proposals, model: d.model, reasoning: d.reasoning || undefined, tools: d.tools?.length ? d.tools : undefined, references: d.references?.length ? d.references : undefined };
      const next = [...history, aiMsg];
      setMsgs(next);
      persist(next);
      if (d.model) setModel(d.model);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '发送失败');
    } finally {
      setBusy(false);
    }
  };

  const recompilePdf = async () => {
    setRecompiling('busy');
    setErr('');
    try {
      const res = await fetch(`${API}/projects/${projectId}/humanloop/recompile`, {
        method: 'POST', headers: authHeaders(),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || '编译失败');
      setRecompiling(d.ok ? 'done' : 'fail');
      if (d.ok) setSavedHint('saved');
    } catch (e) {
      setRecompiling('fail');
      setErr(e instanceof Error ? e.message : '编译失败');
    }
  };

  const undoProposal = async (p: Proposal) => {
    if (!p.backup) return;
    setErr('');
    try {
      const res = await fetch(`${API}/projects/${projectId}/humanloop/undo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ backup: p.backup }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || '撤销失败');
      setMsgs((m) => {
        const next = m.map((msg) => ({
          ...msg,
          proposals: msg.proposals?.map((q) => (q.id === p.id ? { ...q, reverted: true } : q)),
        }));
        persist(next);
        return next;
      });
      if (scope !== 'outline') {
        window.dispatchEvent(new CustomEvent('as:rq-updated', { detail: { undo: true } }));
      } else {
        setSavedHint('saved');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : '撤销失败');
    }
  };

  const applyProposal = async (p: Proposal) => {
    setErr('');
    setApplyBusy(true);
    try {
      const res = await fetch(`${API}/projects/${projectId}/humanloop/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ proposal: p, scope }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || '应用失败');
      setAppliedIds((a) => [...a, p.id]);
      setMsgs((m) => {
        const next = m.map((msg) => ({
          ...msg,
          proposals: msg.proposals?.map((q) => (q.id === p.id ? { ...q, applied: true, backup: d.backup } : q)),
        }));
        persist(next);
        return next;
      });
      // W5（outline）修改落盘+后台编译后，当次界面不动——刷新后展示新论文；
      // RQ 界面保持即时刷新（所见即所得）
      if (scope === 'outline') {
        if ('compiled' in d && d.compiled) {
          setSavedHint('saved');
          setSavedPage(d.page && d.page > 0 ? d.page : 0);
        } else if ('compiled' in d) {
          setSavedHint('saved-nopdf');
        }
      } else {
        window.dispatchEvent(new CustomEvent('as:rq-updated',
          { detail: { rq_id: p.rq_id, sub_rq_id: p.sub_rq_id } }));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : '应用失败');
    } finally {
      setApplyBusy(false);
    }
  };

  const applyAllProposals = async (ps: Proposal[]) => {
    const pending = ps.filter((p) => !appliedIds.includes(p.id) && !(p as Proposal & { applied?: boolean }).applied);
    if (!pending.length) return;
    setErr('');
    setApplyBusy(true);
    try {
      const res = await fetch(`${API}/projects/${projectId}/humanloop/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ proposals: pending, scope }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || '批量应用失败');
      const ids = new Set(pending.map((p) => p.id));
      setAppliedIds((a) => [...a, ...pending.map((p) => p.id)]);
      setMsgs((m) => {
        const next = m.map((msg) => ({
          ...msg,
          proposals: msg.proposals?.map((q) => (ids.has(q.id) ? { ...q, applied: true } : q)),
        }));
        persist(next);
        return next;
      });
      const first = pending.find((p) => p.target_kind !== 'outline_node' && p.target_kind !== 'paper_section');
      if (first) {
        window.dispatchEvent(new CustomEvent('as:rq-updated',
          { detail: { rq_id: first.rq_id, sub_rq_id: first.sub_rq_id } }));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : '批量应用失败');
    } finally {
      setApplyBusy(false);
    }
  };

  const saveReference = async (r: LitRef, sig: string) => {
    setRefBusy((b) => ({ ...b, [sig]: true }));
    setRefNotes((n) => ({ ...n, [sig]: '' }));
    try {
      const res = await fetch(`${API}/projects/${projectId}/humanloop/save-reference`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ paper: r }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.detail || '入库失败');
      setSavedRefs((sv) => (sv.includes(sig) ? sv : [...sv, sig]));
      const c = d.corpus || {};
      setRefNotes((n) => ({ ...n, [sig]: c.has_pdf
        ? '已下载 PDF 并进入语料库，W2 将显示待构建卡片'
        : '已进入语料库；未找到开放 PDF，请到语料库手动上传' }));
    } catch (e) {
      setRefNotes((n) => ({ ...n, [sig]: e instanceof Error ? e.message : '入库失败' }));
    } finally {
      setRefBusy((b) => ({ ...b, [sig]: false }));
    }
  };

  const activeRefs = useUploads.length + useSkills.length;

  /* 收起态：常驻细竖条（分屏把手，固定视口高不随页面滚动） */
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="sticky top-0 -mr-8 -mt-8 -mb-8 flex h-screen w-12 shrink-0 justify-center"
        title="展开 AI 协作侧边栏">
        <div className="my-2 flex w-full flex-col items-center gap-2 rounded-2xl border border-[#E7E5E4] bg-[#FFFFFF] py-5 text-[#57534E] transition-colors hover:bg-[#FAFAF9]">
          <Sparkles size={15} />
          <span className="text-[11px] font-medium" style={{ writingMode: 'vertical-rl' }}>AI 协作</span>
          <ChevronLeft size={14} />
        </div>
      </button>
    );
  }

  return (
    <>
      <aside ref={rootRef} data-hl-panel className="hl-sidebar sticky top-0 -mr-8 -mt-8 -mb-8 flex h-screen w-[320px] min-w-[300px] max-w-[360px] shrink-0">
        <div className="my-2 flex h-full flex-col overflow-hidden rounded-2xl border border-[#E7E5E4] bg-[#FFFFFF] shadow-[0_0_10px_rgba(160,140,95,0.07)]">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-[#F5F5F4] bg-[#FAFAF9]/70 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles size={14} className="shrink-0 text-[#18181B]" />
            <span className="text-[13.5px] font-semibold text-[#44403C]">AI 协作</span>
            {model && <span className="truncate rounded-full bg-white/70 px-2 py-0.5 font-mono text-[10px] text-[#18181B]">{model}</span>}
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setBrushing((b) => !b)} title="引用刷：开启后在左侧界面涂抹文本，持久淡黄高亮并作为原文引用"
              className={cn('rounded-lg p-1.5 transition-colors', brushing ? 'bg-[#FFF3C4] text-[#57534E] ring-1 ring-[#D6D3D1]' : 'text-stone-400 hover:bg-white/70 hover:text-[#57534E]')}>
              <Highlighter size={13} />
            </button>
            <button type="button" onClick={() => setManage(true)}
              className="flex items-center gap-1 rounded-lg border border-[#D6D3D1] px-2 py-1 text-[11px] font-medium text-[#57534E] hover:border-[#A8A29E]"
              title="Skill 与参考文件管理">
              <FileText size={11} />
              扩展{activeRefs > 0 && <span className="ml-0.5 rounded-full bg-[#18181B] px-1.5 text-[9.5px] text-white">{activeRefs}</span>}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-stone-400 hover:bg-white/70 hover:text-[#57534E]" title="收起">
              <ChevronRight size={15} />
            </button>
          </div>
        </div>

        {/* 作用范围 */}
        <div className="flex items-center gap-2 border-b border-[#F5F5F4] px-4 py-2 text-[11.5px] text-[#57534E]">
          <span className="shrink-0 font-medium">作用范围</span>
          {scope === 'outline' ? (
            <span className="truncate text-stone-500">综述大纲（章节 / 小节标题，修改即时写入大纲文件）</span>
          ) : rqId ? (
            <select value={ctxSub} onChange={(e) => setCtxSub(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-[#D6D3D1] bg-white/80 px-2 py-1 text-[11.5px] text-stone-700 outline-none">
              <option value="">整个 {rqId}（宏观 RQ）</option>
              {(subs ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.id} {s.text.slice(0, 26)}</option>
              ))}
            </select>
          ) : (
            <span className="truncate text-stone-500">RQ 体系总览（进入 RQ 详情可锁定单条）</span>
          )}
        </div>

        {/* 已启用引用条 */}
        {activeRefs > 0 && (
          <div className="flex flex-wrap items-center gap-1 border-b border-[#F5F5F4] px-4 py-1.5">
            <span className="text-[10.5px] text-[#18181B]">引用中</span>
            {[...useSkills.map((n) => ({ n, k: 's' as const })), ...useUploads.map((n) => ({ n, k: 'u' as const }))].map(({ n, k }) => (
              <button key={k + n} type="button"
                onClick={() => (k === 's' ? toggleUse(useSkills, setUseSkills, n) : toggleUse(useUploads, setUseUploads, n))}
                className="flex max-w-[150px] items-center gap-1 rounded-full bg-[#18181B]/90 px-2 py-0.5 text-[10px] text-white hover:opacity-80"
                title="点击取消引用">
                <span className="truncate">{n.slice(7)}</span>
                <X size={9} />
              </button>
            ))}
          </div>
        )}

        {/* 消息流 */}
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {msgs.length === 0 && (
            <div className="rounded-xl border border-[#F1EBDB] bg-white/60 p-4 text-[12.5px] leading-[1.9] text-stone-600">
              {scope === 'outline'
                ? (
                  <>
                    <div className="mb-1 font-medium text-[#44403C]">和我聊聊综述大纲与论文：</div>
                    ·「现在的大纲不对，我想重新调整一下」
                    <br />·「我自己提供写论文的提示词」（上传为 Skill 或文件）
                    <br />·「请你帮我检查写得如何」
                    <br />·「AI 味太重了，帮我去 AI 味」
                    <br /><span className="text-stone-400">修改红绿对照、确认后写入文件（可撤销）；改完点「重新编译 PDF」出新版。</span>
                  </>
                )
                : (
                  <>
                    <div className="mb-1 font-medium text-[#44403C]">和我聊聊你对 RQ 的想法：</div>
                    ·「这个 RQ 的回答方向不对，我认为应该……」
                    <br />·「我有个融合了自己想法的 RQ，帮我看看」
                    <br />·「子问题分解得不好，先讲讲现状」
                    <br />· 上传数据/论文后：「根据这份材料重新分析」
                    <br /><span className="text-stone-400">不明确之处我会先追问；修改建议红绿对照，你确认后才写入。</span>
                  </>
                )}
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div className={cn('max-w-[92%] rounded-2xl px-3.5 py-2.5 text-[12.5px] leading-[1.8]',
                m.role === 'user'
                  ? 'rounded-br-md bg-[#18181B] text-white'
                  : 'rounded-bl-md border border-[#F1EBDB] bg-white/85 text-stone-800')}>
                {m.role === 'assistant' && m.tools && m.tools.length > 0 && (
                  <div className="mb-1.5 space-y-1">
                    {m.tools.map((t, i) => (
                      <div key={i} className="rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-[10.5px] leading-4 text-stone-500">
                        <span className="font-semibold text-stone-700">🔧 {t.name}</span>
                        {t.args && Object.keys(t.args).length > 0 && (
                          <span className="ml-1 font-mono text-stone-400">{JSON.stringify(t.args).slice(0, 60)}</span>
                        )}
                        <div className="mt-0.5 truncate text-stone-400" title={t.result_brief}>→ {t.result_brief}</div>
                      </div>
                    ))}
                  </div>
                )}
                {m.role === 'assistant' && m.references && m.references.length > 0 && (
                  <div className="mb-1.5 rounded-lg border border-[#E7E5E4] bg-[#FAFAF9] px-2.5 py-2">
                    <div className="text-[10.5px] font-medium text-stone-600">📚 外部真实文献（可入证据库）</div>
                    <div className="mt-1 space-y-1">
                      {m.references.map((r, ri) => {
                        const sig = `${i}-${ri}`;
                        const saved = savedRefs.includes(sig);
                        return (
                          <div key={ri} className="flex items-center justify-between gap-2 rounded border border-stone-200 bg-white px-2 py-1">
                            <div className="min-w-0 flex-1 text-[10.5px] leading-4 text-stone-600">
                              <div className="truncate font-medium text-stone-700">{r.title}</div>
                              <div className="text-stone-400">{r.venue || '未知来源'} {r.year || ''} {r.doi ? `DOI: ${r.doi}` : ''}</div>
                            </div>
                            <button type="button"
                              title={saved ? '已入外部文献；再次点击可同步到语料库' : '加入语料库并尝试下载开放 PDF'}
                              disabled={!!refBusy[sig]}
                              onClick={() => void saveReference(r, sig)}
                              className={cn('shrink-0 rounded border px-1.5 py-0.5 text-[10px] transition-colors',
                                saved ? 'border-ok/40 bg-ok/10 text-ok' : 'border-stone-300 text-stone-600 hover:border-ink hover:text-ink')}
                            >{refBusy[sig] ? (<span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 animate-spin rounded-full border border-stone-400 border-t-transparent" />正在下载…</span>) : saved ? '✓ 已入库' : '+ 入库'}</button>
                          </div>
                        );
                      })}
                    </div>
                    {Object.values(refNotes).filter(Boolean).slice(-1)[0] && (
                      <div className="mt-1 text-[10px] leading-4 text-stone-500">{Object.values(refNotes).filter(Boolean).slice(-1)[0]}</div>
                    )}
                    <div className="mt-1 text-[10px] text-stone-400">入库后进入语料库和外部参考文献清单；能拿到开放 PDF 的会自动生成 W2 待构建卡片，否则请在语料库手动上传 PDF。</div>
                  </div>
                )}
                {m.role === 'assistant' && m.reasoning && (
                  <details className="mb-1.5 rounded-lg border border-[#E7E5E4] bg-[#FAFAF9]/60 px-2.5 py-1.5">
                    <summary className="cursor-pointer text-[11px] text-[#57534E]">💭 思考过程（点开查看）</summary>
                    <div className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap text-[11px] leading-4 text-stone-500">{m.reasoning}</div>
                  </details>
                )}
                {m.role === 'assistant'
                  ? <div className="hl-md"><Markdown>{cleanCitations(m.content)}</Markdown></div>
                  : <div className="whitespace-pre-wrap">{m.content}</div>}
                {(() => {
                  const pending = (m.proposals ?? []).filter((p) =>
                    !appliedIds.includes(p.id) && !(p as Proposal & { applied?: boolean }).applied);
                  return pending.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => void applyAllProposals(m.proposals ?? [])}
                      disabled={applyBusy}
                      className="mb-2 w-full rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-[11.5px] font-medium text-stone-700 transition-colors hover:border-stone-500 hover:bg-stone-50 disabled:opacity-50"
                    >
                      应用全部修改（{pending.length} 条）
                    </button>
                  ) : null;
                })()}
                {m.proposals?.map((p) => {
                  const isApplied = appliedIds.includes(p.id) || (p as Proposal & { applied?: boolean }).applied === true;
                  return (
                    <DiffBlock key={p.id} p={p} applied={isApplied} applyBusy={applyBusy}
                      onApply={() => applyProposal(p)}
                      onDismiss={() => setAppliedIds((a) => [...a, p.id])}
                      onUndo={() => undoProposal(p)} />
                  );
                })}
              </div>
            </div>
          ))}
          {applyBusy && (
            <div className="flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-[11.5px] text-stone-600">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-stone-900" />
              正在保存修改并重新编译论文（约 10-20 秒）——完成后会提示刷新，请稍候…
            </div>
          )}
          {scope === 'outline' && savedHint && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2.5 text-[11.5px] leading-5 text-emerald-800">
              <span>✓ {savedHint === 'saved'
                ? `修改已保存，论文已重新编译${savedPage > 0 ? `（新文见第 ${savedPage} 页）` : ''}——刷新页面查看新论文`
                : '修改已保存；PDF 尚未编译成功，可点下方重试或稍后刷新'}</span>
              <button type="button" onClick={() => window.location.reload()}
                className="ml-auto shrink-0 rounded-lg bg-stone-900 px-2.5 py-1 text-[11px] font-medium text-white hover:opacity-85">刷新查看</button>
              <button type="button" onClick={() => setSavedHint('')} className="shrink-0 text-stone-400 hover:text-stone-600"><X size={12} /></button>
            </div>
          )}
          {scope === 'outline' && ['run', 'busy', 'fail'].includes(recompiling) && (
            <div className="rounded-xl border border-[#D6D3D1] bg-[#FEFDF5] px-3 py-2.5 text-[11.5px] leading-5 text-[#44403C]">
              {recompiling === 'run' && '文件已修改——PDF 还是旧版。点下方按钮仅重新编译（不重跑 LLM 写作）。'}
              {recompiling === 'busy' && '正在编译 PDF（tectonic，约 1-3 分钟）…'}
              {recompiling === 'fail' && '上次编译失败，可重试；也可在流水线页完整重跑 W5（RQ 重构后用）。'}
              {recompiling !== 'busy' && (
                <div className="mt-2">
                  <button type="button" onClick={recompilePdf}
                    className="rounded-lg bg-stone-900 px-2.5 py-1 text-[11px] font-medium text-white hover:opacity-85">
                    {recompiling === 'fail' ? '重试编译' : '重新编译 PDF'}
                  </button>
                </div>
              )}
            </div>
          )}
          {busy && (
            <div className="flex items-center gap-1.5 text-[12px] text-[#18181B]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#18181B]" />思考中…
            </div>
          )}
          {err && (
            <div className="flex items-start gap-1.5 rounded-xl border border-red-200 bg-red-50/80 px-2.5 py-2 text-[11.5px] text-red-600">
              {err}<button type="button" onClick={() => setErr('')} className="ml-auto"><X size={12} /></button>
            </div>
          )}
        </div>

        {/* 引用条：刷/圈选的多段原文（发送时作为"用户标注的原文"分区） */}
        {quotes.length > 0 && (
          <div className="border-t border-[#F5F5F4] bg-[#FEFDF5]/80 px-4 py-2">
            <div className="flex items-center gap-1.5 pb-1">
              <Highlighter size={11} className="text-[#A8A29E]" />
              <span className="text-[10.5px] font-medium text-[#57534E]">已标注 {quotes.length} 段原文</span>
              <span className="text-[10px] text-stone-400">原文 + 你的反馈将一并发送</span>
              <button type="button" onClick={clearBrush}
                className="ml-auto rounded px-1.5 py-0.5 text-[10px] text-stone-400 hover:bg-white/70 hover:text-stone-600">
                清空并取消高亮
              </button>
            </div>
            <div className="max-h-20 space-y-1 overflow-y-auto">
              {quotes.map((q, i) => (
                <div key={i} className="flex items-start gap-1.5 rounded bg-[#FFF3C4]/60 px-2 py-1">
                  <span className="text-[9.5px] text-[#A8A29E]">{i + 1}</span>
                  <div className="flex-1 text-[11px] leading-4 text-stone-600">
                    {q.length > 110 ? `${q.slice(0, 110)}…` : q}
                  </div>
                  <button type="button" onClick={() => setQuotes((qs) => qs.filter((_, j) => j !== i))}
                    className="shrink-0 text-stone-400 hover:text-stone-600"><X size={11} /></button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 模型与思考（放底部、明显、黑色文字） */}
        <div className="flex items-center gap-2 border-t border-[#F5F5F4] bg-[#FAFAF9]/60 px-4 py-2">
          <span className="text-[11.5px] font-semibold text-stone-800">模型</span>
          <select value={useModel} onChange={(e) => setUseModel(e.target.value)}
            className="min-w-0 flex-1 truncate rounded-lg border border-stone-300 bg-white px-2 py-1 text-[11.5px] font-medium text-stone-800 outline-none focus:border-stone-500"
            title="切换模型（在个人中心预配置多张卡）">
            <option value="">{model || '默认模型'}（默认）</option>
            {(() => {
              const vs = models.filter((m) => m.vendor_id);
              const groups = new Map<string, typeof vs>();
              vs.forEach((m) => {
                const g = m.vendor || '自配';
                if (!groups.has(g)) groups.set(g, []);
                groups.get(g)!.push(m);
              });
              return Array.from(groups.entries()).map(([g, ms]) => (
                <optgroup key={g} label={g}>
                  {ms.map((m) => (
                    <option key={`v${m.vendor_id}-${m.model}`} value={`v:${m.vendor_id}|${m.model}`}>{m.model}</option>
                  ))}
                </optgroup>
              ));
            })()}
            <optgroup label="流水线配置卡">
              {models.filter((m) => !m.vendor_id).map((m) => (
                <option key={(m.use_case || '') + m.model} value={`${m.use_case}|${m.model}`}>
                  {m.use_case} · {m.model}{m.thinking ? '（思考）' : ''}
                </option>
              ))}
            </optgroup>
          </select>
          <button type="button" onClick={() => setThinking((t) => !t)} title="思考模式：DeepSeek reasoner，展示推理过程"
            className={cn('flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold transition-colors',
              thinking ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white text-stone-700 hover:border-stone-500')}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.5 2A5.5 5.5 0 0 0 4 7.5c0 1.5.5 2.7 1.4 3.7L4 22l5-2h6l5 2-1.4-10.8A5.5 5.5 0 0 0 14.5 2z"/></svg>
            思考{thinking ? '开' : '关'}
          </button>
        </div>

        {/* 输入区 */}
        <div className="border-t border-[#F5F5F4] bg-[#FAFAF9]/50 p-3">
          <div className="flex items-end gap-2 rounded-2xl border border-[#D6D3D1] bg-white/85 px-3 py-2 transition-colors focus-within:border-[#A8A29E]">
            <textarea rows={2} value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
              placeholder={activeRefs ? `已引用 ${activeRefs} 个文件 · 说出你的想法（Ctrl+Enter 发送）` : '说出你的想法或修改意见（Ctrl+Enter 发送）'}
              className="max-h-32 min-h-[40px] flex-1 resize-none bg-transparent text-[12.5px] leading-5 text-stone-700 outline-none placeholder:text-stone-400" />
            <button type="button" onClick={send} disabled={busy || !input.trim()}
              className="shrink-0 rounded-xl bg-[#18181B] p-2 text-white transition-opacity hover:opacity-85 disabled:opacity-40" title="发送">
              <Send size={14} />
            </button>
          </div>
          <div className="mt-1.5 flex items-center justify-between px-1 text-[10.5px] text-stone-400">
            <span>修改经确认后写入 · 记录保存</span>
            <button type="button" onClick={() => { setMsgs([]); persist([]); }} className="hover:text-red-500">清空对话</button>
          </div>
        </div>
        </div>
      </aside>

      {rewriteOpen && (
        <RewriteModal projectId={projectId} onClose={() => setRewriteOpen(false)} />
      )}

      {manage && (
        <ManagePanel projectId={projectId} uploads={uploads} skills={skills}
          useUploads={useUploads} useSkills={useSkills}
          onToggle={(k, n) => (k === 's' ? toggleUse(useSkills, setUseSkills, n) : toggleUse(useUploads, setUseUploads, n))}
          onRefresh={reloadSession} onClose={() => setManage(false)} />
      )}
    </>
  );
}
