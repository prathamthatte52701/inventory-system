import { cn } from '@/lib/utils';

const control =
  'w-full rounded-md border border-line bg-[var(--field-bg)] px-3 text-sm text-fg transition-[border-color,box-shadow] duration-150 ' +
  'placeholder:text-muted/70 focus:border-primary focus:outline-none focus:shadow-[var(--glow-primary)] ' +
  'disabled:cursor-not-allowed disabled:opacity-55';

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
    <label className={cn('grid gap-1.5 text-[13px] font-medium tracking-wide text-muted', className)}>
      {label}
      {children}
    </label>
  );
}
