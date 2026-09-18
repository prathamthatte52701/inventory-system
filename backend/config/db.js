const dns = require('dns');
const mongoose = require('mongoose');

module.exports = async function connectDB(opts = {}) {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI not set');
  // Some local resolvers refuse SRV lookups (needed by mongodb+srv); fall back to public DNS.
  try { await dns.promises.resolveSrv('_mongodb._tcp.' + new URL(process.env.MONGO_URI).hostname); }
  catch { dns.setServers(['8.8.8.8', '1.1.1.1']); }
  await mongoose.connect(process.env.MONGO_URI, opts);
  console.log('MongoDB connected');
};
