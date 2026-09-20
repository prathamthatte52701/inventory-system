const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const c = require('../controllers/reportController');

router.use(requireAuth);
router.get('/dashboard', c.dashboard);
router.get('/stock-value/excel', c.stockExcel);
router.get('/stock-value/pdf', c.stockPdf);
router.get('/stock/low-stock/excel', c.lowStockExcel);
router.get('/stock/out-of-stock/excel', c.outOfStockExcel);
router.get('/movements/excel', c.movementsExcel);
router.get('/daily-summary', c.dailySummaryExcel);

module.exports = router;
