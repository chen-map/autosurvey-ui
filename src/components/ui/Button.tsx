import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

const variants = {
  // 实底黑主按钮（xept 内页实拍范式；一屏一个 primary）
  primary: 'bg-ink text-white hover:bg-black/80 disabled:bg-black/25',
  // 白底 2px 黑边（xept 次按钮范式）
  secondary: 'bg-card text-ink border-2 border-ink hover:bg-black/5 disabled:opacity-40',
  ghost: 'text-t1 hover:bg-black/5 disabled:opacity-40',
};

const sizes = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-10 px-4 text-[14px]',
  lg: 'h-11 px-5 text-[15px]',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-btn font-medium transition-colors disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = 'Button';
