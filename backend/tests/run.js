const { spawnSync } = require('child_process');
let bad = 0;
for (const f of ['phase1.test.js', 'api.test.js', 'movements.test.js', 'reports.test.js']) {
  bad += spawnSync('node', [require('path').join(__dirname, f)], { stdio: 'inherit' }).status ? 1 : 0;
}
process.exit(bad);
