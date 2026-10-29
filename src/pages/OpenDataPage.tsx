import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, FileJson, FileText, ShieldCheck } from 'lucide-react';
import { loadManifest, showcaseRaw, type ShowcaseManifest } from '@/services/showcase';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

// 站内已渲染好的对应页面（推荐评委从这里看）
const VIEWS = [
  { to: 'rq', label: '证据与结论核查', hint: 'RQ 树 · claims 四维核查 · 原文定位' },
  { to: 'kg', label: '论文关系图', hint: '六类实体节点 · 支持/矛盾边' },
  { to: 'corpus', label: '语料与筛选漏斗', hint: 'PRISMA 漏斗 · 论文表' },
  { to: 'report', label: '大纲与综述报告', hint: '章节树 · PDF 预览' },
];

// 原始数据下载（与线上接口一一对应的静态文件）
const FILES = [
  { file: 'rqs.json', label: 'RQ + 证据 + claims' },
  { file: 'kg.json', label: '论文关系图' },
  { file: 'corpus.json', label: '语料与筛选漏斗' },
  { file: 'report.json', label: '大纲与评审' },
  { file: 'survey.pdf', label: '综述 PDF' },
];

export function OpenDataPage() {
  const [m, setM] = useState<ShowcaseManifest | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    loadManifest().then(setM).catch((e) => setErr(String(e)));
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-[24px] font-semibold leading-8">开放数据</h1>
        <span className="text-[13px] text-t3">只读快照 · 非核心代码</span>
      </div>
      <p className="mt-3 max-w-3xl text-[13px] leading-6 text-t2">
        本页公开的是真实项目运行后的<strong className="font-medium text-t1">数据产物</strong>：
        语料与筛选漏斗、论文关系图、研究问题与证据矩阵、逐条结论的原文定位、评审记录和综述 PDF。
        建议先点每张卡的<strong className="font-medium text-t1">「在线查看」</strong>在页面里看渲染结果，
        需要原始数据或二次分析时再下载对应 JSON / PDF。公开内容不包含后端源码、算法实现、账号、
        服务器路径或密钥。
      </p>

      {err && <div className="mt-6 rounded-lg border border-danger/30 bg-[#fff2f0] px-4 py-3 text-[13px] text-danger">快照清单加载失败：{err}</div>}
      {!m && !err && <div className="mt-10 text-center text-[13px] text-t3">加载中…</div>}

      {m && (
        <>
          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
            {m.projects.map((p) => (
              <Card key={p.id} className="flex flex-col gap-4 p-5">
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-[15px] font-semibold leading-6 text-t1">{p.title}</h2>
                    <Badge variant="info">真实快照</Badge>
                  </div>
                  <p className="mt-1.5 text-[12px] leading-5 text-t3">{p.description}</p>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-2 border-y border-line/60 py-2.5 text-[12px] text-t2">
                  <span><b className="font-medium text-t1">{p.stats.papers}</b> 篇论文</span>
                  <span><b className="font-medium text-t1">{p.stats.kgEdges}</b> 条关系</span>
                  <span><b className="font-medium text-t1">{p.stats.rqs}</b> 个 Sub-RQ</span>
                  <span><b className="font-medium text-t1">{p.stats.claims.verified}</b> 条 claims</span>
                </div>
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-wide text-t3">在线查看</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {VIEWS.map((v) => (
                      <Link
                        key={v.to}
                        to={`/projects/${p.id}/${v.to}`}
                        title={v.hint}
                        className="inline-flex items-center gap-1.5 rounded-md bg-ink px-2.5 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-85"
                      >
                        {v.label}
                      </Link>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-wide text-t3">下载数据</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {FILES.map((f) => (
                      <a
                        key={f.file}
                        href={showcaseRaw(`showcase/${p.id}/${f.file}`)}
                        target="_blank"
                        rel="noreferrer"
                        download
                        className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-[12px] text-t2 transition-colors hover:border-ink hover:text-t1"
                      >
                        {f.file.endsWith('.pdf') ? <FileText size={13} /> : <FileJson size={13} />}
                        {f.label}
                        <Download size={11} className="opacity-50" />
                      </a>
                    ))}
                  </div>
                </div>
              </Card>
            ))}
          </div>

          <h2 className="mt-10 text-[17px] font-semibold">静态数据接口</h2>
          <p className="mt-2 text-[13px] leading-6 text-t2">
            静态快照按真实后端的 REST 语义组织，路径与线上接口一一对应。页面上的项目详情即通过读取这些
            文件渲染，不使用后端服务。
          </p>
          <Card className="mt-4 overflow-x-auto p-0">
            <table className="w-full min-w-[640px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line/70 text-left text-[12px] text-t3">
                  <th className="px-4 py-2.5 font-medium">方法</th>
                  <th className="px-4 py-2.5 font-medium">线上接口</th>
                  <th className="px-4 py-2.5 font-medium">静态文件</th>
                  <th className="px-4 py-2.5 font-medium">内容</th>
                </tr>
              </thead>
              <tbody>
                {m.endpoints.map((e) => (
                  <tr key={e.path} className="border-b border-line/40 last:border-0">
                    <td className="px-4 py-2.5 font-mono text-[12px] text-t3">{e.method}</td>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-t2">{e.path}</td>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-info-fg">{e.static}</td>
                    <td className="px-4 py-2.5 text-t2">{e.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <h2 className="mt-10 text-[17px] font-semibold">字段说明</h2>
          <div className="mt-3 space-y-3 text-[13px] leading-6 text-t2">
            <p><b className="font-medium text-t1">rqs.json</b>：<code className="rounded bg-black/5 px-1">macros[].subs[]</code> 为研究问题树，
              每个 Sub-RQ 带证据强度 <code className="rounded bg-black/5 px-1">level</code>（strong / weak / blocked）
              与冻结论文 ID；<code className="rounded bg-black/5 px-1">claims[]</code> 为结论，<code className="rounded bg-black/5 px-1">sources[].evidence[]</code>
              提供原文引文、PDF 页码与高亮截图。</p>
            <p><b className="font-medium text-t1">kg.json</b>：论文与六类实体为节点，继承、比较、支持、矛盾等关系为边，
              含置信度。</p>
            <p><b className="font-medium text-t1">corpus.json</b>：<code className="rounded bg-black/5 px-1">funnel[]</code> 为检索到下载的筛选漏斗，
              <code className="rounded bg-black/5 px-1">papers[]</code> 为纳入论文及其结构化字段。</p>
            <p><b className="font-medium text-t1">report.json</b>：综述大纲树与多轮评审结论；<b className="font-medium text-t1">survey.pdf</b> 为最终编译稿。</p>
          </div>

          <div className="mt-8 flex items-start gap-2.5 rounded-lg border border-line bg-card px-4 py-3 text-[12px] leading-5 text-t3">
            <ShieldCheck size={16} className="mt-0.5 shrink-0" />
            <p>
              快照在导出时已移除服务器路径与内部标识；论文题录与原文片段来自公开学术文献，仅用于演示证据回溯。
              需要完整系统、私有文献或二次开发，请通过项目主页联系。
            </p>
          </div>
        </>
      )}
    </div>
  );
}
