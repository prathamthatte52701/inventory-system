// Copy of backend/utils/validation.js for instant feedback. The server is the real gate; keep messages identical.
export const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
export const EMAIL_MAX = 254;
export const NAME_MIN = 3, NAME_MAX = 48;
export const PASSWORD_MIN = 8, PASSWORD_MAX = 32;
export const PASSWORD_SPECIALS = '!@#$%^&*()_+-=[]{}|;:,.<>?';

export const nameProblem = (v) => {
  if (typeof v !== 'string') return 'Name must be text';
  const n = v.trim().length;
  if (n < NAME_MIN || n > NAME_MAX) return `Name must be ${NAME_MIN}-${NAME_MAX} characters`;
  return null;
};

export const emailProblem = (v) => {
  if (typeof v !== 'string') return 'Email must be text';
  const t = v.trim();
  if (t.length > EMAIL_MAX || !EMAIL_RE.test(t)) return 'Enter a valid email address';
  return null;
};

const hasSpecial = (v) => [...v].some((ch) => PASSWORD_SPECIALS.includes(ch));

export const passwordProblem = (v) => {
  if (typeof v !== 'string') return 'Password must be text';
  const problems = [];
  if (v.length < PASSWORD_MIN || v.length > PASSWORD_MAX) problems.push(`be ${PASSWORD_MIN}-${PASSWORD_MAX} characters long`);
  if (!/[a-z]/.test(v)) problems.push('contain a lowercase letter');
  if (!/[A-Z]/.test(v)) problems.push('contain an uppercase letter');
  if (!/[0-9]/.test(v)) problems.push('contain a digit');
  if (!hasSpecial(v)) problems.push(`contain a special character (${PASSWORD_SPECIALS})`);
  return problems.length ? `Password must ${problems.join(', ')}` : null;
};

export const passwordStrength = (v) => {
  if (!v) return { level: 0, label: 'Too weak', score: 0 };
  const classes = [/[a-z]/.test(v), /[A-Z]/.test(v), /[0-9]/.test(v), hasSpecial(v)].filter(Boolean).length;
  const score = classes + (v.length >= 12 ? 1 : 0);
  if (passwordProblem(v)) return score >= 3 ? { level: 2, label: 'Weak', score } : { level: 1, label: 'Too weak', score };
  return v.length >= 12 ? { level: 3, label: 'Strong', score } : { level: 2, label: 'Medium', score };
};
