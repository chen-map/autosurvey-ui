import { useEffect, useState } from 'react';
import { Trash2, X } from 'lucide-react';

// AI 协作侧边栏的模型配置（用户裁决：入口放个人中心）
// 两级结构（学 ZCode）：一个厂商一张卡（API Key + 接口地址），卡内多个模型；
// 聊天时在侧边栏底部「模型」下拉按厂商分组选择。

interface HlVendor { id: number; label: string; baseUrl: string; models: string[]; provider: string; keyMasked: string }

const API = import.meta.env.VITE_API_BASE ?? '/api';
const authHeaders = (): Record<string, string> => {
  const t = localStorage.getItem('as.token') ?? '';
  return t ? { Authorization: `Bearer ${t}` } : {};
};

const VENDOR_PRESETS = [
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner'], provider: 'openai' },
  { id: 'deepseek-anthropic', label: 'DeepSeek（Anthropic 端点）', baseUrl: 'https://api.deepseek.com/anthropic', models: ['deepseek-chat', 'deepseek-reasoner'], provider: 'anthropic' },
  { id: 'anthropic', label: 'Anthropic Claude', baseUrl: 'https://api.anthropic.com', models: ['claude-sonnet-4-5', 'claude-haiku-4-5'], provider: 'anthropic' },
  { id: 'moonshot', label: 'Moonshot 月之暗面', baseUrl: 'https://api.moonshot.cn/v1', models: ['kimi-k2-0905-preview', 'moonshot-v1-32k'], provider: 'openai' },
  { id: 'qwen', label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-plus', 'qwen-max', 'qwen-turbo'], provider: 'openai' },
  { id: 'zhipu', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4.6', 'glm-4.5-air'], provider: 'openai' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: ['gpt-4o-mini', 'gpt-4o'], provider: 'openai' },
  { id: 'custom', label: '自定义', baseUrl: '', models: [], provider: 'openai' },
] as const;

export function HlVendorManager({ compact = false }: { compact?: boolean }) {
  const [vendors, setVendors] = useState<HlVendor[]>([]);
  const [vendor, setVendor] = useState('deepseek');
  const [baseUrl, setBaseUrl] = useState<string>(VENDOR_PRESETS[0].baseUrl);
  const [proto, setProto] = useState<'openai' | 'anthropic'>('openai');
  const [apiKey, setApiKey] = useState('');
  const [newModel, setNewModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = () => {
    fetch(`${API}/me/hl-vendors`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setVendors(d.vendors ?? []))
      .catch(() => {});
  };
  useEffect(load, []);

  const pickVendor = (id: string) => {
    setVendor(id);
    const v = VENDOR_PRESETS.find((x) => x.id === id)!;
    setBaseUrl(v.baseUrl);
    setProto(v.provider as 'openai' | 'anthropic');
  };

  const addVendor = async () => {
    setBusy(true); setErr('');
    try {
      const v = VENDOR_PRESETS.find((x) => x.id === vendor)!;
      const res = await fetch(`${API}/me/hl-vendors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ label: v.id.startsWith('custom') ? '自定义' : (v.id === 'deepseek-anthropic' ? 'DeepSeek-Anthropic' : v.label.split(' ')[0]), baseUrl, apiKey, models: v.models, provider: proto }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || '添加失败');
      setApiKey(''); load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '添加失败');
    } finally { setBusy(false); }
  };

  const delVendor = async (vid: number) => {
    await fetch(`${API}/me/hl-vendors/${vid}`, { method: 'DELETE', headers: authHeaders() }).catch(() => {});
    load();
  };
  const saveModels = async (v: HlVendor, models: string[]) => {
    await fetch(`${API}/me/hl-vendors/${v.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ models }),
    }).catch(() => {});
    load();
  };

  return (
    <div className={compact ? '' : 'mt-3 space-y-2.5'}>
      {!compact && (
        <p className="text-[12px] leading-5 text-t3">
          AI 协作侧边栏（RQ 界面右侧）专用：一个厂商一张卡（API Key + 接口地址），卡内可配多个模型，Key 加密存储。
          配置后到 RQ 页面侧边栏底部「模型」下拉按厂商切换使用。
        </p>
      )}
      {vendors.map((v) => (
        <div key={v.id} className="rounded-xl border border-line/60 bg-card px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="rounded bg-ink px-2 py-0.5 text-[11px] font-semibold text-white">{v.label}</span>
            <span className="shrink-0 rounded border border-line px-1.5 py-0.5 font-mono text-[9.5px] text-t3">{v.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-t3" title={v.baseUrl}>{v.baseUrl}</span>
            <span className="shrink-0 font-mono text-[10px] text-t3">{v.keyMasked}</span>
            <button type="button" onClick={() => delVendor(v.id)}
              className="shrink-0 rounded p-1 text-t3 hover:bg-red-50 hover:text-red-500" title="删除厂商">
              <Trash2 size={12} />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {v.models.map((m) => (
              <span key={m} className="flex items-center gap-1 rounded-full border border-line bg-page px-2 py-0.5 font-mono text-[10.5px] text-t2">
                {m}
                <button type="button" onClick={() => saveModels(v, v.models.filter((x) => x !== m))}
                  className="text-t3 hover:text-red-500" title="移除模型"><X size={9} /></button>
              </span>
            ))}
            <form className="flex items-center gap-1" onSubmit={(e) => {
              e.preventDefault();
              const m = newModel.trim();
              if (m && !v.models.includes(m)) saveModels(v, [...v.models, m]);
              setNewModel('');
            }}>
              <input value={newModel} onChange={(e) => setNewModel(e.target.value)} placeholder="+ 模型名"
                className="w-28 rounded-full border border-dashed border-line bg-transparent px-2 py-0.5 font-mono text-[10.5px] outline-none focus:border-ink" />
            </form>
          </div>
        </div>
      ))}
      <div className="rounded-xl border border-line/60 bg-page/60 p-3">
        <div className="text-[12.5px] font-medium text-t1">添加厂商</div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="col-span-2">
            <span className="text-[11px] text-t3">厂商（自动填地址与预设模型）</span>
            <select value={vendor} onChange={(e) => pickVendor(e.target.value)}
              className="mt-0.5 w-full rounded-lg border border-line bg-white px-2 py-1.5 text-[12.5px] outline-none focus:border-ink">
              {VENDOR_PRESETS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </label>
          <label>
            <span className="text-[11px] text-t3">协议</span>
            <select value={proto} onChange={(e) => setProto(e.target.value as 'openai' | 'anthropic')}
              className="mt-0.5 w-full rounded-lg border border-line bg-white px-2 py-1.5 text-[12.5px] outline-none focus:border-ink">
              <option value="openai">OpenAI 兼容</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </label>
          <label>
            <span className="text-[11px] text-t3">接口地址</span>
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
              className="mt-0.5 w-full rounded-lg border border-line px-2 py-1.5 font-mono text-[12px] outline-none focus:border-ink" />
          </label>
          <label className="col-span-2">
            <span className="text-[11px] text-t3">API Key（加密存储）</span>
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…"
              className="mt-0.5 w-full rounded-lg border border-line px-2 py-1.5 font-mono text-[12px] outline-none focus:border-ink" />
          </label>
        </div>
        <div className="mt-1.5 text-[10.5px] text-t3">
          预设模型：{VENDOR_PRESETS.find((x) => x.id === vendor)!.models.join(' · ') || '（自定义厂商，添加后手动加模型）'}
        </div>
        {err && <div className="mt-2 text-[11.5px] text-danger">{err}</div>}
        <button type="button" onClick={addVendor} disabled={busy || !apiKey.trim() || !baseUrl.trim()}
          className="mt-2.5 w-full rounded-lg bg-ink py-1.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-85 disabled:opacity-40">
          {busy ? '添加中…' : '添加厂商'}
        </button>
      </div>
    </div>
  );
}
