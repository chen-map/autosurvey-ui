import { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

/**
 * RQ 编辑对话框（大厂质感）：内置 AI 建议。
 * 两种模式：改写当前文本 / 基于宏观 RQ 生成候选子问题。
 */
export function RqEditDialog({
  open, mode, title, hint, initial, busy, onCancel, onSave, onSuggest,
}: {
  open: boolean;
  mode: 'rewrite' | 'expand_sub';
  title: string;
  hint?: string;
  initial: string;
  busy: boolean;
  onCancel: () => void;
  onSave: (text: string) => void;
  onSuggest: (instruction: string) => Promise<string>;
}) {
  const [text, setText] = useState(initial);
  const [instruction, setInstruction] = useState('');
  const [sugBusy, setSugBusy] = useState(false);
  const [err, setErr] = useState('');
  const [aiTouched, setAiTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setText(initial);
      setInstruction('');
      setErr('');
      setAiTouched(false);
    }
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSave(text.trim());
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, text, onCancel, onSave]);

  if (!open) return null;

  const applyInstruction = async () => {
    if (!instruction.trim()) { setErr('请先填写修改意见'); return; }
    setSugBusy(true);
    setErr('');
    try {
      const out = await onSuggest(instruction.trim());
      if (!out) { setErr('AI 没有返回修改结果，换个说法再试'); return; }
      setText(out);
      setAiTouched(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'AI 修改失败');
    } finally {
      setSugBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-[2px] pt-[12vh]"
      onClick={onCancel}>
      <div className="w-[600px] max-w-[94vw] overflow-hidden rounded-2xl bg-white shadow-[0_24px_64px_-12px_rgba(0,0,0,0.35)]"
        onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className="flex items-start justify-between border-b border-line/50 px-5 py-4">
          <div>
            <div className="text-[15px] font-semibold tracking-tight text-t1">{title}</div>
            {hint && <div className="mt-0.5 text-[11.5px] leading-4 text-t3">{hint}</div>}
          </div>
          <button type="button" onClick={onCancel}
            className="rounded-lg p-1.5 text-t3 transition-colors hover:bg-black/5 hover:text-t1">
            <X size={16} />
          </button>
        </div>

        {/* 主体 */}
        <div className="px-5 py-4">
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={mode === 'expand_sub' ? 2 : 4}
            placeholder={mode === 'expand_sub' ? '输入子问题，或点下方让 AI 生成候选' : '输入新的 RQ 文本'}
            className="w-full resize-y rounded-xl border border-line bg-[#fbfbfa] px-3.5 py-3 text-[13px] leading-5 text-t1 outline-none transition-colors focus:border-brand/50 focus:bg-white"
          />

          {/* AI 修改区：用户给意见 → AI 照意见改 → 填入文本框（确认后才保存） */}
          <div className="mt-3 rounded-xl border border-line/60 bg-[#fafaf8] p-3">
            <div className="text-[11.5px] font-medium text-t2">修改意见（告诉 AI 怎么改）</div>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={2}
              placeholder={mode === 'expand_sub'
                ? '例：从证据来源角度拆，强调可检测边界'
                : '例：太宽泛了，聚焦到静态检测手段；或：保留原意但更学术'}
              className="mt-1.5 w-full resize-y rounded-lg border border-line bg-white px-3 py-2 text-[12.5px] leading-5 text-t1 outline-none focus:border-brand/50"
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[10.5px] text-t3">
                {aiTouched ? '✓ AI 已按意见修改，检查后点「确认保存」' : '确认保存后，相关子问题/证据会需要重新对齐'}
              </span>
              <button type="button" disabled={sugBusy || !instruction.trim()}
                onClick={() => void applyInstruction()}
                className={cn('flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors',
                  sugBusy || !instruction.trim() ? 'bg-black/5 text-t3' : 'bg-[#eef7f0] text-[#0a5a2d] hover:bg-[#e2f2e6]')}>
                <Sparkles size={13} className={sugBusy ? 'animate-pulse' : ''} />
                {sugBusy ? 'AI 修改中…' : 'AI 按建议修改'}
              </button>
            </div>
            {err && <div className="mt-1.5 text-[11.5px] text-danger">{err}</div>}
          </div>
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-between border-t border-line/50 bg-[#fafaf8] px-5 py-3">
          <span className="text-[10.5px] text-t3">⌘/Ctrl + Enter 保存 · Esc 取消</span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onCancel}>取消</Button>
            <Button size="sm" disabled={busy || !text.trim()}
              className="bg-brand text-white hover:bg-brand-strong border-transparent"
              onClick={() => onSave(text.trim())}>
              {busy ? '保存中…' : '保存'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
