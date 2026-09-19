import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from './button';

export function PageHeader({ title, description, children }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

export const Section = ({ title, className, children }) => (
  <section className={cn('mt-8', className)}>
    {title && <h2 className="mb-3 text-base font-semibold text-slate-900">{title}</h2>}
    {children}
  </section>
);

export const Loading = () => <p className="py-10 text-center text-sm text-slate-500">Loading…</p>;

// Value first in the DOM (as before), label shown above it. `to` makes the whole card a link.
export function StatCard({ value, label, testId, to, tone = 'default', ...props }) {
  const color = { default: 'text-slate-900', warning: 'text-amber-600', danger: 'text-red-600' }[tone];
  const body = (
    <>
      <b className={cn('text-2xl font-semibold tabular-nums tracking-tight', color)} data-testid={testId}>{value}</b>
      <span className="text-sm text-slate-500">{label}</span>
    </>
  );
  const cls = 'flex flex-col-reverse gap-1 rounded-xl border border-slate-200 bg-white p-5 shadow-sm';
  return to
    ? <Link to={to} className={cn(cls, 'transition-colors hover:border-primary/40 hover:bg-primary/5')} {...props}>{body}</Link>
    : <div className={cls} {...props}>{body}</div>;
}
export const StatGrid = ({ className, ...props }) => <div className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-4', className)} {...props} />;

// "Prev  Page x of y (n total)  Next"
export function Pager({ page, totalPages, total, onPage }) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between gap-3">
      <Button size="sm" onClick={() => onPage(page - 1)} disabled={page <= 1}>Prev</Button>
      <span className="text-sm text-slate-600" data-testid="page-info">Page {page} of {totalPages} ({total} total)</span>
      <Button size="sm" onClick={() => onPage(page + 1)} disabled={page >= totalPages}>Next</Button>
    </div>
  );
}
