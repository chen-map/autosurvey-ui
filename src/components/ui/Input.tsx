import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  hasError?: boolean;
}

// 输入框：底 #f5f5f5、圆角 8、focus 黑边（xept 实拍范式；错误内联在控件下方，见页面层）
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, hasError, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-10 w-full rounded-lg border bg-page px-3 text-[14px] text-t1 placeholder:text-t3',
        'focus:outline-none focus:border-ink focus:bg-card',
        hasError ? 'border-danger' : 'border-line',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
