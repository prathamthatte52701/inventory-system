// A second, completely separate Node process running the API against the same database.
// Used to prove the material lock and the login lockout hold across processes (not just inside one).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
process.env.NODE_ENV = 'test';
const connectDB = require('../config/db');
const app = require('../app');

connectDB({ dbName: process.env.TEST_DB })
  .then(() => {
    const server = app.listen(0, () => console.log(`PORT=${server.address().port}`));
    process.stdin.resume();
    process.stdin.on('end', () => process.exit(0)); // parent closes stdin to stop us
  })
  .catch((e) => { console.error(e.message); process.exit(1); });
