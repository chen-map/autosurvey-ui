import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

const TITLES: Record<string, string> = {
  '/projects/new': '创建向导',
  '/admin': '管理后台',
};

// 里程碑占位页：模块按 docs/requirements.md 里程碑计划交付
export function PlaceholderPage() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const title = TITLES[pathname] ?? '页面';

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <h1 className="text-[24px] font-semibold leading-8">{title}</h1>
      <Card className="mt-6 flex flex-col items-center gap-3 px-8 py-16 text-center">
        <p className="text-[14px] text-t2">该模块按里程碑计划后续交付</p>
        <p className="max-w-md text-[13px] leading-5 text-t3">
          需求与设计已锁定于 docs/requirements.md 与 docs/ui-design.md，当前处于里程碑排期中。
        </p>
        <Button variant="secondary" size="sm" className="mt-2" onClick={() => navigate('/projects')}>
          <ArrowLeft size={14} />
          返回项目列表
        </Button>
      </Card>
    </div>
  );
}
