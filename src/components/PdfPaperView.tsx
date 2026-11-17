import { useEffect, useRef, useState } from 'react';
// Vite 会把 worker 作为静态资源打包（?url），避免主线程 parse 阻塞
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// PDF.js 动态加载：即使该库在用户浏览器上不兼容（v6 要求较新的浏览器 API），
// 也只降级为原生 PDF 查看器，不会拖垮整个应用的渲染。
type PdfApi = typeof import('pdfjs-dist');

/**
 * Overleaf 式 PDF 纸张视图：灰色画布 + 白色纸页（逐页 canvas，带阴影与页间距）
 * + 缩放控制。与浏览器原生 PDF 查看器不同，页面像"纸"浮在画布上。
 */
export function PdfPaperView({ url, title = 'PDF 预览' }: { url: string; title?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pages, setPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [native, setNative] = useState(false);

  useEffect(() => {
    let alive = true;
    let doc: { numPages: number; destroy?: () => Promise<void> } | null = null;
    setLoading(true);
    setError('');
    (async () => {
      // 动态加载 PDF.js；失败则退回浏览器原生 PDF 查看器
      let pdfjsLib: PdfApi;
      try {
        pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
      } catch {
        if (alive) { setNative(true); setLoading(false); }
        return;
      }
      try {
        const task = pdfjsLib.getDocument({ url });
        doc = await task.promise;
        if (!alive) return;
        setPages(doc.numPages);
        const hostEl = host.current;
        if (!hostEl) return;
        hostEl.innerHTML = '';
        // A4 宽度约 595pt；按容器宽度自适应（zoom=1 视为"适应宽度"的 0.9 倍）
        const baseScale = 1.15;
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await (doc as unknown as { getPage: (i: number) => Promise<{ getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: unknown) => { promise: Promise<void> } }> }).getPage(n);
          if (!alive) return;
          const viewport = page.getViewport({ scale: baseScale * zoom });
          const canvas = document.createElement('canvas');
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          canvas.width = Math.floor(viewport.width * dpr);
          canvas.height = Math.floor(viewport.height * dpr);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;
          canvas.className =
            'my-4 block bg-white shadow-[0_2px_10px_rgba(0,0,0,0.28)] ring-1 ring-black/5';
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          // DPR：canvas 物理尺寸放大 dpr 倍时必须同时给 transform，
          // 否则内容按 1x 画在 2x 画布上 → 文字放大裁切、双栏挤压（用户看到的渲染乱）
          const transform = dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined;
          await page.render({ canvas, canvasContext: ctx, viewport, transform } as never).promise;
          if (!alive) return;
          hostEl.appendChild(canvas);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'PDF 解析失败');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      doc?.destroy?.().catch(() => {});
    };
  }, [url, zoom]);

  // PDF.js 不可用（浏览器过旧/加载失败）→ 退回浏览器原生 PDF 查看器
  if (native) {
    return <iframe src={url} className="h-full w-full border-0 bg-[#525659]" title={title} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#ededed]">
      {/* 工具栏：页码 + 缩放（Overleaf 式） */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-black/10 px-2 text-[11px] text-t2">
        <span className="pl-1">
          {loading ? '解析中…' : error ? '—' : `${pages} 页`}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            title="缩小"
            className="grid h-6 w-6 place-items-center rounded hover:bg-black/10"
            onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.15).toFixed(2)))}
          >
            −
          </button>
          <span className="w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            title="放大"
            className="grid h-6 w-6 place-items-center rounded hover:bg-black/10"
            onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.15).toFixed(2)))}
          >
            +
          </button>
          <button
            type="button"
            title="适应宽度"
            className="ml-1 rounded px-1.5 py-0.5 hover:bg-black/10"
            onClick={() => setZoom(1)}
          >
            适应
          </button>
        </div>
      </div>
      {/* 纸张画布：host 是无 React children 的叶子节点——canvas 由 effect 手动挂载，
          React 不管理其子树，避免 removeChild 冲突（曾导致整页渲染异常）。 */}
      <div className="relative min-h-0 flex-1">
        <div ref={host} className="absolute inset-0 overflow-auto px-3 pb-6 pt-1" title={title} />
        {!error && loading && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[12px] text-t3">
            正在渲染 PDF…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-[12px] text-danger">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
