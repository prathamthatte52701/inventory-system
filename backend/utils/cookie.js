// The session lives only in this cookie: httpOnly (script cannot read it), SameSite=Strict (never sent on
// cross-site requests, which also blocks CSRF) and Secure. Set COOKIE_SECURE=false only for plain-HTTP setups
// that are not localhost (e.g. Safari on http://localhost, or a LAN address).
const NAME = 'token';
const MAX_AGE_MS = 8 * 60 * 60 * 1000; // same as the JWT lifetime

const options = () => ({ httpOnly: true, secure: process.env.COOKIE_SECURE !== 'false', sameSite: 'strict', path: '/' });

const setAuthCookie = (res, token) => res.cookie(NAME, token, { ...options(), maxAge: MAX_AGE_MS });
const clearAuthCookie = (res) => res.clearCookie(NAME, options()); // same attributes, or browsers keep the old cookie

module.exports = { NAME, setAuthCookie, clearAuthCookie };
