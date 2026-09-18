const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const c = require('../controllers/reportController');

router.use(requireAuth);
router.get('/dashboard', c.dashboard);
router.get('/stock-value/excel', c.stockExcel);
router.get('/stock-value/pdf', c.stockPdf);
router.get('/movements/excel', c.movementsExcel);

module.exports = router;
