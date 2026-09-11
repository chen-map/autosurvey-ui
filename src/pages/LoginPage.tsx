import { useState, type FormEvent } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '@/store/auth';
import { login as apiLogin } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('demo');
  const [password, setPassword] = useState('123456');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/projects" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password.trim()) {
      setError('请输入账号与密码');
      return;
    }
    setLoading(true);
    const res = await apiLogin(username, password);
    setLoading(false);
    if (res.ok) {
      login(username);
      navigate('/projects');
    } else {
      setError(res.message ?? '登录失败');
    }
  };

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-page">
      {/* 单色装饰层（无彩色装饰，反幼稚审计第 2 项） */}
      <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-black/5 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-24 h-[28rem] w-[28rem] rounded-full bg-black/5 blur-3xl" />

      <div className="relative w-[400px] rounded-2xl border border-line/60 bg-card p-9 shadow-s3">
        <div className="text-center">
          <div className="text-[26px] font-bold tracking-tight">AutoSurvey</div>
          <div className="mt-1 text-[13px] text-t3">AI 驱动的学术综述流水线控制台</div>
        </div>

        <div className="mt-6 rounded-lg bg-info px-3 py-2 text-[13px] leading-5 text-info-fg">
          演示环境：账号 demo / 123456，已预填，直接登录即可。
        </div>

        <form className="mt-5 space-y-4" onSubmit={onSubmit} noValidate>
          <div>
            <label htmlFor="username" className="mb-1.5 block text-[13px] text-t2">
              账号 <span className="text-danger">*</span>
            </label>
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="用户名"
              autoComplete="username"
              hasError={!!error}
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1.5 block text-[13px] text-t2">
              密码 <span className="text-danger">*</span>
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="密码"
              autoComplete="current-password"
              hasError={!!error}
            />
            {/* 错误内联在控件正下方（design-db 表单范式，禁 alert） */}
            {error && <p className="mt-1.5 text-[12px] text-danger">{error}</p>}
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading ? '登录中…' : '登录'}
          </Button>
        </form>
      </div>
    </div>
  );
}
