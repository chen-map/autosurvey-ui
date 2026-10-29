import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

// 标签公式（design-db）：浅底 + 同色相深字，禁饱和底白字
const variants = {
  neutral: 'bg-black/5 text-t2',
  ok: 'bg-[#f6ffed] text-[#1a7f37]',
  info: 'bg-info text-info-fg',
  warn: 'bg-warn text-warn-fg',
  danger: 'bg-[#fff2f0] text-danger',
} as const;

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: keyof typeof variants;
  withDot?: boolean;
}

export function Badge({ className, variant = 'neutral', withDot, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded px-2 py-0.5 text-[12px] leading-5 font-medium',
        variants[variant],
        className,
      )}
      {...props}
    >
      {withDot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
