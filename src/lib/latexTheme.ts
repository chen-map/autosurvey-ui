import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';

// ── Overleaf 风格语法配色（浅色）────────────────────────────────
// 命令=青绿（与品牌绿同族）、数学=紫、注释=灰斜体、引用参数=紫
export const latexHighlight = HighlightStyle.define([
  { tag: t.keyword, color: '#0f8667', fontWeight: '500' },
  { tag: t.moduleKeyword, color: '#0f8667' },
  { tag: t.controlKeyword, color: '#0f8667' },
  { tag: t.definitionKeyword, color: '#0f8667' },
  { tag: t.tagName, color: '#0f8667' },
  { tag: t.atom, color: '#7c4dbe' },
  { tag: t.bool, color: '#7c4dbe' },
  { tag: t.number, color: '#b05613' },
  { tag: t.string, color: '#2b6cb0' },
  { tag: t.comment, color: '#8b949e', fontStyle: 'italic' },
  { tag: t.meta, color: '#6e7781' },
  { tag: t.punctuation, color: '#57606a' },
]);

// ── 编辑器排版：等宽字体 + 宽松行距 + 品牌色光标/选区 ───────────
export const latexEditorTheme: Extension = EditorView.theme(
  {
    '&': { backgroundColor: '#ffffff' },
    '.cm-content': {
      fontFamily:
        '"JetBrains Mono", "SF Mono", "Cascadia Code", Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: '13.5px',
      lineHeight: '1.8',
      caretColor: '#0e7a3d',
      padding: '12px 0',
    },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#0e7a3d' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: 'rgba(14, 122, 61, 0.14)',
    },
    '.cm-activeLine': { backgroundColor: 'rgba(14, 122, 61, 0.045)' },
  },
  { dark: false },
);

export const latexEditorExtensions: Extension[] = [
  latexEditorTheme,
  syntaxHighlighting(latexHighlight),
];
