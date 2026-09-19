import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 ' +
  'disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-white shadow-sm hover:bg-primary/90 active:bg-primary/80',
        secondary: 'border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50 active:bg-slate-100',
        danger: 'border border-red-300 bg-white text-red-700 shadow-sm hover:bg-red-50 active:bg-red-100',
        ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
      },
      size: { default: 'h-9 px-4', sm: 'h-8 px-3 text-[13px]', lg: 'h-10 px-5' },
    },
    defaultVariants: { variant: 'secondary', size: 'default' },
  }
);

// Plain <button>: `type` is passed through untouched (inside a form it still submits unless type="button" is given).
export function Button({ className, variant, size, ...props }) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
