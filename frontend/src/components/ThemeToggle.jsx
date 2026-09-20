import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/ThemeContext';
import { cn } from '@/lib/utils';

// Sun/moon button; shows the theme you would switch TO.
export default function ThemeToggle({ className }) {
  const { theme, toggleTheme } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  const Icon = theme === 'dark' ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-full border border-line bg-[var(--bg-glass)] text-muted backdrop-blur transition',
        'hover:border-primary/60 hover:text-primary hover:shadow-[var(--glow-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
        className
      )}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}
