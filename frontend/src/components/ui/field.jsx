import { cn } from '@/lib/utils';

const control =
  'w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm transition-colors ' +
  'placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 ' +
  'disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500';

export function Input({ className, ...props }) {
  return <input className={cn(control, 'h-9', className)} {...props} />;
}

export function Select({ className, ...props }) {
  return <select className={cn(control, 'h-9 pr-8', className)} {...props} />;
}

// A <label> that WRAPS its control (text first, control inside), exactly like the markup it replaces,
// so the control's accessible name is still the label text.
export function Field({ label, className, children }) {
  return (
    <label className={cn('grid gap-1.5 text-sm font-medium text-slate-700', className)}>
      {label}
      {children}
    </label>
  );
}
