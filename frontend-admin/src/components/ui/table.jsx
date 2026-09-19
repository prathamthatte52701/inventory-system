import { cn } from '@/lib/utils';

// Scroll container: the header row stays pinned while the body scrolls; wide tables scroll sideways.
export function TableWrap({ className, children }) {
  return <div className={cn('max-h-[70vh] overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm', className)}>{children}</div>;
}
export function Table({ className, ...props }) {
  return <table className={cn('w-full min-w-max border-collapse text-sm', className)} {...props} />;
}
export function Th({ num, className, ...props }) {
  return (
    <th
      className={cn('sticky top-0 z-10 whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500', num && 'text-right', className)}
      {...props}
    />
  );
}
export function Tr({ className, ...props }) {
  return <tr className={cn('even:bg-slate-50/60 hover:bg-primary/5 [&:last-child>td]:border-b-0', className)} {...props} />;
}
export function Td({ num, className, ...props }) {
  return <td className={cn('border-b border-slate-100 px-3 py-2.5 align-middle text-slate-800', num && 'text-right tabular-nums', className)} {...props} />;
}
// the "nothing here" row
export function EmptyRow({ cols, children }) {
  return <tr><td colSpan={cols} className="px-4 py-10 text-center text-sm text-slate-500">{children}</td></tr>;
}
