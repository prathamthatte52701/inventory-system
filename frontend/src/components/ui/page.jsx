import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from './button';

export function PageHeader({ title, description, children }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight text-fg">
          <span className="h-6 w-1 rounded-full bg-gradient-to-b from-primary to-accent2 shadow-[var(--glow-primary)]" aria-hidden="true" />
          {title}
        </h1>
        {description && <p className="mt-1.5 pl-4 text-sm text-muted">{description}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

export const Loading = () => <p className="tech-label py-10 text-center text-xs text-muted">Loading…</p>;

// Value first in the DOM (as before), label shown above it. `to` makes the whole card a link.
// Stat tiles are glass cards with a glowing number (they hold a single figure, not dense data).
export function StatCard({ value, label, testId, to, tone = 'default', ...props }) {
  const color = { default: 'text-primary', warning: 'text-warn', danger: 'text-err' }[tone];
  const glow = { default: 'var(--accent-primary)', warning: 'var(--warn)', danger: 'var(--err)' }[tone];
  const body = (
    <>
      <b className={cn('text-3xl font-semibold tabular-nums tracking-tight', color)} style={{ textShadow: `0 0 18px color-mix(in oklab, ${glow} 55%, transparent)` }} data-testid={testId}>{value}</b>
      <span className="tech-label text-[11px] text-muted">{label}</span>
    </>
  );
  const cls = 'glass neon-border flex flex-col-reverse gap-2 rounded-xl p-5 shadow-[var(--glow-soft)]';
  return to
    ? <Link to={to} className={cn(cls, 'transition-shadow hover:shadow-[var(--glow-primary)]')} {...props}>{body}</Link>
    : <div className={cls} {...props}>{body}</div>;
}
export const StatGrid = ({ className, ...props }) => <div className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-4', className)} {...props} />;

// "Prev  Page x of y (n total)  Next"
export function Pager({ page, totalPages, total, onPage }) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between gap-3">
      <Button size="sm" onClick={() => onPage(page - 1)} disabled={page <= 1}>Prev</Button>
      <span className="tech-label text-xs text-muted" data-testid="page-info">Page {page} of {totalPages} ({total} total)</span>
      <Button size="sm" onClick={() => onPage(page + 1)} disabled={page >= totalPages}>Next</Button>
    </div>
  );
}
