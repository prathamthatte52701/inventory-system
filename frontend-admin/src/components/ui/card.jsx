import { cn } from '@/lib/utils';

// Glass panel with a thin glowing gradient border.
export function Card({ className, ...props }) {
  return <div className={cn('glass neon-border rounded-xl shadow-[var(--glow-soft)]', className)} {...props} />;
}
export function CardTitle({ className, ...props }) {
  return <h2 className={cn('text-base font-semibold tracking-tight text-fg', className)} {...props} />;
}
