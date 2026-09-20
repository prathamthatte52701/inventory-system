const { spawnSync } = require('child_process');
let bad = 0;
for (const f of ['phase1.test.js', 'api.test.js', 'movements.test.js', 'reports.test.js', 'roles.test.js', 'e2e.test.js', 'qa.test.js', 'fixes.test.js', 'admin.test.js', 'hardening.test.js', 'outReject.test.js', 'corrections.test.js', 'dailyReport.test.js', 'import.test.js']) {
  bad += spawnSync('node', [require('path').join(__dirname, f)], { stdio: 'inherit' }).status ? 1 : 0;
}
process.exit(bad);
