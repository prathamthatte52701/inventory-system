const router = require('express').Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');

router.use(requireAuth, requireAdmin);
router.get('/', require('../controllers/auditController').list);

module.exports = router;
