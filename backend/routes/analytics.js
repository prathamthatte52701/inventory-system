const router = require('express').Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const c = require('../controllers/analyticsController');

router.use(requireAuth, requireAdmin);
router.get('/volume', c.volume);
router.get('/top-materials', c.topMaterials);

module.exports = router;
