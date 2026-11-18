// Measures ramp smoothness: per-tick vertical jerk and speed drops while surfing, and tick cost.
const C = require('./core.js'); const MAPS = require('./maps.js');
for (const def of MAPS) {
  const w = C.buildMap(def); const cfg = C.cfgFor({}, false); const run = C.newRun(w, cfg); const bot = C.newBot();
  let surfT = 0, jerk = 0, bigJerk = 0, drops = 0, dropSum = 0, prev = null, prev2 = null, prevSp = 0, t0 = process.hrtime.bigint(), ticks = 0, maxTick = 0;
  while (!run.finished && ticks < 100 * 200) {
    const a = process.hrtime.bigint();
    C.runTick(w, run, C.botCmd(w, run, bot), cfg); ticks++;
    const dt = Number(process.hrtime.bigint() - a) / 1e6; if (dt > maxTick) maxTick = dt;
    const p = run.p, sp = Math.hypot(...p.vel), surfing = p.tick - p.touchT < 2;
    if (surfing && prev && prev2 && !p.teleported) {
      surfT++;
      const acc = p.pos[1] - 2 * prev[1] + prev2[1]; // second difference of height
      jerk += Math.abs(acc); if (Math.abs(acc) > 1.0) bigJerk++;
      if (prevSp - sp > 15) { drops++; dropSum += prevSp - sp; }
    }
    prev2 = prev; prev = p.pos.slice(); prevSp = sp;
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(def.id.padEnd(9), run.finished ? 'OK ' : 'NO ', 'surfTicks', surfT, 'avgJerk', (jerk / Math.max(1, surfT)).toFixed(3), 'bumps>1u', bigJerk, 'speedDrops>15', drops, 'lost', Math.round(dropSum), 'tick avg', (ms / ticks).toFixed(3) + 'ms', 'max', maxTick.toFixed(2) + 'ms');
}
