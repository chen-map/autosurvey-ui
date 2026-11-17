import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bookmark, Plus, Trash2, Search, Upload, FileText } from 'lucide-react';
import { useLibrary } from '@/store/library';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

// 知识库（F16 前端版）：个人收藏论文 + 分类集合，localStorage 持久化
export function KnowledgeBasePage() {
  const { items, collections, remove, moveTo, addCollection, addManual } = useLibrary();
  const fileRef = useRef<HTMLInputElement>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [mTitle, setMTitle] = useState('');
  const [mAuthors, setMAuthors] = useState('');
  const [mYear, setMYear] = useState('');
  const [query, setQuery] = useState('');
  const [coll, setColl] = useState('ALL');
  const [newColl, setNewColl] = useState('');

  const uploadPdfs = (files: File[]) => {
    const target = coll === 'ALL' ? '未分类' : coll;
    files.forEach((f) => addManual({ source: 'upload', title: f.name.replace(/\.pdf$/i, ''), collection: target }));
  };

  const submitManual = () => {
    if (!mTitle.trim()) return;
    const target = coll === 'ALL' ? '未分类' : coll;
    addManual({
      source: 'manual',
      title: mTitle.trim(),
      authors: mAuthors.trim() || undefined,
      year: mYear ? Number(mYear) : undefined,
      collection: target,
    });
    setMTitle('');
    setMAuthors('');
    setMYear('');
    setManualOpen(false);
  };

  const shown = useMemo(
    () =>
      items.filter(
        (i) =>
          (coll === 'ALL' || i.collection === coll) &&
          (i.title.toLowerCase().includes(query.toLowerCase()) || (i.authors ?? '').toLowerCase().includes(query.toLowerCase())),
      ),
    [items, query, coll],
  );

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-[24px] font-semibold leading-8">知识库</h1>
        <span className="text-[13px] text-t3">共 {items.length} 篇收藏</span>
      </div>
      <p className="mt-1 text-[13px] text-t3">
        收藏优秀论文并分类管理，跨项目复用。数据存于本浏览器（后端接入后自动同步，见 backend-todo.md）。
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setColl('ALL')}
          className={cn(
            'rounded-full border px-3 py-1.5 text-[13px] transition-colors',
            coll === 'ALL' ? 'border-ink bg-ink text-white' : 'border-line text-t2 hover:border-ink/60',
          )}
        >
          全部
        </button>
        <button
          type="button"
          onClick={() => setColl('未分类')}
          className={cn(
            'rounded-full border px-3 py-1.5 text-[13px] transition-colors',
            coll === '未分类' ? 'border-ink bg-ink text-white' : 'border-line text-t2 hover:border-ink/60',
          )}
        >
          未分类
        </button>
        {collections.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColl(c)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-[13px] transition-colors',
              coll === c ? 'border-ink bg-ink text-white' : 'border-line text-t2 hover:border-ink/60',
            )}
          >
            {c}
          </button>
        ))}
        <div className="flex items-center gap-1">
          <Input
            placeholder="新建分类集合"
            value={newColl}
            onChange={(e) => setNewColl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                addCollection(newColl);
                setNewColl('');
              }
            }}
            className="h-8 w-40 text-[13px]"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              addCollection(newColl);
              setNewColl('');
            }}
          >
            <Plus size={14} />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".pdf"
            className="hidden"
            onChange={(e) => {
              uploadPdfs(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
          <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload size={13} />
            上传 PDF
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setManualOpen((v) => !v)}>
            <FileText size={13} />
            手动录入
          </Button>
        </div>
        <div className="relative ml-auto min-w-[200px] flex-1 sm:max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-t3" />
          <Input placeholder="搜索收藏…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" />
        </div>
      </div>

      {manualOpen && (
        <Card className="anim-rise mt-4 flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-[220px] flex-1">
            <label className="text-[12px] text-t3">标题 *</label>
            <Input value={mTitle} onChange={(e) => setMTitle(e.target.value)} placeholder="论文标题" className="mt-1" />
          </div>
          <div>
            <label className="text-[12px] text-t3">作者</label>
            <Input value={mAuthors} onChange={(e) => setMAuthors(e.target.value)} placeholder="可选" className="mt-1 w-40" />
          </div>
          <div>
            <label className="text-[12px] text-t3">年份</label>
            <Input value={mYear} onChange={(e) => setMYear(e.target.value)} placeholder="如 2024" className="mt-1 w-24" />
          </div>
          <Button size="sm" onClick={submitManual}>加入知识库</Button>
        </Card>
      )}

      {items.length === 0 ? (
        <Card className="mt-6 flex flex-col items-center gap-3 px-8 py-16 text-center">
          <Bookmark size={28} className="text-t3" />
          <p className="text-[14px] text-t2">知识库还是空的</p>
          <p className="max-w-md text-[13px] leading-5 text-t3">
            在语料库中收藏论文、上传本地 PDF 或手动录入，然后分类管理，跨项目复用。
          </p>
          <Link to="/projects/proj-gnn-survey/corpus" className="text-[13px] text-info-fg underline">
            去语料库收藏 →
          </Link>
        </Card>
      ) : (
        <div className="stagger mt-5 space-y-3">
          {shown.map((i) => (
            <Card key={i.key} className="flex items-center gap-4 p-4 transition-shadow hover:shadow-s2">
              <Bookmark size={16} className="shrink-0 text-ink" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[14px] font-medium text-t1">{i.title}</span>
                  {i.source !== 'corpus' && (
                    <Badge variant="neutral">{i.source === 'upload' ? '上传' : '手动'}</Badge>
                  )}
                </div>
                <div className="mt-0.5 text-[12px] text-t3">
                  {[i.authors, i.venue, i.year].filter((x) => x !== undefined && x !== '').join(' · ') || '—'}
                  {i.citations !== undefined ? ` · 被引 ${i.citations}` : ''} · 收藏于 {i.savedAt}
                </div>
              </div>
              <select
                value={i.collection}
                onChange={(e) => moveTo(i.key, e.target.value)}
                className="h-8 shrink-0 rounded-lg border border-line bg-card px-2 text-[12.5px] text-t2 focus:border-ink focus:outline-none"
                aria-label="移动到分类"
              >
                <option value="未分类">未分类</option>
                {collections.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <Badge variant="neutral">{i.collection}</Badge>
              <button
                type="button"
                title="从知识库移除"
                onClick={() => remove(i.key)}
                className="shrink-0 rounded p-1.5 text-t3 transition-colors hover:bg-black/5 hover:text-danger"
              >
                <Trash2 size={14} />
              </button>
            </Card>
          ))}
          {shown.length === 0 && (
            <div className="py-10 text-center text-[13px] text-t3">当前分类下没有收藏</div>
          )}
        </div>
      )}
    </div>
  );
}
