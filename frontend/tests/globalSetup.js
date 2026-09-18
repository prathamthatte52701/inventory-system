// Boots the REAL backend (against a throwaway DB) for the UI tests, on port 5055.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../backend');
const require = createRequire(path.join(backend, 'x.js'));

export default async function setup() {
  require('dotenv').config({ path: path.join(backend, '.env'), quiet: true });
  process.env.NODE_ENV = 'test';
  const mongoose = require('mongoose');
  await require(path.join(backend, 'config/db.js'))({ dbName: 'inventory_test_ui' });
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  await require(path.join(backend, 'utils/seedAdmins.js'))();
  const server = require(path.join(backend, 'app.js')).listen(5055);
  return async () => {
    server.close();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  };
}
