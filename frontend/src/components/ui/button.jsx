import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-150 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-0 ' +
  'disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none',
  {
    variants: {
      variant: {
        // neon gradient with a glow that intensifies on hover
        default: 'bg-gradient-to-r from-primary to-accent2 font-semibold text-contrast shadow-[var(--glow-primary)] hover:brightness-110 hover:shadow-[var(--glow-strong)] active:brightness-95',
        // glass with a glowing border on hover
        secondary: 'border border-line bg-[var(--bg-glass)] text-fg backdrop-blur hover:border-primary/60 hover:text-primary hover:shadow-[var(--glow-primary)] active:bg-primary/10',
        danger: 'border border-err/50 bg-err/5 text-err hover:border-err hover:bg-err/15 hover:shadow-[0_0_18px_-2px_color-mix(in_oklab,var(--err)_55%,transparent)] active:bg-err/20',
        ghost: 'text-muted hover:bg-primary/10 hover:text-primary',
      },
      size: { default: 'h-9 px-4', sm: 'h-8 px-3 text-[13px]', lg: 'h-11 px-6 text-[15px]' },
    },
    defaultVariants: { variant: 'secondary', size: 'default' },
  }
);

// Plain <button>: `type` is passed through untouched (inside a form it still submits unless type="button" is given).
export function Button({ className, variant, size, ...props }) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
