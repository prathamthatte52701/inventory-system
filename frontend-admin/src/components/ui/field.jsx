import { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
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

// Password input with a show/hide eye. The label uses htmlFor (not wrapping) so the eye button is NOT part of the
// label text: the input's accessible name stays exactly the label, e.g. "Password".
export function PasswordField({ label, className, error, ...props }) {
  const id = useId();
  const [show, setShow] = useState(false);
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium tracking-wide text-muted">{label}</label>
      <div className="relative">
        <input id={id} type={show ? 'text' : 'password'} className={cn(control, 'h-9 pr-10', error && 'border-err/70', className)} {...props} />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? 'Hide password' : 'Show password'}
          aria-pressed={show}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          {show ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}
