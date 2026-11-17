import { useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { undo, redo } from '@codemirror/commands';
import {
  Bold, Italic, Underline, Link2, Image as ImageIcon, Table, List, ListOrdered,
  Undo2, Redo2, Quote, AlignCenter, Sigma, Braces,
} from 'lucide-react';

/** 对编辑器选区做包裹/插入（无选区时插入占位文本并选中占位符） */
function applyFormat(v: EditorView | null, before: string, after: string, placeholder = '') {
  if (!v) return;
  const { from, to } = v.state.selection.main;
  const sel = v.state.doc.sliceString(from, to);
  const text = sel || placeholder;
  v.dispatch({
    changes: { from, to, insert: before + text + after },
    selection: { anchor: from + before.length, head: from + before.length + text.length },
  });
  v.focus();
}

const MATH_SYMBOLS: { label: string; tex: string }[] = [
  { label: 'α', tex: '\\alpha' }, { label: 'β', tex: '\\beta' }, { label: 'γ', tex: '\\gamma' },
  { label: 'δ', tex: '\\delta' }, { label: 'θ', tex: '\\theta' }, { label: 'λ', tex: '\\lambda' },
  { label: 'μ', tex: '\\mu' }, { label: 'σ', tex: '\\sigma' }, { label: 'Σ', tex: '\\sum' },
  { label: '∫', tex: '\\int' }, { label: '∂', tex: '\\partial' }, { label: '∇', tex: '\\nabla' },
  { label: '≤', tex: '\\leq' }, { label: '≥', tex: '\\geq' }, { label: '≈', tex: '\\approx' },
  { label: '≠', tex: '\\neq' }, { label: '×', tex: '\\times' }, { label: '±', tex: '\\pm' },
  { label: '∈', tex: '\\in' }, { label: '→∞', tex: '\\to\\infty' }, { label: 'ℝ', tex: '\\mathbb{R}' },
  { label: '𝒪', tex: '\\mathcal{O}' },
];

export function EditorToolbar({
  viewRef, onCite,
}: { viewRef: { current: EditorView | null }; onCite: () => void }) {

  const [mathOpen, setMathOpen] = useState(false);
  const btn =
    'grid h-7 w-7 shrink-0 place-items-center rounded text-t2 transition-colors hover:bg-black/10 hover:text-t1';
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-line/60 bg-[#fafaf8] px-2 py-1">
      <button type="button" className={btn} title="撤销 (Ctrl+Z)"
        onClick={() => { const v = viewRef.current; if (v) { undo(v); v.focus(); } }}>
        <Undo2 size={14} />
      </button>
      <button type="button" className={btn} title="重做 (Ctrl+Shift+Z)"
        onClick={() => { const v = viewRef.current; if (v) { redo(v); v.focus(); } }}>
        <Redo2 size={14} />
      </button>
      <span className="mx-1 h-4 w-px bg-line" />
      <button type="button" className={btn} title="粗体 \textbf"
        onClick={() => applyFormat(viewRef.current, '\\textbf{', '}', 'bold')}>
        <Bold size={14} />
      </button>
      <button type="button" className={btn} title="斜体 \textit"
        onClick={() => applyFormat(viewRef.current, '\\textit{', '}', 'italic')}>
        <Italic size={14} />
      </button>
      <button type="button" className={btn} title="下划线 \underline"
        onClick={() => applyFormat(viewRef.current, '\\underline{', '}', 'text')}>
        <Underline size={14} />
      </button>
      <button type="button" className={btn} title="等宽 \texttt"
        onClick={() => applyFormat(viewRef.current, '\\texttt{', '}', 'code')}>
        <Braces size={14} />
      </button>
      <span className="mx-1 h-4 w-px bg-line" />
      <div className="relative">
        <button type="button" className={btn} title="数学符号"
          onClick={() => setMathOpen((v) => !v)}>
          <Sigma size={14} />
        </button>
        {mathOpen && (
          <div className="absolute left-0 top-8 z-30 grid w-[228px] grid-cols-6 gap-0.5 rounded-lg border border-line bg-white p-1.5 shadow-lg">
            {MATH_SYMBOLS.map((s) => (
              <button key={s.tex} type="button" title={s.tex}
                className="h-7 rounded text-[13px] text-t1 hover:bg-black/10"
                onClick={() => applyFormat(viewRef.current, '$' + s.tex + '$', '', '')}>
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <button type="button" className={btn} title="链接 \href"
        onClick={() => applyFormat(viewRef.current, '\\href{https://', '}{link text}', '')}>
        <Link2 size={14} />
      </button>
      <button type="button" className={btn} title="插入图片（figure 模板）"
        onClick={() => applyFormat(viewRef.current, '\\begin{figure}[h]\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{', '}\n  \\caption{Caption}\n  \\label{fig:label}\n\\end{figure}', 'figure.png')}>
        <ImageIcon size={14} />
      </button>
      <button type="button" className={btn} title="插入表格模板"
        onClick={() => applyFormat(viewRef.current, '\\begin{table}[h]\n  \\centering\n  \\begin{tabular}{lll}\n    \\hline\n    ', ' \\\\\n    \\hline\n  \\end{tabular}\n  \\caption{Caption}\n\\end{table}', 'A & B & C')}>
        <Table size={14} />
      </button>
      <button type="button" className={btn} title="无序列表"
        onClick={() => applyFormat(viewRef.current, '\\begin{itemize}\n  \\item ', '\n  \\item \n\\end{itemize}', 'item')}>
        <List size={14} />
      </button>
      <button type="button" className={btn} title="有序列表"
        onClick={() => applyFormat(viewRef.current, '\\begin{enumerate}\n  \\item ', '\n\\end{enumerate}', 'item')}>
        <ListOrdered size={14} />
      </button>
      <button type="button" className={btn} title="居中"
        onClick={() => applyFormat(viewRef.current, '\\begin{center}\n  ', '\n\\end{center}', '')}>
        <AlignCenter size={14} />
      </button>
      <span className="mx-1 h-4 w-px bg-line" />
      <button type="button" className={btn} title="插入引用（从文献库选）"
        onClick={onCite}>
        <Quote size={14} />
      </button>
    </div>
  );
}
