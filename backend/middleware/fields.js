// Strict field validators. express-validator's isFloat/isString quietly accept arrays, "1e999" and similar,
// which is how NaN/Infinity/500s got into the system, so numbers and strings are checked by hand here.
const { body } = require('express-validator');
const V = require('../utils/validation');

const LIMIT = 1e9; // largest accepted quantity or rate
const isId = (v) => typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v);
const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

// number | numeric string -> finite Number within [min, max]; anything else -> NaN
function parseNum(v, { min = 0, max = LIMIT } = {}) {
  let n = NaN;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && NUMERIC.test(v.trim())) n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : NaN;
}

const num = (field, { min = 0, max = LIMIT, required = false } = {}) => {
  const chain = body(field);
  if (!required) chain.optional();
  return chain.custom((v) => {
    if (Number.isNaN(parseNum(v, { min, max }))) throw new Error(`${field} must be a number between ${min} and ${max}`);
    return true;
  });
};

const str = (field, { max, required = false } = {}) => {
  const chain = body(field);
  if (!required) chain.optional();
  return chain.custom((v) => {
    if (typeof v !== 'string') throw new Error(`${field} must be text`);
    const t = v.trim();
    if (required && !t) throw new Error(`${field} required`);
    if (v.length > max) throw new Error(`${field} must be at most ${max} characters`);
    return true;
  });
};

const oneOf = (field, values, { required = true } = {}) => {
  const chain = body(field);
  if (!required) chain.optional();
  return chain.custom((v) => {
    if (typeof v !== 'string' || !values.includes(v)) throw new Error(`${field} must be one of ${values.join(', ')}`);
    return true;
  });
};

const objectId = (field) =>
  body(field).custom((v) => {
    if (!isId(v)) throw new Error(`${field} must be a valid id`);
    return true;
  });

// ISO-8601 text, year 1970..2100
const date = (field) =>
  body(field).optional().custom((v) => {
    const d = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(v) ? new Date(v) : null;
    if (!d || Number.isNaN(+d) || d.getUTCFullYear() < 1970 || d.getUTCFullYear() > 2100) throw new Error(`${field} must be a valid date (1970-2100)`);
    return true;
  });

// user-facing field rules (see utils/validation.js). Run on the raw value first, THEN trim, so arrays/objects are never
// stringified into something that passes.
const fromRule = (field, rule, { trim = false } = {}) => {
  const chain = body(field).custom((v) => {
    const problem = rule(v);
    if (problem) throw new Error(problem);
    return true;
  });
  return trim ? chain.trim() : chain;
};
const password = (field = 'password') => fromRule(field, V.passwordProblem);
const username = (field = 'name') => fromRule(field, V.nameProblem, { trim: true });
const emailField = (field = 'email') => fromRule(field, V.emailProblem, { trim: true });

module.exports = { password, username, emailField, isId, LIMIT, parseNum, num, str, oneOf, objectId, date };
