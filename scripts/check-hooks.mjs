#!/usr/bin/env node
/**
 * 构建前检查：React 组件内 hooks 不得出现在"提前 return"之后。
 *
 * 背景：已两次因 useState 写在 `if (!data) return` 之后触发 React #310
 * （渲染时 hooks 数量变化 → 整页渲染异常）。没有 ESLint，用保守的行扫描兜底：
 * 只看组件函数体顶层的 hooks（2 空格缩进）与顶层 early return。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = process.argv[2] || 'src';
const HOOK_RE = /^\s{2}(?:const\s+\[[^\]]+\]\s*=\s*)?use(State|Effect|Ref|Memo|Callback|Query|QueryClient|Reducer|LayoutEffect)\b/;
const COMPONENT_RE = /^(?:export\s+)?function\s+([A-Z]\w*)\s*\(/;
const EARLY_RETURN_RE = /^\s{2}if\s*\([^)]*\)\s*(?:return|\{)/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (['.tsx', '.ts'].includes(extname(name))) out.push(p);
  }
  return out;
}

let problems = 0;
for (const file of walk(ROOT)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(COMPONENT_RE);
    if (!m) continue;
    // 找函数体结束：下一个顶层 "}"（缩进 0）
    let end = i + 1;
    let depth = 0;
    for (let k = i; k < lines.length; k++) {
      for (const ch of lines[k]) {
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
      }
      if (k > i && depth <= 0) { end = k; break; }
    }
    let sawEarlyReturn = false;
    for (let k = i + 1; k < end; k++) {
      const ln = lines[k];
      if (EARLY_RETURN_RE.test(ln)) sawEarlyReturn = true;
      if (sawEarlyReturn && HOOK_RE.test(ln)) {
        problems++;
        console.error(`✖ ${file}:${k + 1} 组件 ${m[1]} 的 hooks 在提前 return 之后：`);
        console.error(`    ${ln.trim().slice(0, 90)}`);
        console.error('    → 移到组件顶部（所有 return 之前），否则会触发 React #310');
      }
    }
  }
}

if (problems > 0) {
  console.error(`\n共 ${problems} 处 hooks 顺序问题——构建已中止（修复后再构建）`);
  process.exit(1);
}
console.log('✓ hooks 顺序检查通过');
