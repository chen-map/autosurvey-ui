import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LayoutGrid, Settings, Plus, LogOut, Database, Library, Compass, User } from 'lucide-react';
import { useAuth } from '@/store/auth';
import { useUi } from '@/store/ui';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/projects', label: '全部项目', icon: LayoutGrid },
  { to: '/library', label: '知识库', icon: Library },
  { to: '/direction', label: '研究方向', icon: Compass },
  { to: '/me', label: '个人中心', icon: User },
  { to: '/admin', label: '管理后台', icon: Settings },
];

export function AppShell() {
  const { user, logout } = useAuth();
  const { readOnly, toggleReadOnly } = useUi();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen">
      {/* 左侧栏（xept projects 页范式：黑 wordmark + 实底黑主按钮 + 分组导航） */}
      <aside className="fixed inset-y-0 left-0 flex w-60 flex-col border-r border-line/70 bg-card">
        <div className="px-5 pt-6">
          <div className="text-[19px] font-bold leading-6 tracking-tight">AutoSurvey</div>
          <div className="mt-0.5 text-xs text-t3">综述流水线控制台</div>
          <Badge variant="warn" withDot className="mt-3">
            DEMO DATA
          </Badge>
        </div>

        {!readOnly && (
          <div className="px-4 pt-5">
            <Button className="w-full" onClick={() => navigate('/projects/new')}>
              <Plus size={16} strokeWidth={2.5} />
              新建综述项目
            </Button>
          </div>
        )}

        <nav className="mt-6 flex flex-col gap-0.5 px-3">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[14px] text-t2 transition-colors hover:bg-black/5',
                  isActive && 'bg-black/5 font-medium text-t1',
                )
              }
            >
              <item.icon size={16} className="text-t2" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex-1" />

        <div className="space-y-3 border-t border-line/70 px-4 py-4">
          <label className="flex cursor-pointer items-center justify-between text-[13px] text-t2">
            演示模式（只读）
            <input
              type="checkbox"
              checked={readOnly}
              onChange={toggleReadOnly}
              className="h-4 w-4 accent-black"
            />
          </label>
          <div className="flex items-center gap-1.5 text-[12px] text-t3">
            <Database size={13} />
            后端：mock（契约未接入）
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-ink text-[11px] font-semibold text-white">
                {(user ?? '?').slice(0, 2).toUpperCase()}
              </span>
              <span className="text-[13px] text-t1">{user}</span>
            </div>
            <button
              type="button"
              title="退出登录"
              className="rounded-md p-1.5 text-t3 transition-colors hover:bg-black/5 hover:text-t1"
              onClick={() => {
                logout();
                navigate('/login');
              }}
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* 主内容区 */}
      <main className="ml-60 min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
