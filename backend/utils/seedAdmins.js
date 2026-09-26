// Deliberately no dotenv call at module scope: this file is required by every test harness (backend/tests/harness.js,
// both frontend*/tests/globalSetup.js), and used to load the REAL backend/.env unconditionally the instant anything
// required it — regardless of whether the caller had already loaded a safe test config. Every caller now loads its
// own environment (test callers go through utils/testEnvGuard.js) before requiring this file, so this file just uses
// whatever is already in process.env. The one exception is running this file directly (`npm run seed`), below: that
// really is meant to seed the real database, so it loads backend/.env itself and does NOT go through the test guard.
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');

async function seedAdmins() {
  const out = [];
  for (const n of [1, 2]) {
    const name = process.env[`ADMIN${n}_NAME`];
    const email = (process.env[`ADMIN${n}_EMAIL`] || '').toLowerCase();
    const pw = process.env[`ADMIN${n}_PASSWORD`];
    if (!name || !email || !pw) throw new Error(`ADMIN${n}_NAME/EMAIL/PASSWORD missing in .env`);
    if (await User.exists({ email })) { out.push(`${email}: exists, skipped`); continue; }
    await User.create({
      name, email, passwordHash: await User.hashPassword(pw),
      role: 'admin', status: 'approved', approvedAt: new Date(),
    });
    out.push(`${email}: created`);
  }
  return out;
}

module.exports = seedAdmins;

if (require.main === module) {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') }); // real seeding: intentionally the real .env, never a test one
  connectDB()
    .then(seedAdmins)
    .then((r) => { r.forEach((l) => console.log(l)); return mongoose.disconnect(); })
    .catch((e) => { console.error('seed failed:', e.message); process.exit(1); });
}
