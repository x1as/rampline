const C = require('./core.js'); const MAPS = require('./maps.js');
let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (const noise of [0.15, 0.3, 0.45]) {
  const row = [];
  for (const def of MAPS) {
    const w = C.buildMap(def); let fin = 0, deaths = 0, tt = 0;
    for (let trial = 0; trial < 8; trial++) {
      seed = 1000 + trial * 77;
      const cfg = C.cfgFor({}, false); const run = C.newRun(w, cfg); const bot = C.newBot();
      let ticks = 0, hold = 0, held = null, yawOff = 0;
      while (!run.finished && ticks < 100 * 240) {
        let cmd = C.botCmd(w, run, bot);
        // human-ish errors: late/early key presses, yaw wobble
        if (hold > 0) { hold--; cmd.side = held; } else if (rnd() < noise * 0.06) { hold = 5 + (rnd() * 25 | 0); held = rnd() < 0.5 ? 0 : -cmd.side; }
        yawOff = yawOff * 0.97 + (rnd() - 0.5) * noise * 0.06; cmd.yaw += yawOff;
        C.runTick(w, run, cmd, cfg); ticks++;
      }
      if (run.finished) { fin++; tt += run.time; } deaths += run.deaths;
    }
    row.push(`${def.id}:T${def.tier} ${fin}/8 d${(deaths / 8).toFixed(1)}` + (fin ? ` ${(tt / fin).toFixed(1)}s` : ''));
  }
  console.log('noise', noise, '|', row.join(' | '));
}
