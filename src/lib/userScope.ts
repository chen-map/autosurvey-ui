// 用户隔离的 localStorage 键：同一浏览器多账号切换不再串数据。
// 之前 as.library-items / as.directions 等键全局共用——A 登录留下的本地数据会被
// B 看到，且 B 的首次改动会把 A 的数据推进 B 的后端 KV，造成"知识库/研究方向互通"。
export function ukey(base: string): string {
  const u = localStorage.getItem('as.user') ?? '';
  return u ? `${base}::${u}` : base;
}

// 一次性迁移：把隔离改造前存放在全局键下的本地数据，拷贝到当前用户的作用域键下。
// （只拷贝、不删除旧键；若作用域键已存在则不覆盖，后端拉取仍是权威数据源）
const LEGACY_BASES = [
  'as.directions',
  'as.active-direction',
  'as.custom-fields',
  'as.last-fields',
  'as.library-items',
  'as.library-collections',
  'as.apikeys',
  'as.llm',
];

export function migrateLegacyKeys(): void {
  const u = localStorage.getItem('as.user');
  if (!u) return;
  const flag = `as.legacy-migrated::${u}`;
  if (localStorage.getItem(flag)) return;
  for (const base of LEGACY_BASES) {
    const scoped = `${base}::${u}`;
    if (localStorage.getItem(scoped) === null) {
      const legacy = localStorage.getItem(base);
      if (legacy !== null) localStorage.setItem(scoped, legacy);
    }
  }
  localStorage.setItem(flag, '1');
}

migrateLegacyKeys();
