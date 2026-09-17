import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, Library, Compass, Eye, EyeOff, Check, ArrowUpRight } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/store/auth';

// 个人中心（B15 前端版）：个人信息 + 付费平台 API Key 存储
// Key 仅存本浏览器 localStorage；生产环境由后端加密存储、接口只回掩码（backend-todo.md §6）
const LS_APIKEYS = 'as.apikeys';
const PAID_PLATFORMS = ['IEEE', 'ACM', 'Springer', 'Elsevier'];

function readKeys(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LS_APIKEYS) ?? '{}');
  } catch {
    return {};
  }
}

export function ProfilePage() {
  const { user } = useAuth();
  const [keys, setKeys] = useState<Record<string, string>>(readKeys);
  const [show, setShow] = useState<Record<string, boolean>>({});
  const [savedTip, setSavedTip] = useState('');

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
    const next = { ...keys, [platform]: value };
    setKeys(next);
    localStorage.setItem(LS_APIKEYS, JSON.stringify(next));
    setSavedTip(platform);
    setTimeout(() => setSavedTip(''), 1500);
  };

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
            <Badge variant="info">管理员</Badge>
          </div>
          <div className="mt-0.5 text-[12px] text-t3">昵称、头像编辑将在后端账号体系接入后开放</div>
        </div>
      </Card>

      {/* API 密钥存储 */}
      <Card className="p-5">
        <div className="flex items-center gap-2 text-[14px] font-medium">
          <KeyRound size={15} className="text-t3" />
          API 密钥存储
          <Badge variant="warn">仅存本浏览器</Badge>
        </div>
        <p className="mt-1.5 text-[12.5px] leading-5 text-t3">
          订阅制论文平台需要机构/API Key 才会真实返回数据。Key 只保存在你的浏览器中；
          后端接入后改为服务端加密存储，接口只回传掩码（见 backend-todo.md §6）。
        </p>
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
