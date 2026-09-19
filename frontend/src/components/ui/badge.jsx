import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset', {
  variants: {
    tone: {
      slate: 'bg-slate-100 text-slate-700 ring-slate-200',
      green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
      amber: 'bg-amber-50 text-amber-800 ring-amber-200',
      red: 'bg-red-50 text-red-700 ring-red-200',
      blue: 'bg-sky-50 text-sky-700 ring-sky-200',
      primary: 'bg-primary/10 text-primary ring-primary/20',
    },
  },
  defaultVariants: { tone: 'slate' },
});
const DOT = { slate: 'bg-slate-400', green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500', blue: 'bg-sky-500', primary: 'bg-primary' };

export function Badge({ tone, dot = false, className, children, ...props }) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', DOT[tone || 'slate'])} aria-hidden="true" />}
      {children}
    </span>
  );
}

const STOCK = { AVAILABLE: ['green', 'Available'], LOW_STOCK: ['amber', 'Low Stock'], OUT_OF_STOCK: ['red', 'Out of Stock'] };
export function StatusBadge({ status }) {
  const [tone, label] = STOCK[status] || ['slate', status];
  return <Badge tone={tone} dot>{label}</Badge>;
}
