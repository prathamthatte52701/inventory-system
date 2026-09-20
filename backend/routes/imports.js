const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const c = require('../controllers/importController');

// any logged-in approved user (deliberately not admin-only)
router.use(requireAuth);
router.get('/', c.list);
router.post('/preview', c.preview);
router.post('/commit', c.commit);

module.exports = router;
