import { cn } from '@/lib/utils';

export function Card({ className, ...props }) {
  return <div className={cn('rounded-xl border border-slate-200 bg-white shadow-sm', className)} {...props} />;
}
export function CardTitle({ className, ...props }) {
  return <h2 className={cn('text-base font-semibold text-slate-900', className)} {...props} />;
}
