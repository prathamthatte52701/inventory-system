import { cn } from '@/lib/utils';

// READABILITY RULE for every data table: the neon language lives in the chrome only (header, border, hover tint).
// Body text is always the solid --text-primary on the near-solid --bg-elevated: no glowing or coloured data text.

// Scroll container: the header row stays pinned while the body scrolls; wide tables scroll sideways.
export function TableWrap({ className, children }) {
  return <div className={cn('max-h-[70vh] overflow-auto rounded-xl border border-line bg-elevated shadow-[var(--glow-soft)]', className)}>{children}</div>;
}
export function Table({ className, ...props }) {
  return <table className={cn('w-full min-w-max border-collapse text-sm', className)} {...props} />;
}
export function Th({ num, className, ...props }) {
  return (
    <th
      className={cn(
        'sticky top-0 z-10 whitespace-nowrap border-b border-primary/45 bg-elevated px-3 py-3 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-primary',
        'shadow-[0_6px_14px_-10px_var(--accent-primary)]',
        num && 'text-right',
        className
      )}
      {...props}
    />
  );
}
export function Tr({ className, ...props }) {
  return <tr className={cn('bg-elevated even:bg-[var(--row-alt)] transition-colors hover:bg-[var(--row-hover)] [&:last-child>td]:border-b-0', className)} {...props} />;
}
export function Td({ num, className, ...props }) {
  return <td className={cn('border-b border-line px-3 py-2.5 align-middle text-fg', num && 'text-right tabular-nums', className)} {...props} />;
}
// the "nothing here" row
export function EmptyRow({ cols, children }) {
  return <tr><td colSpan={cols} className="px-4 py-10 text-center text-sm text-muted">{children}</td></tr>;
}
