const C = require('./core.js');
const MAPS = require('./maps.js');
const only = process.argv[2];
const verbose = process.argv.includes('-v');
for (const def of MAPS) {
  if (only && only !== '-v' && def.id !== only) continue;
  const w = C.buildMap(def);
  const cfg = C.cfgFor({}, false);
  const run = C.newRun(w, cfg);
  const bot = C.newBot();
  const fails = {};
  let ticks = 0, lastStage = 0, stuckT = 0, lastPos = run.p.pos.slice();
  const t0 = Date.now();
  while (!run.finished && ticks < 100 * 400) {
    const cmd = C.botCmd(w, run, bot);
    const ev = C.runTick(w, run, cmd, cfg);
    ticks++;
    for (const e of ev) {
      if (e.t === 'fail') {
        const k = run.stage + ':' + bot.seg; fails[k] = (fails[k] || 0) + 1;
        if (verbose) console.log('  fail stage', run.stage, 'seg', bot.seg, 'pos', run.p.pos.map(Math.round));
      }
      if (e.t === 'stage' && verbose) console.log('  stage', e.stage, e.time.toFixed(2));
    }
    if (run.deaths > 40) break;
    if (verbose && ticks % 50 === 0) {
      const p = run.p; console.log('   t', (ticks / 100).toFixed(1), 'st', run.stage, 'seg', bot.seg, 'pos', p.pos.map(Math.round).join(','), 'spd', Math.round(Math.hypot(p.vel[0], p.vel[2])), 'vy', Math.round(p.vel[1]), 'g', p.onGround ? 1 : 0, 'touch', p.tick - p.touchT < 3 ? 1 : 0);
    }
  }
  console.log(def.id.padEnd(10), 'T' + def.tier, run.finished ? 'OK  ' : 'FAIL', 'time', run.time.toFixed(2), 'deaths', run.deaths, 'maxspd', Math.round(run.maxSpeed),
    'sync', (run.p.syncGood / Math.max(1, run.p.syncAll) * 100).toFixed(0) + '%', 'stage', run.stage, JSON.stringify(fails), (Date.now() - t0) + 'ms');
}
