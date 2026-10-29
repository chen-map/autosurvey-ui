import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, Library, Compass, Eye, EyeOff, Check, ArrowUpRight, Bot } from 'lucide-react';
import { useAuth } from '@/store/auth';
import { readLlmConfig, saveLlmConfig, type LlmConfig } from '@/lib/llm';
import { syncKeysFromBackend, pushKeyToBackend } from '@/lib/apikeys';
import { USE_MOCK, getProfile, putEmail } from '@/services/api';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { HlVendorManager } from '@/components/HlVendorManager';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { ukey } from '@/lib/userScope';

// 个人中心（B15 前端版）：个人信息 + 付费平台 API Key 存储
// Key 仅存本浏览器 localStorage；生产环境由后端加密存储、接口只回掩码
const LS_APIKEYS = () => ukey('as.apikeys');
const PAID_PLATFORMS = ['IEEE', 'ACM', 'Springer', 'Elsevier', 'Agent 检索'];

interface UseCaseRow {
  id: string; label: string; stage: string;
  configured: boolean; baseUrl: string; model: string; apiKeyMasked: string;
  provider?: string;
  builtin?: string;
  thinking?: 'off' | 'on';
}

function readKeys(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LS_APIKEYS()) ?? '{}');
  } catch {
    return {};
  }
}

export function ProfilePage() {
  const { user, role } = useAuth();
  const [keys, setKeys] = useState<Record<string, string>>(readKeys);
  const [show, setShow] = useState<Record<string, boolean>>({});
  const [savedTip, setSavedTip] = useState('');
  const [keyErr, setKeyErr] = useState('');
  // 绑定邮箱（找回密码通道）
  const [email, setEmail] = useState('');
  const [emailSaved, setEmailSaved] = useState(false);
  const [emailErr, setEmailErr] = useState('');

  useEffect(() => {
    if (USE_MOCK) return;
    getProfile().then((p) => setEmail(p.email ?? '')).catch(() => {});
  }, []);

  const saveEmail = async () => {
    setEmailErr('');
    setEmailSaved(false);
    const r = await putEmail(email.trim());
    if (r.ok) {
      setEmail(r.email ?? email.trim());
      setEmailSaved(true);
      setTimeout(() => setEmailSaved(false), 2000);
    } else {
      setEmailErr(r.message ?? '保存失败');
    }
  };

  const { fields, goal }: { fields: string[]; goal: string } = useMemo(() => {
    try {
      const dirs: { id: string; fields: string[]; goal?: string }[] = JSON.parse(localStorage.getItem('as.directions') ?? '[]');
      const activeId = localStorage.getItem('as.active-direction');
      const d = dirs.find((x) => x.id === activeId) ?? dirs[0];
      if (d) return { fields: d.fields ?? [], goal: d.goal ?? '' };
    } catch {
      /* 忽略损坏数据 */
    }
    try {
      const v: string[] = JSON.parse(localStorage.getItem('as.last-fields') ?? '[]');
      return { fields: v, goal: localStorage.getItem('as.research-goal') ?? '' };
    } catch {
      return { fields: [], goal: '' };
    }
  }, []);

  const setKey = (platform: string, value: string) => {
    setKeys((k) => ({ ...k, [platform]: value }));
    setSavedTip(platform);
    setTimeout(() => setSavedTip(''), 1500);
    // 真实模式：后端加密存储，回写掩码；演示模式：仅本地
    pushKeyToBackend(platform, value)
      .then((masked) => setKeys(masked))
      .catch((e: Error) => {
        setKeyErr(e.message || '后端不可达');
        setKeys((k) => ({ ...k, [platform]: `${value.slice(0, 4)}••••（未同步）` }));
        setTimeout(() => setKeyErr(''), 4000);
      });
  };

  // 统一 LLM 执行器配置（url + apikey + model）
  const [llm, setLlmState] = useState<LlmConfig>(readLlmConfig);
  const [llmThinking, setLlmThinking] = useState<'off' | 'on'>('off');
  // 防 800ms 防抖闭包用旧 thinking 覆盖刚切换的值
  const llmThinkingRef = useRef<'off' | 'on'>('off');
  const [llmStatus, setLlmStatus] = useState('');
  // Key 是否被用户改过：必须用 ref（同步）。state 是异步的——onChange 里立即读到的永远是旧值，
  // 之前用 state 导致每次按键发出的 apiKey 都是空串，Key 永远存不上（页面显示已填、刷新即丢）
  const llmKeyEditedRef = useRef(false);
  const llmPushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setLlmField = (field: keyof LlmConfig, value: string) => {
    const next = { ...llm, [field]: value };
    setLlmState(next);
    if (field === 'apiKey') llmKeyEditedRef.current = true;
    if (USE_MOCK) { saveLlmConfig(next); return; }
    if (llmPushTimer.current) clearTimeout(llmPushTimer.current);
    llmPushTimer.current = setTimeout(() => void pushLlmConfig(next), 800); // 停止输入 800ms 后统一提交
  };

  // 真实模式：LLM 配置提交后端。apiKey 仅在用户改过 Key 时提交（避免掩码回写覆盖真值）；
  // 空 Key = 保留后端原值。保存校验：Key 不完整不发；后端 400/网络错误原样提示
  const pushLlmConfig = async (cfg: LlmConfig, thinking?: 'off' | 'on') => {
    const API = import.meta.env.VITE_API_BASE ?? '/api';
    const token = localStorage.getItem('as.token') ?? '';
    const sendKey = llmKeyEditedRef.current ? cfg.apiKey.trim() : '';
    if (sendKey && sendKey.length < 20) {
      setLlmStatus(`✗ Key 只有 ${sendKey.length} 个字符——多半没复制完整，未保存`);
      return;
    }
    try {
      const res = await fetch(`${API}/me/llm-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          baseUrl: cfg.baseUrl, model: cfg.model,
          apiKey: llmKeyEditedRef.current ? cfg.apiKey : '',
          thinking: thinking ?? llmThinkingRef.current,
        }),
      });
      if (!res.ok) {
        let msg = await res.text();
        try { msg = JSON.parse(msg).detail || msg; } catch { /* 纯文本错误原样展示 */ }
        setLlmStatus(`✗ 保存失败：${String(msg).slice(0, 80)}`);
        return;
      }
      llmKeyEditedRef.current = false;
      setLlmStatus('✓ 已保存');
      setTimeout(() => setLlmStatus(''), 2500);
    } catch {
      setLlmStatus('✗ 保存失败：网络错误');
    }
  };

  // AI 使用点细分：每个 WF 可独立配置 baseUrl / apiKey / model
  const [catalog, setCatalog] = useState<UseCaseRow[]>([]);
  const [ovr, setOvr] = useState<Record<string, { baseUrl: string; model: string; apiKey: string; provider: string; thinking: 'off' | 'on' }>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showLlmKey, setShowLlmKey] = useState<Record<string, boolean>>({});
  const [keyTip, setKeyTip] = useState<Record<string, string>>({});
  const loadCatalog = () => {
    if (USE_MOCK) return;
    const API = import.meta.env.VITE_API_BASE ?? '/api';
    const token = localStorage.getItem('as.token') ?? '';
    fetch(`${API}/me/llm-catalog`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.json())
      .then((d) => setCatalog(d.useCases ?? []))
      .catch(() => {});
  };
  // 真实模式：挂载时从后端拉掩码 Key 与 LLM 配置
  useEffect(() => {
    loadCatalog();
    if (USE_MOCK) return;
    syncKeysFromBackend().then(setKeys).catch(() => {});
    (async () => {
      const API = import.meta.env.VITE_API_BASE ?? '/api';
      const token = localStorage.getItem('as.token') ?? '';
      const res = await fetch(`${API}/me/llm-config`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) return;
      const d = await res.json();
      setLlmState({ baseUrl: d.baseUrl ?? '', model: d.model ?? '', apiKey: d.apiKeyMasked ?? '' });
      const t = d.thinking === 'on' ? 'on' : 'off';
      llmThinkingRef.current = t;
      setLlmThinking(t);
    })().catch(() => {});
  }, []);

  const masked = (v?: string) => {
    if (!v) return '未配置';
    return v.slice(0, 4) + '••••••••' + v.slice(-4);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-8 py-8">
      <h1 className="text-[24px] font-semibold leading-8">个人中心</h1>

      {/* 个人信息 */}
      <Card className="flex items-center gap-4 p-5">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-ink text-[16px] font-semibold text-white">
          {(user ?? '?').slice(0, 2).toUpperCase()}
        </span>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[17px] font-semibold">{user}</span>
            {role === "admin" && <Badge variant="info">管理员</Badge>}
          </div>
          <div className="mt-0.5 text-[12px] text-t3">昵称、头像编辑将在后端账号体系接入后开放</div>
        </div>
      </Card>

      {/* 绑定邮箱（找回密码通道） */}
      <Card className="p-5">
        <div className="flex items-center gap-2 text-[14px] font-medium">
          绑定邮箱
          <Badge variant={email ? 'ok' : 'warn'}>{email ? '已绑定' : '未绑定'}</Badge>
        </div>
        <p className="mt-1.5 text-[12.5px] leading-5 text-t3">
          忘记密码时，重置链接发送到这个邮箱。注册时填过则无需修改；老账号请在此补填。
        </p>
        {emailErr && (
          <div className="mt-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[12.5px] text-danger">{emailErr}</div>
        )}
        <div className="mt-3 flex items-center gap-2">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            className="max-w-[320px]"
          />
          <Button variant="ghost" onClick={saveEmail} disabled={USE_MOCK}>
            {emailSaved ? '已保存 ✓' : '保存'}
          </Button>
        </div>
      </Card>

      {/* API 密钥存储 */}
      <Card className="p-5">
        <div className="flex items-center gap-2 text-[14px] font-medium">
          <KeyRound size={15} className="text-t3" />
          API 密钥存储
          <Badge variant={USE_MOCK ? 'warn' : 'ok'}>{USE_MOCK ? '仅存本浏览器' : '后端加密存储'}</Badge>
        </div>
        <p className="mt-1.5 text-[12.5px] leading-5 text-t3">
          订阅制论文平台需要机构/API Key 才会真实返回数据。Key 只保存在你的浏览器中；
          后端接入后改为服务端加密存储，接口只回传掩码。
        </p>
        {keyErr && (
          <div className="mt-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[12.5px] text-danger">{keyErr}</div>
        )}
        <div className="mt-4 space-y-3">
          {PAID_PLATFORMS.map((p) => {
            const visible = !!show[p];
            const value = keys[p] ?? '';
            return (
              <div key={p} className="flex items-center gap-2">
                <span className="w-36 shrink-0 text-[13px] text-t2">{p}</span>
                <div className="relative flex-1">
                  <Input
                    type={visible ? 'text' : 'password'}
                    value={value}
                    onChange={(e) => setKey(p, e.target.value)}
                    placeholder="粘贴 API Key / 机构令牌"
                    autoComplete="off"
                    className="pr-9"
                  />
                  <button
                    type="button"
                    title={visible ? '隐藏' : '显示'}
                    onClick={() => setShow((s) => ({ ...s, [p]: !s[p] }))}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-t3 hover:text-t1"
                  >
                    {visible ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                {savedTip === p && <Check size={15} className="shrink-0 text-ok" />}
              </div>
            );
          })}
        </div>
        <div className="mt-3 text-[12px] text-t3">
          密钥仅用于联合检索，不会出现在日志与导出文件中。掩码示例：{masked('abcd1234efgh')}
        </div>
      </Card>

      {/* LLM 接入配置（url + apikey + model，统一执行器） */}
      <Card className="p-5">
        <div className="flex items-center gap-2 text-[14px] font-medium">
          <Bot size={15} className="text-t3" />
          LLM 接入配置
          <Badge variant={llm.baseUrl && llm.apiKey && llm.model ? 'ok' : 'warn'} withDot>
            {llm.baseUrl && llm.apiKey && llm.model ? '已配置' : '未配置——AI 功能将不可用，请在下方配置'}
          </Badge>
          {llmStatus && <span className={cn('text-[11.5px] font-normal', llmStatus.startsWith('✗') ? 'text-danger' : 'text-ok')}>{llmStatus}</span>}
        </div>
        <p className="mt-1.5 text-[12.5px] leading-5 text-t3">
          OpenAI 兼容协议：DeepSeek / Moonshot / 通义 / 本地 Ollama 均可。此为全局默认配置，未被单独配置的 AI 环节都使用它。
        </p>
        <div className="mt-3 grid gap-2.5 md:grid-cols-3">
          <div>
            <div className="text-[12px] text-t3">接口地址</div>
            <Input
              value={llm.baseUrl}
              onChange={(e) => setLlmField('baseUrl', e.target.value)}
              placeholder="https://api.deepseek.com/v1"
              autoComplete="off"
            />
          </div>
          <div>
            <div className="text-[12px] text-t3">API Key</div>
            <Input
              type="password"
              value={llm.apiKey}
              onChange={(e) => setLlmField('apiKey', e.target.value)}
              placeholder="sk-…"
              autoComplete="off"
            />
          </div>
          <div>
            <div className="text-[12px] text-t3">模型</div>
            <Input
              value={llm.model}
              onChange={(e) => setLlmField('model', e.target.value)}
              placeholder="deepseek-chat"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="mt-2.5 flex items-center gap-2">
          <span className="text-[12px] text-t3">思考模式</span>
          <select
            value={llmThinking}
            onChange={(ev) => {
              const v = ev.target.value as 'off' | 'on';
              llmThinkingRef.current = v;
              setLlmThinking(v);
              void pushLlmConfig(llm, v);
            }}
            className="h-8 rounded-lg border border-line bg-card px-2 text-[12px] text-t2 focus:border-ink focus:outline-none"
          >
            <option value="off">关闭（推荐——思考型模型开着思考会耗尽 token，导致输出为空或 JSON 截断）</option>
            <option value="on">开启（深度推理，慢且耗 token）</option>
          </select>
        </div>
        <details className="mt-1.5 text-[11.5px] leading-5 text-t3">
          <summary className="cursor-pointer select-none hover:text-t2">模型思考能力速查（哪些模型建议避开）</summary>
          <div className="mt-1.5 space-y-1.5 rounded-lg border border-line/60 bg-page/60 p-2.5">
            <p><b className="text-danger">强制思考、无法关闭（结构化 JSON 任务慎用）</b>：GLM-5.3 / GLM-5.3-FLASH / GLM-5.3-FLASHX / GLM-4.5V（实测传 disabled 报 1210，系统会自动去掉开关重试，思考照跑）；deepseek-reasoner；OpenAI o3 / o4-mini（最低只能 low）；Gemini 2.5 Pro（只能动态思考）。<b>注</b>：GLM-4.7-FlashX 虽被文档列为强制思考，实测 disabled 生效（7 秒直出），可正常使用。</p>
            <p><b>可关闭，JSON 任务建议关闭</b>：GLM-5.2 及以上（reasoning_effort: low/none，仅 5.3 支持 low）；Qwen3 开源系列（enable_thinking: false）；Kimi k2 系列（thinking.type: disabled）；豆包 doubao-seed（thinking.type: disabled）；GPT-5 系列（reasoning_effort: minimal）；Gemini 2.5 Flash / Flash-Lite（thinkingBudget: 0）。</p>
            <p><b>默认不思考</b>：deepseek-chat、qwen-plus / qwen-max（闭源版）、GLM-5 / GLM-5-Turbo / GLM-4.5（自动判断）。以上映射已由系统按接口地址自动处理。</p>
            <p><b className="text-danger">另需警惕</b>：通常弱模型（小参数/免费档）没有思考能力、强模型默认思考——不要用「思考开关」判断模型强弱；且便宜的不思考模型限流额度往往很低，流水线并发调用容易触发 429。系统已带指数退避自动重试（最多 8 次），仍频繁失败时建议错峰运行或换供应商。</p>
          </div>
        </details>
        <div className="mt-2 text-[11.5px] text-t3">
          {USE_MOCK
            ? '本地模式：配置保存在本浏览器，AI 调用由浏览器直连。'
            : '真实模式：配置加密存于本地数据库（Fernet），AI 调用经服务端代理执行，明文 Key 不回传浏览器。'}
        </div>

        {/* AI 协作侧边栏模型（厂商→模型两级） */}
        <div className="mt-5 border-t border-line/60 pt-4">
          <div className="flex items-center gap-2 text-[13.5px] font-medium">
            AI 协作侧边栏 · 模型配置
            <Badge variant="neutral">按厂商</Badge>
          </div>
          <HlVendorManager />
        </div>

        {/* AI 使用点细分矩阵 */}
        <div className="mt-5 border-t border-line/60 pt-4">
          <div className="flex items-center gap-2 text-[13.5px] font-medium">
            按 WF 独立配置模型
            <Badge variant="neutral">{catalog.filter(c => c.id !== 'default').length} 个工作流</Badge>
          </div>
          <p className="mt-1 text-[12px] leading-5 text-t3">
            每个工作流可独立配置接口地址 / API Key / 模型，未配置的自动继承全局默认。支持 OpenAI 兼容协议（DeepSeek / Moonshot / 通义 / Ollama）与 Anthropic 协议。
          </p>
          <div className="mt-3 space-y-2">
            {catalog.filter(c => c.id !== 'default').map(uc => {
              const e = ovr[uc.id] ?? { baseUrl: '', model: '', apiKey: '', provider: uc.provider || 'openai', thinking: (uc.thinking === 'on' ? 'on' : 'off') };
              const isOpen = expanded === uc.id;
              const isConfigured = uc.configured;
              return (
                <div key={uc.id} className="rounded-lg border border-line/60 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : uc.id)}
                    className={cn('flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors',
                      isOpen ? 'bg-page' : 'hover:bg-page/50')}
                  >
                    <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', isConfigured ? 'bg-ok' : 'bg-line')} />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-t1">{uc.label}</span>
                    <span className="shrink-0 font-mono text-[11px] text-t3">{isConfigured ? uc.apiKeyMasked : ''}</span>
                    <span className="shrink-0 text-[11px] text-t3">{isConfigured ? uc.model : '继承默认'}</span>
                    <span className={cn('shrink-0 text-t3 transition-transform', isOpen && 'rotate-90')}>›</span>
                  </button>
                  {isOpen && (
                    <div className="space-y-2 border-t border-line/40 bg-page/50 px-3 py-3">
                      <div className="grid gap-2 md:grid-cols-2">
                        <div className="md:col-span-2">
                          <div className="mb-1 text-[11px] text-t3">接口地址</div>
                          <Input value={e.baseUrl} onChange={ev => setOvr(o => ({...o, [uc.id]: {...e, baseUrl: ev.target.value}}))} placeholder="留空继承全局默认" className="text-[12px]" autoComplete="off" />
                        </div>
                        <div>
                          <div className="mb-1 flex items-center justify-between text-[11px] text-t3">
                            <span>API Key</span>
                            <span className="inline-flex items-center gap-1">
                              {uc.apiKeyMasked && <span className="font-mono">当前 {uc.apiKeyMasked}</span>}
                              <button type="button" aria-label="显示/隐藏 Key" onClick={() => setShowLlmKey(s => ({ ...s, [uc.id]: !s[uc.id] }))} className="inline-flex items-center hover:text-t2">
                                {showLlmKey[uc.id] ? <EyeOff size={12} /> : <Eye size={12} />}
                              </button>
                            </span>
                          </div>
                          <Input
                            type={showLlmKey[uc.id] ? 'text' : 'password'}
                            value={e.apiKey}
                            onChange={ev => setOvr(o => ({...o, [uc.id]: {...e, apiKey: ev.target.value}}))}
                            placeholder="留空继承默认"
                            className="text-[12px] font-mono"
                            autoComplete="off"
                          />
                          {e.apiKey.trim() && e.apiKey.trim().length < 20 && (
                            <p className="mt-1 text-[11px] text-danger">
                              只有 {e.apiKey.trim().length} 个字符——多半没复制完整（正常 Key 约 30-40 字符）
                            </p>
                          )}
                        </div>
                        <div>
                          <div className="mb-1 text-[11px] text-t3">模型</div>
                          <Input value={e.model} onChange={ev => setOvr(o => ({...o, [uc.id]: {...e, model: ev.target.value}}))} placeholder="deepseek-chat" className="text-[12px]" autoComplete="off" />
                        </div>
                        <div className="md:col-span-2">
                          <div className="mb-1 text-[11px] text-t3">协议</div>
                          <select
                            value={e.provider}
                            onChange={ev => setOvr(o => ({...o, [uc.id]: {...e, provider: ev.target.value}}))}
                            className="h-9 w-full rounded-lg border border-line bg-card px-2 text-[12px] text-t2 focus:border-ink focus:outline-none"
                          >
                            {uc.id === 'w4'
                              ? <option value="anthropic">Anthropic（/v1/messages · DeepSeek /anthropic）</option>
                              : <>
                                  <option value="openai">OpenAI 兼容（/chat/completions · DeepSeek/Moonshot/通义/Ollama）</option>
                                  <option value="anthropic">Anthropic（/v1/messages · Claude）</option>
                                </>
                            }
                          </select>
                          {uc.id !== 'w4' && (
                            <p className="mt-1 text-[11px] leading-4 text-t3">OpenAI 兼容协议适用于大多数 LLM 服务商（DeepSeek / Moonshot / 通义 / Ollama）</p>
                          )}
                        </div>
                        {uc.id === 'w4' && (
                          <div className="md:col-span-2 flex flex-wrap gap-2">
                            <button type="button"
                              onClick={() => setOvr(o => ({...o, w4: {...(o.w4 ?? e), baseUrl: 'https://api.deepseek.com/anthropic', provider: 'anthropic', model: 'deepseek-chat'}}))}
                              className="rounded border border-line bg-page px-2.5 py-1 text-[11.5px] text-t2 transition-colors hover:border-ink hover:text-t1"
                            >
                              一键填 DeepSeek（Anthropic 协议）
                            </button>
                          </div>
                        )}
                      </div>
                        <div className="md:col-span-2 flex items-center gap-2">
                          <span className="text-[11px] text-t3">思考模式</span>
                          <select
                            value={e.thinking}
                            onChange={ev => setOvr(o => ({...o, [uc.id]: {...e, thinking: ev.target.value as 'off' | 'on'}}))}
                            className="h-8 rounded-lg border border-line bg-card px-2 text-[12px] text-t2 focus:border-ink focus:outline-none"
                          >
                            <option value="off">关闭（推荐）</option>
                            <option value="on">开启</option>
                          </select>
                        </div>
                        <div className="flex items-center justify-end gap-3">
                        {keyTip[uc.id] && <span className="text-[11px] text-danger">{keyTip[uc.id]}</span>}
                        <Button size="sm" variant="secondary"
                          onClick={() => {
                            const k = e.apiKey.trim();
                            if (k && k.length < 20) {
                              setKeyTip(t => ({ ...t, [uc.id]: `Key 只有 ${k.length} 个字符，请完整粘贴` }));
                              setTimeout(() => setKeyTip(t => ({ ...t, [uc.id]: '' })), 4000);
                              return;
                            }
                            const API2 = import.meta.env.VITE_API_BASE ?? '/api';
                            const token = localStorage.getItem('as.token') ?? '';
                            fetch(API2 + '/me/llm-config', {
                              method: 'PUT',
                              headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
                              body: JSON.stringify({ useCase: uc.id, baseUrl: e.baseUrl, apiKey: e.apiKey, model: e.model, provider: e.provider, thinking: e.thinking })
                            }).then((r) => {
                              if (!r.ok) return r.text().then(t => { throw new Error(t.replace(/^"|"$/g, '')); });
                              throw null;
                            }).catch((err) => {
                              if (!err) { setSavedTip(uc.label); loadCatalog(); return; }
                              setKeyTip(t => ({ ...t, [uc.id]: err.message || '保存失败' }));
                              setTimeout(() => setKeyTip(t => ({ ...t, [uc.id]: '' })), 4000);
                            });
                          }}
                        >保存</Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* 我的研究方向摘要 */}
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <div className="text-[14px] font-medium">我的研究方向</div>
          <Link to="/direction" className="inline-flex items-center gap-1 text-[12.5px] text-info-fg hover:underline">
            去编辑 <ArrowUpRight size={12} />
          </Link>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {fields.length > 0 ? (
            fields.map((t) => <Badge key={t} variant="info">{t}</Badge>)
          ) : (
            <span className="text-[12.5px] text-t3">尚未设置领域标签</span>
          )}
        </div>
        {goal && <p className="mt-2.5 line-clamp-2 text-[13px] leading-5 text-t2">{goal}</p>}
      </Card>

      {/* 快捷入口 */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-[13.5px] font-medium">
            <Library size={15} className="text-t3" />
            知识库
          </div>
          <p className="mt-1 text-[12px] text-t3">收藏的论文与分类集合</p>
          <Link to="/library" className="mt-2 inline-flex items-center gap-1 text-[12.5px] text-info-fg hover:underline">
            打开 <ArrowUpRight size={11} />
          </Link>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-[13.5px] font-medium">
            <Compass size={15} className="text-t3" />
            研究方向
          </div>
          <p className="mt-1 text-[12px] text-t3">领域画像与 AI 方向精炼</p>
          <Link to="/direction" className="mt-2 inline-flex items-center gap-1 text-[12.5px] text-info-fg hover:underline">
            打开 <ArrowUpRight size={11} />
          </Link>
        </Card>
      </div>
    </div>
  );
}
