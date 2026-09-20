// Pure validation rules for user-facing fields. Shared by the User model (defence in depth), the request
// validators in middleware/fields.js and the signup controller, so all three can never disagree.
// The frontends carry a copy of the same rules for instant feedback; the server is the real gate.

// HTML-spec style address pattern: dot-atom local part, labelled domain with at least one dot, labels <= 63 chars
const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
const EMAIL_MAX = 254;

const NAME_MIN = 3, NAME_MAX = 48;
const PASSWORD_MIN = 8, PASSWORD_MAX = 32;
const PASSWORD_SPECIALS = '!@#$%^&*()_+-=[]{}|;:,.<>?';

const nameProblem = (v) => {
  if (typeof v !== 'string') return 'Name must be text';
  const n = v.trim().length;
  if (n < NAME_MIN || n > NAME_MAX) return `Name must be ${NAME_MIN}-${NAME_MAX} characters`;
  return null;
};

const emailProblem = (v) => {
  if (typeof v !== 'string') return 'Email must be text';
  const t = v.trim();
  if (t.length > EMAIL_MAX || !EMAIL_RE.test(t)) return 'Enter a valid email address';
  return null;
};

// One message naming exactly which rules failed, so the frontend can show the same text.
const passwordProblem = (v) => {
  if (typeof v !== 'string') return 'Password must be text';
  const problems = [];
  if (v.length < PASSWORD_MIN || v.length > PASSWORD_MAX) problems.push(`be ${PASSWORD_MIN}-${PASSWORD_MAX} characters long`);
  if (!/[a-z]/.test(v)) problems.push('contain a lowercase letter');
  if (!/[A-Z]/.test(v)) problems.push('contain an uppercase letter');
  if (!/[0-9]/.test(v)) problems.push('contain a digit');
  if (![...v].some((ch) => PASSWORD_SPECIALS.includes(ch))) problems.push(`contain a special character (${PASSWORD_SPECIALS})`);
  return problems.length ? `Password must ${problems.join(', ')}` : null;
};

module.exports = { EMAIL_RE, EMAIL_MAX, NAME_MIN, NAME_MAX, PASSWORD_MIN, PASSWORD_MAX, PASSWORD_SPECIALS, nameProblem, emailProblem, passwordProblem };
