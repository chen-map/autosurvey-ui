import { useState, type FormEvent } from 'react';
import { Link, useNavigate, Navigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { useAuth } from '@/store/auth';
import { login as apiLogin, register as apiRegister, USE_MOCK } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

type Mode = 'login' | 'register';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [flash] = useState(() => {
    try {
      const v = sessionStorage.getItem('as.flash') ?? '';
      if (v) sessionStorage.removeItem('as.flash');
      return v;
    } catch { return ''; }
  });

  if (user) return <Navigate to="/projects" replace />;

  const switchMode = (m: Mode) => {
    setMode(m);
    setError('');
    if (m === 'register') {
      // 注册模式清空预填的演示账号，避免误注册成 demo 变体
      setUsername('');
      setPassword('');
      setConfirm('');
      setEmail('');
    } else {
      setUsername('');
      setPassword('');
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
      if (!EMAIL_RE.test(email.trim())) {
        setError('请输入有效的邮箱地址（用于找回密码）');
        return;
      }
    }
    setLoading(true);
    const res =
      mode === 'login'
        ? await apiLogin(username, password)
        : await apiRegister(username.trim(), password, email.trim());
    setLoading(false);
    if (res.ok) {
      login(username.trim(), res.role);
      navigate('/projects');
    } else {
      setError(res.message ?? (mode === 'login' ? '登录失败' : '注册失败'));
    }
  };

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-page">
      {/* 品牌色装饰层 */}
      <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-brand/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-24 h-[28rem] w-[28rem] rounded-full bg-brand/10 blur-3xl" />

      <div className="relative w-[400px] rounded-2xl border border-line/60 bg-card p-9 shadow-s3">
        <div className="flex flex-col items-center text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand text-white shadow-s2">
            <Sparkles size={24} strokeWidth={2.2} />
          </span>
          <div className="mt-3 text-[24px] font-bold tracking-tight">AutoSurvey</div>
          <div className="mt-1 text-[13px] text-t3">AI 驱动的学术综述流水线控制台</div>
          <div className="mt-3 flex items-center gap-1 text-[11px] text-t3">
            {['语料', '知识图谱', '研究问题', '逐段写作'].map((s, i) => (
              <span key={s} className="flex items-center gap-1">
                {i > 0 && <span className="text-t3/60">→</span>}
                <span className="rounded bg-page px-1.5 py-0.5">{s}</span>
              </span>
            ))}
          </div>
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

        {mode === 'register' && (
          <div className="mt-4 rounded-lg bg-info px-3 py-2 text-[13px] leading-5 text-info-fg">
            注册后自动开通你的独立数据分区：项目、语料、密钥、知识库全部按账号隔离。邮箱用于找回密码。
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
          {mode === 'register' && (
            <div>
              <label htmlFor="email" className="mb-1.5 block text-[13px] text-t2">
                邮箱 <span className="text-danger">*</span>
              </label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="用于找回密码"
                autoComplete="email"
                hasError={!!error}
              />
            </div>
          )}
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
          {flash && !error && (
            <p className="rounded-lg border border-[#f0e2c8] bg-[#fdf8ee] px-3 py-2 text-[12px] leading-5 text-[#8a6a1f]">{flash}</p>
          )}
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
          {mode === 'login' && (
            <Link to="/forgot" className="block text-center text-[13px] text-t3 hover:text-t2">
              忘记密码？
            </Link>
          )}
        </form>

        {USE_MOCK && (
          <div className="mt-5 border-t border-line/60 pt-4">
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              disabled={loading}
              onClick={async () => {
                setLoading(true);
                const res = await apiLogin('demo', '123456');
                setLoading(false);
                if (res.ok) {
                  login('demo', res.role);
                  navigate('/projects');
                } else {
                  setError(res.message ?? '演示登录失败');
                }
              }}
            >
              直接进入公开数据演示
            </Button>
            <p className="mt-2 text-center text-[12px] leading-5 text-t3">
              只读快照：真实运行结果，不含账号与后端源码
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
