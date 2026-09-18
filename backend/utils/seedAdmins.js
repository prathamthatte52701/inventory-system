require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
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
  connectDB()
    .then(seedAdmins)
    .then((r) => { r.forEach((l) => console.log(l)); return mongoose.disconnect(); })
    .catch((e) => { console.error('seed failed:', e.message); process.exit(1); });
}
