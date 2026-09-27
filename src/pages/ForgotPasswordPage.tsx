import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { forgotPassword } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export function ForgotPasswordPage() {
  const [username, setUsername] = useState('');
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!username.trim()) {
      setError('请输入用户名');
      return;
    }
    setLoading(true);
    const r = await forgotPassword(username.trim());
    setLoading(false);
    if (r.ok) {
      setMessage(r.message ?? '重置链接已发送');
      setSent(true);
    } else {
      setError(r.message ?? '提交失败');
    }
  };

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-page">
      <div className="relative w-[400px] rounded-2xl border border-line/60 bg-card p-9 shadow-s3">
        <div className="text-center">
          <div className="text-[22px] font-bold tracking-tight">找回密码</div>
          <div className="mt-1 text-[13px] text-t3">输入用户名，重置链接将发送到绑定邮箱</div>
        </div>

        {sent ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-lg bg-info px-3 py-2 text-[13px] leading-5 text-info-fg">
              {message}
              <br />
              本地开发环境：链接打印在后端日志（server.log）中，搜索「密码重置邮件」。
            </div>
            <Link to="/login">
              <Button variant="ghost" className="w-full">返回登录</Button>
            </Link>
          </div>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={onSubmit} noValidate>
            <div>
              <label htmlFor="fp-username" className="mb-1.5 block text-[13px] text-t2">
                用户名 <span className="text-danger">*</span>
              </label>
              <Input
                id="fp-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="注册时的用户名"
                hasError={!!error}
              />
              {error && <p className="mt-1.5 text-[12px] text-danger">{error}</p>}
            </div>
            <Button type="submit" size="lg" className="w-full" disabled={loading}>
              {loading ? '提交中…' : '发送重置链接'}
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
