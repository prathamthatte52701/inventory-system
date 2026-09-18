const AuditLog = require('../models/AuditLog');

// Never throws: a failed audit write must not break the request.
module.exports = async function audit(req, action, entityType, entityId, details = {}, userOverride) {
  try {
    const u = userOverride || req.user;
    await AuditLog.create({
      user: u && u._id, userEmail: u && u.email, action, entityType,
      entityId: entityId || null, details, ip: req.ip,
    });
  } catch (e) {
    console.error('audit failed:', e.message);
  }
};
