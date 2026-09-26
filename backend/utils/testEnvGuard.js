// Loads environment config for a test run and refuses to proceed if it looks like it would touch the real
// database. This exists because a manual verification script once pointed straight at the real MONGO_URI and
// left test users/materials in production data that had to be cleaned up by hand — this guard is what stops
// that from happening again, automated or manual.
//
// Preference order: backend/.env.test (a separate, clearly-named test database) > backend/.env (the real one,
// loud warning). Either way, before any connection is made, the resolved Mongo target is checked against the
// real .env's own database name and refused if it matches or doesn't look like a test database.
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const dbNameOf = (uri) => { try { return new URL(uri).pathname.replace(/^\//, '') || null; } catch { return null; } };
// A name "looks real" if it's not clearly a test database — i.e. it doesn't contain "test" anywhere in it.
const looksReal = (name) => !!name && !/test/i.test(name);

// backendDir: absolute path to backend/. dbName: the database this run intends to use (e.g. the literal string
// passed as config/db.js's `dbName` option) — pass it if the caller has one, so it's checked too, not just the
// .env file's own MONGO_URI path. Throws instead of returning if the target looks unsafe.
function loadTestEnv(backendDir, dbName) {
  const testEnvPath = path.join(backendDir, '.env.test');
  const realEnvPath = path.join(backendDir, '.env');
  const usingTestEnv = fs.existsSync(testEnvPath);

  if (usingTestEnv) {
    dotenv.config({ path: testEnvPath, quiet: true });
  } else {
    console.warn(
      '\n[testEnvGuard] backend/.env.test not found — falling back to backend/.env, which holds the REAL ' +
      'database credentials. Copy backend/.env.test.example to backend/.env.test and point it at a test ' +
      'database to isolate tests from production data.\n'
    );
    dotenv.config({ path: realEnvPath, quiet: true });
  }

  // The real database's own name, read directly from .env, regardless of which file we just loaded — this is
  // what a resolved target is compared against, so a mistakenly-copied .env.test is still caught.
  const real = {};
  dotenv.config({ path: realEnvPath, processEnv: real, quiet: true });
  const realDb = dbNameOf(real.MONGO_URI);
  const uriDb = dbNameOf(process.env.MONGO_URI);

  const suspects = [uriDb, dbName].filter(Boolean);
  const hit = suspects.find((name) => name === realDb || looksReal(name));
  if (hit) {
    throw new Error(
      `[testEnvGuard] Refusing to run against database "${hit}" — it matches the real database ("${realDb}") ` +
      'or does not look like a test database (its name must contain "test"). Fix backend/.env.test (or the ' +
      'dbName this test run would use) before running again.'
    );
  }
  return { usingTestEnv, realDb, uriDb };
}

module.exports = { loadTestEnv, dbNameOf, looksReal };
