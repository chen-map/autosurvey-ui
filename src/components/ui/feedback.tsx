import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

/**
 * 自研反馈系统：Toast + Alert/Confirm/Prompt 对话框，替代浏览器原生弹窗。
 * 用法（命令式，无需在每处写 state）：
 *   toast('已保存')
 *   await alertDialog({ title: '编译失败', body: '...' })
 *   if (await confirmDialog({ title: '删除？', body: '...', danger: true })) ...
 *   const s = await promptDialog({ title: '改名', label: '新标题', value: old })
 */

type Kind = 'alert' | 'confirm' | 'prompt';
interface Req {
  kind: Kind;
  title: string;
  body?: string;
  label?: string;
  value?: string;
  danger?: boolean;
  resolve: (v: unknown) => void;
}

let req: Req | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => req;

export function alertDialog(o: { title: string; body?: string; danger?: boolean }): Promise<void> {
  return new Promise((resolve) => {
    req = { ...o, kind: 'alert', resolve: () => resolve() };
    emit();
  });
}
export function confirmDialog(o: { title: string; body?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    req = { ...o, kind: 'confirm', resolve: (v) => resolve(Boolean(v)) };
    emit();
  });
}
export function promptDialog(o: { title: string; label?: string; value?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    req = { ...o, kind: 'prompt', resolve: (v) => resolve(v === null ? null : String(v)) };
    emit();
  });
}

// ── Toast ────────────────────────────────────────────────────────
interface ToastItem { id: number; text: string }
let toasts: ToastItem[] = [];
const toastListeners = new Set<() => void>();
const emitToast = () => toastListeners.forEach((l) => l());
const subscribeToast = (l: () => void) => {
  toastListeners.add(l);
  return () => toastListeners.delete(l);
};
const toastSnapshot = () => toasts;
let toastSeq = 0;

export function toast(text: string) {
  const id = ++toastSeq;
  toasts = [...toasts, { id, text }];
  emitToast();
  window.setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== id);
    emitToast();
  }, 3000);
}

// ── Host ─────────────────────────────────────────────────────────
export function FeedbackHost() {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  const list = useSyncExternalStore(subscribeToast, toastSnapshot, toastSnapshot);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);

  useEffect(() => {
    if (current) {
      setDraft(current.value ?? '');
      const t = window.setTimeout(() => inputRef.current?.focus(), 30);
      return () => window.clearTimeout(t);
    }
  }, [current]);

  useEffect(() => {
    if (!current) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { current.resolve(current.kind === 'prompt' ? null : false); req = null; emit(); }
      if (e.key === 'Enter' && current.kind !== 'prompt') { e.preventDefault(); current.resolve(true); req = null; emit(); }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && current.kind === 'prompt') { current.resolve(draft); req = null; emit(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [current, draft]);

  const close = (v: unknown) => {
    if (!current) return;
    current.resolve(v);
    req = null;
    emit();
  };

  return (
    <>
      {/* Toast 堆栈 */}
      <div className="pointer-events-none fixed bottom-6 left-1/2 z-[70] flex -translate-x-1/2 flex-col items-center gap-2">
        {list.map((t) => (
          <div key={t.id}
            className="pointer-events-auto max-w-[80vw] truncate rounded-xl bg-ink px-4 py-2 text-[12.5px] text-white shadow-[0_10px_30px_-8px_rgba(0,0,0,0.45)]">
            {t.text}
          </div>
        ))}
      </div>

      {/* 对话框 */}
      {current && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/40 pt-[16vh] backdrop-blur-[2px]"
          onClick={() => close(current.kind === 'prompt' ? null : false)}>
          <div className="w-[520px] max-w-[92vw] overflow-hidden rounded-2xl bg-white shadow-[0_24px_64px_-12px_rgba(0,0,0,0.4)]"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 px-5 pt-5">
              <span className={cn('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full',
                current.danger ? 'bg-[#fdecea] text-[#b3261e]' : 'bg-[#eef7f0] text-[#0a5a2d]')}>
                {current.danger ? <AlertTriangle size={16} /> : <Info size={16} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold leading-6 tracking-tight text-t1">{current.title}</div>
                {current.body && (
                  <div className="mt-1 whitespace-pre-line text-[12.5px] leading-5 text-t2">{current.body}</div>
                )}
              </div>
            </div>

            {current.kind === 'prompt' && (
              <div className="px-5 pt-3">
                {current.label && <div className="mb-1 text-[11.5px] text-t3">{current.label}</div>}
                <textarea
                  ref={(el) => { inputRef.current = el; }}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !(e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      close(draft);
                    }
                  }}
                  rows={draft.length > 80 ? 5 : 2}
                  className="w-full resize-y rounded-xl border border-line bg-[#fbfbfa] px-3 py-2 text-[13px] leading-5 text-t1 outline-none focus:border-brand/50 focus:bg-white"
                />
              </div>
            )}

            <div className="flex items-center justify-end gap-2 px-5 py-4">
              {current.kind === 'prompt' && <span className="mr-auto text-[10.5px] text-t3">Enter 确认 · Shift+Enter 换行</span>}
              {current.kind !== 'alert' && (
                <Button variant="secondary" size="sm" onClick={() => close(current.kind === 'prompt' ? null : false)}>取消</Button>
              )}
              <Button size="sm"
                className={cn('border-transparent text-white', current.danger ? 'bg-[#b3261e] hover:bg-[#8f1e17]' : 'bg-brand hover:bg-brand-strong')}
                onClick={() => close(current.kind === 'prompt' ? draft : true)}>
                {current.kind === 'alert' ? '知道了' : current.kind === 'prompt' ? '确认' : current.danger ? '确认删除' : '确定'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
