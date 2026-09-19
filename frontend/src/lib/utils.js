import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// shadcn-style class merger: later classes win over earlier conflicting ones
export const cn = (...inputs) => twMerge(clsx(inputs));
