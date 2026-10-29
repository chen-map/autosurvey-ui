import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

// 大规模重写弹窗：用户给大纲说明或写作 prompt →
// LLM 结合 W4 各 RQ 深度分析逐章节重写论文正文 → 完成后自动编译 PDF
const API = import.meta.env.VITE_API_BASE ?? '/api';
const authHeaders = (): Record<string, string> => {
  const t = localStorage.getItem('as.token') ?? '';
  return t ? { Authorization: `Bearer ${t}` } : {};
};

export function RewriteModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState('');
  const [prog, setProg] = useState<{ status: string; current?: string; done?: number; total?: number; error?: string } | null>(null);
  const timer = useRef<number | null>(null);

  // 已有任务在跑则进入轮询
  useEffect(() => {
    poll();
    const t = window.setInterval(poll, 4000);
    timer.current = t;
    return () => window.clearInterval(t);
    function poll() {
      fetch(`${API}/projects/${projectId}/humanloop/rewrite_status`, { headers: authHeaders() })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d && (d.status === 'running' || d.status === 'done' || d.status === 'fail')) setProg(d);
        })
        .catch(() => {});
    }
  }, [projectId]);

  const start = async () => {
    setBusy(true); setErr('');
    try {
      const res = await fetch(`${API}/projects/${projectId}/humanloop/rewrite_full`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ prompt }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || '启动失败');
      setProg({ status: 'running', done: 0, total: 0 });
    } catch (e) {
      setErr(e instanceof Error ? e.message : '启动失败');
    } finally { setBusy(false); }
  };

  const running = prog?.status === 'running';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 p-4" onClick={running ? undefined : onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-stone-200 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="text-[15px] font-semibold text-stone-800">大规模重写论文</div>
          {!running && <button type="button" onClick={onClose} className="rounded p-1 text-stone-400 hover:bg-stone-100"><X size={16} /></button>}
        </div>
        <p className="mt-1.5 text-[12px] leading-5 text-stone-500">
          LLM 将结合 W4 各 RQ 深度分析与现有大纲，按你的提示词逐章节重写论文正文（自动备份原稿，完成后自动编译 PDF）。预计 10-20 分钟。
        </p>

        {running ? (
          <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50 px-4 py-4 text-[12.5px] text-stone-700">
            <div className="flex items-center gap-2 font-medium">
              <span className="h-2 w-2 animate-pulse rounded-full bg-stone-900" />
              重写进行中{prog?.total ? `（${prog.done}/${prog.total} 章）` : '…'}
            </div>
            {prog?.current && <div className="mt-1 truncate font-mono text-[11px] text-stone-500">当前：{prog.current}</div>}
            <div className="mt-2 text-[11.5px] text-stone-500">可以关闭本窗口，任务在后台继续；完成后刷新页面并到报告页查看新 PDF。</div>
            <button type="button" onClick={() => window.location.reload()}
              className="mt-3 rounded-lg bg-stone-900 px-3 py-1.5 text-[11.5px] font-medium text-white hover:opacity-85">立即刷新查看</button>
          </div>
        ) : prog?.status === 'fail' ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12.5px] text-red-600">
            上次重写失败：{prog.error || '未知错误'}（原稿备份保留，可重试）
          </div>
        ) : prog?.status === 'done' ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[12.5px] text-emerald-700">
            上次重写已完成并编译 PDF——刷新页面查看新论文。
            <button type="button" onClick={() => window.location.reload()}
              className="ml-2 rounded bg-stone-900 px-2 py-0.5 text-[11px] text-white">刷新</button>
          </div>
        ) : null}

        {!running && (
          <>
            <textarea
              rows={5}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={'写下你的写作提示词，例如：\n· 按工科综述规范重写：每节先给结论表，再分技术路线对比，多用量化数据，克制用词\n· 以「架构—机制—评测—安全」为主线重组全文，突出各章之间的逻辑递进'}
              className="mt-3 w-full resize-none rounded-xl border border-stone-300 px-3 py-2.5 text-[12.5px] leading-5 outline-none focus:border-stone-600"
            />
            {err && <div className="mt-2 text-[11.5px] text-red-500">{err}</div>}
            <div className="mt-3 flex items-center justify-between">
              <span className="text-[11px] text-stone-400">原稿自动备份 · 引用键只减不增</span>
              <div className="flex gap-2">
                <button type="button" onClick={onClose} className="rounded-lg border border-stone-300 px-3 py-1.5 text-[12px] text-stone-600 hover:border-stone-500">取消</button>
                <button type="button" disabled={busy || prompt.trim().length < 10}
                  onClick={() => (confirming ? start() : setConfirming(true))}
                  className={confirming
                    ? 'rounded-lg bg-red-600 px-3 py-1.5 text-[12px] font-medium text-white'
                    : 'rounded-lg bg-stone-900 px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-85 disabled:opacity-40'}>
                  {busy ? '启动中…' : confirming ? '确认：整篇重写' : '开始重写'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
