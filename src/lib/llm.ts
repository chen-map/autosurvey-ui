// 统一 LLM 执行器（url + apikey + model，OpenAI 兼容协议）
// 全站 AI 功能（方向精炼 / Agent 分析）共用：真实模式走服务端代理 /api/llm/chat（Key 加密存后端）；演示模式浏览器直连
export interface LlmConfig {
  baseUrl: string; // 如 https://api.deepseek.com/v1
  apiKey: string;
  model: string; // 如 deepseek-chat
}

import { USE_MOCK } from '@/services/api';

const LS_LLM = 'as.llm';

export function readLlmConfig(): LlmConfig {
  try {
    const v = JSON.parse(localStorage.getItem(LS_LLM) ?? '{}');
    return {
      baseUrl: v.baseUrl ?? '',
      apiKey: v.apiKey ?? '',
      model: v.model ?? '',
    };
  } catch {
    return { baseUrl: '', apiKey: '', model: '' };
  }
}

export function saveLlmConfig(cfg: LlmConfig) {
  localStorage.setItem(LS_LLM, JSON.stringify(cfg));
}

export function llmConfigured(cfg: LlmConfig): boolean {
  return !!(cfg.baseUrl && cfg.apiKey && cfg.model);
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function chatCompletion(
  cfg: LlmConfig,
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number; signal?: AbortSignal } = {},
): Promise<string> {
  // 真实模式：走服务端代理（Key 加密存后端，明文永不回传浏览器）
  if (!USE_MOCK) {
    const API = import.meta.env.VITE_API_BASE ?? '/api';
    const token = localStorage.getItem('as.token') ?? '';
    const res = await fetch(`${API}/llm/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ messages, temperature: opts.temperature ?? 0.3, maxTokens: opts.maxTokens ?? 2000 }),
      signal: opts.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LLM ${res.status}: ${text.slice(0, 160)}`);
    }
    const d = await res.json();
    if (!d.content) throw new Error('LLM 返回内容为空');
    return d.content as string;
  }
  // mock/演示模式：浏览器直连（用户本地 localStorage 配置）
  const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 2000,
    }),
    signal: opts.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM 接口 ${res.status}: ${text.slice(0, 160)}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('LLM 返回内容为空');
  return content;
}
