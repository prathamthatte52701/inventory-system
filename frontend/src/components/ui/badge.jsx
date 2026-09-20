import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset', {
  variants: {
    tone: {
      slate: 'bg-fg/5 text-muted ring-line',
      green: 'bg-ok/12 text-ok ring-ok/40',
      amber: 'bg-warn/12 text-warn ring-warn/40',
      red: 'bg-err/12 text-err ring-err/40',
      blue: 'bg-info/12 text-info ring-info/40',
      primary: 'bg-primary/12 text-primary ring-primary/40',
    },
  },
  defaultVariants: { tone: 'slate' },
});
const DOT = { slate: 'bg-muted', green: 'bg-ok', amber: 'bg-warn', red: 'bg-err', blue: 'bg-info', primary: 'bg-primary' };

export function Badge({ tone, dot = false, className, children, ...props }) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full shadow-[0_0_6px_currentColor]', DOT[tone || 'slate'])} aria-hidden="true" />}
      {children}
    </span>
  );
}

const STOCK = { AVAILABLE: ['green', 'Available'], LOW_STOCK: ['amber', 'Low Stock'], OUT_OF_STOCK: ['red', 'Out of Stock'] };
export function StatusBadge({ status }) {
  const [tone, label] = STOCK[status] || ['slate', status];
  return <Badge tone={tone} dot>{label}</Badge>;
}
