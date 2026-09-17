// 个人 API Key 库（localStorage）——向导/个人中心共享读写
const LS_APIKEYS = 'as.apikeys';

export function readApiKeys(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(LS_APIKEYS) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export function saveApiKey(platform: string, key: string) {
  const all = readApiKeys();
  if (key.trim()) all[platform] = key.trim();
  else delete all[platform];
  localStorage.setItem(LS_APIKEYS, JSON.stringify(all));
  return all;
}
