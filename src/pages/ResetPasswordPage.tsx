import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { resetPassword } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!token) {
      setError('链接缺少令牌，请从邮件里的完整链接进入');
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
    setLoading(true);
    const r = await resetPassword(token, password);
    setLoading(false);
    if (r.ok) {
      setDone(true);
      setTimeout(() => navigate('/login'), 1800);
    } else {
      setError(r.message ?? '重置失败');
    }
  };

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-page">
      <div className="relative w-[400px] rounded-2xl border border-line/60 bg-card p-9 shadow-s3">
        <div className="text-center">
          <div className="text-[22px] font-bold tracking-tight">设置新密码</div>
          <div className="mt-1 text-[13px] text-t3">重置成功后原登录会话将全部失效</div>
        </div>

        {done ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-lg bg-info px-3 py-2 text-[13px] leading-5 text-info-fg">
              密码已重置，正在跳转登录页…
            </div>
            <Link to="/login">
              <Button variant="ghost" className="w-full">前往登录</Button>
            </Link>
          </div>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={onSubmit} noValidate>
            <div>
              <label htmlFor="rp-password" className="mb-1.5 block text-[13px] text-t2">
                新密码 <span className="text-danger">*</span>
              </label>
              <Input
                id="rp-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 6 位"
                autoComplete="new-password"
                hasError={!!error}
              />
            </div>
            <div>
              <label htmlFor="rp-confirm" className="mb-1.5 block text-[13px] text-t2">
                确认新密码 <span className="text-danger">*</span>
              </label>
              <Input
                id="rp-confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="再输入一次"
                autoComplete="new-password"
                hasError={!!error}
              />
              {error && <p className="mt-1.5 text-[12px] text-danger">{error}</p>}
            </div>
            <Button type="submit" size="lg" className="w-full" disabled={loading}>
              {loading ? '提交中…' : '重置密码'}
            </Button>
            <Link to="/login" className="block text-center text-[13px] text-t3 hover:text-t2">
              返回登录
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
