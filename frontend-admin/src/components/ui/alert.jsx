import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const alertVariants = cva('flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm', {
  variants: {
    variant: {
      error: 'border-red-200 bg-red-50 text-red-800',
      warning: 'border-amber-200 bg-amber-50 text-amber-900',
      success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
      info: 'border-sky-200 bg-sky-50 text-sky-800',
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
