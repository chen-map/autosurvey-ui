// 容错解析 LLM 输出的 JSON：剥代码围栏、剔除前后噪声；思考型模型（GLM/Qwen）
// 常因 max_tokens 被思考耗尽而把 JSON 拦腰截断——逐字符扫描后补齐未闭合的
// 字符串/数组/对象，尽量解出已完成的字段，而不是直接抛 "Unterminated string"。
export function parseJsonLoose(raw: string): Record<string, unknown> | null {
  let s = raw.replace(/```json|```/g, '').trim();
  const start = s.indexOf('{');
  if (start < 0) return null;
  s = s.slice(start);
  const end = s.lastIndexOf('}');
  if (end > 0) {
    try { return JSON.parse(s.slice(0, end + 1)); } catch { /* 截断/畸形 → 走修复 */ }
  }
  let out = '';
  const stack: string[] = [];
  let inStr = false, esc = false;
  for (const ch of s) {
    out += ch;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  if (inStr) out += '"';
  out = out.replace(/,\s*$/, '').replace(/:\s*$/, ''); // 悬挂的逗号/键名
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === '{' ? '}' : ']';
  try { return JSON.parse(out); } catch { return null; }
}
