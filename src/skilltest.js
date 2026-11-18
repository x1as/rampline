// Difficulty report per map: build stats, expert / naive / noisy-expert completion.
// node skilltest.js [mapId] [trials]
const C = require('./core.js'); const MAPS = require('./maps.js');
const only = process.argv[2] && process.argv[2] !== 'all' ? process.argv[2] : null;
const trials = +process.argv[3] || 6;
let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
function play(w, style, noise, limit) {
  const cfg = C.cfgFor({}, false), run = C.newRun(w, cfg), bot = C.newBot(style);
  let ticks = 0, hold = 0, held = 0, yawOff = 0, chainBest = 0;
  while (!run.finished && ticks < limit && run.deaths < 60) {
    const cmd = C.botCmd(w, run, bot);
    if (noise) {
      if (hold > 0) { hold--; cmd.side = held; } else if (rnd() < noise * 0.06) { hold = 5 + (rnd() * 25 | 0); held = rnd() < 0.5 ? 0 : -cmd.side; }
      yawOff = yawOff * 0.97 + (rnd() - 0.5) * noise * 0.06; cmd.yaw += yawOff;
    }
    C.runTick(w, run, cmd, cfg); ticks++;
    if (run.p.chain) chainBest = Math.max(chainBest, run.p.chain.n);
  }
  return { fin: run.finished, t: run.time, deaths: run.deaths, max: run.maxSpeed, stage: run.stage, chainBest };
}
for (const def of MAPS) {
  if (only && def.id !== only) continue;
  const t0 = Date.now();
  const w = C.buildMap(def);
  const bt = Date.now() - t0;
  const eased = w.stages.reduce((a, s) => a + s.eased, 0), bad = w.stages.filter(s => !s.ok).length;
  const ex = play(w, 'expert', 0, 100 * 900);
  const nv = play(w, 'naive', 0, 100 * 900);
  const row = [];
  for (const noise of [0.1, 0.25]) {
    let f = 0; for (let i = 0; i < trials; i++) { seed = 500 + i * 31; if (play(w, 'expert', noise, 100 * 900).fin) f++; }
    row.push(`n${noise}:${f}/${trials}`);
  }
  const ramps = w.stages.reduce((a, s) => a + s.path.length, 0);
  console.log(`${def.id.padEnd(8)} T${String(def.tier).padEnd(2)} build ${bt}ms stages ${w.stages.length} broken ${bad} eased ${eased} | expert ${ex.fin ? 'OK ' + ex.t.toFixed(1) + 's' : 'FAIL st' + ex.stage} max ${Math.round(ex.max)} chain ${ex.chainBest} deaths ${ex.deaths} | naive ${nv.fin ? 'OK' : 'fail st' + nv.stage} | ${row.join(' ')}`);
}
