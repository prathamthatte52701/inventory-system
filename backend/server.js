require('dotenv').config();
const connectDB = require('./config/db');
const app = require('./app');

connectDB()
  .then(() => app.listen(process.env.PORT || 5000, () => console.log('Server up')))
  .catch((e) => { console.error('Startup failed:', e.message); process.exit(1); });
