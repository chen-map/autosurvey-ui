import { useState, type FormEvent } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '@/store/auth';
import { login as apiLogin, register as apiRegister } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

type Mode = 'login' | 'register';

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('demo');
  const [password, setPassword] = useState('123456');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/projects" replace />;

  const switchMode = (m: Mode) => {
    setMode(m);
    setError('');
    if (m === 'register') {
      // 注册模式清空预填的演示账号，避免误注册成 demo 变体
      setUsername('');
      setPassword('');
      setConfirm('');
    } else {
      setUsername('demo');
      setPassword('123456');
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password.trim()) {
      setError('请输入账号与密码');
      return;
    }
    if (mode === 'register') {
      if (username.trim().length < 2) {
        setError('用户名至少 2 个字符');
        return;
      }
      if (password.length < 6) {
        setError('密码至少 6 位');
        return;
      }
      if (password !== confirm) {
        setError('两次输入的密码不一致');
        return;
      }
    }
    setLoading(true);
    const res =
      mode === 'login'
        ? await apiLogin(username, password)
        : await apiRegister(username.trim(), password);
    setLoading(false);
    if (res.ok) {
      login(username.trim());
      navigate('/projects');
    } else {
      setError(res.message ?? (mode === 'login' ? '登录失败' : '注册失败'));
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

        {/* 登录/注册切换 */}
        <div className="mt-6 grid grid-cols-2 rounded-lg border border-line bg-page p-1">
          {(['login', 'register'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={`h-8 rounded-md text-[13px] transition-colors ${
                mode === m ? 'bg-card font-medium text-t1 shadow-s1' : 'text-t3 hover:text-t2'
              }`}
            >
              {m === 'login' ? '登录' : '注册新账号'}
            </button>
          ))}
        </div>

        {mode === 'login' && (
          <div className="mt-4 rounded-lg bg-info px-3 py-2 text-[13px] leading-5 text-info-fg">
            演示环境：账号 demo / 123456，已预填，直接登录即可。
          </div>
        )}
        {mode === 'register' && (
          <div className="mt-4 rounded-lg bg-info px-3 py-2 text-[13px] leading-5 text-info-fg">
            注册后自动开通你的独立数据分区：项目、语料、密钥、知识库全部按账号隔离。
          </div>
        )}

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
              placeholder={mode === 'register' ? '至少 6 位' : '密码'}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              hasError={!!error}
            />
          </div>
          {mode === 'register' && (
            <div>
              <label htmlFor="confirm" className="mb-1.5 block text-[13px] text-t2">
                确认密码 <span className="text-danger">*</span>
              </label>
              <Input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="再输入一次密码"
                autoComplete="new-password"
                hasError={!!error}
              />
            </div>
          )}
          {/* 错误内联在控件正下方（design-db 表单范式，禁 alert） */}
          {error && <p className="text-[12px] text-danger">{error}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading
              ? mode === 'login'
                ? '登录中…'
                : '注册中…'
              : mode === 'login'
                ? '登录'
                : '注册并进入'}
          </Button>
        </form>
      </div>
    </div>
  );
}
