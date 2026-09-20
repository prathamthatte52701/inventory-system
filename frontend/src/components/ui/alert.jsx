import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// Body text stays --text-primary for readability; the tone shows in the border, tint and icon.
const alertVariants = cva('flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm text-fg', {
  variants: {
    variant: {
      error: 'border-err/45 bg-err/10 [&>svg]:text-err shadow-[0_0_20px_-10px_var(--err)]',
      warning: 'border-warn/45 bg-warn/10 [&>svg]:text-warn shadow-[0_0_20px_-10px_var(--warn)]',
      success: 'border-ok/45 bg-ok/10 [&>svg]:text-ok shadow-[0_0_20px_-10px_var(--ok)]',
      info: 'border-info/45 bg-info/10 [&>svg]:text-info shadow-[0_0_20px_-10px_var(--info)]',
    },
  },
  defaultVariants: { variant: 'info' },
});
const ICONS = { error: AlertCircle, warning: AlertTriangle, success: CheckCircle2, info: Info };

// `role` (alert / status) is passed through exactly as the old <div className="error"> etc. had it.
export function Alert({ variant = 'info', className, children, ...props }) {
  const Icon = ICONS[variant];
  return (
    <div className={cn(alertVariants({ variant }), className)} {...props}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
