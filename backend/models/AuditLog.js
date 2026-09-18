const mongoose = require('mongoose');
const { ObjectId } = mongoose.Schema.Types;

const auditLogSchema = new mongoose.Schema({
  user: { type: ObjectId, ref: 'User' },
  userEmail: String,
  action: { type: String, required: true },
  entityType: String,
  entityId: { type: ObjectId, default: null },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
  ip: String,
}, { timestamps: { createdAt: true, updatedAt: false } });

auditLogSchema.index({ createdAt: 1 });
auditLogSchema.index({ entityType: 1, entityId: 1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
