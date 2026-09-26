// Boots the REAL backend (against a throwaway DB) for the UI tests, on port 5056.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../backend');
const require = createRequire(path.join(backend, 'x.js'));

export default async function setup() {
  const DB_NAME = 'inventory_test_ui_admin';
  require(path.join(backend, 'utils/testEnvGuard.js')).loadTestEnv(backend, DB_NAME); // backend/.env.test if present, else backend/.env + warning; refuses to run against anything that looks like the real database
  process.env.NODE_ENV = 'test';
  process.env.SIGNUP_RATE_MAX ||= '10000'; // UI tests sign up many users from one IP; the signup limiter has its own backend tests
  process.env.COOKIE_SECURE = 'false'; // jsdom talks plain http to the test server
  process.env.CORS_ORIGIN = 'http://localhost:3000'; // jsdom's origin
  const mongoose = require('mongoose');
  await require(path.join(backend, 'config/db.js'))({ dbName: DB_NAME });
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  await require(path.join(backend, 'utils/seedAdmins.js'))();
  const server = require(path.join(backend, 'app.js')).listen(5056);
  return async () => {
    server.close();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  };
}
