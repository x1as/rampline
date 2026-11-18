// ============================================================
// RAMPLINE core: Source-style movement, brush collision, maps, bot.
// Pure JS, no DOM. Units = Hammer units, Y is up.
// ============================================================
var CORE_DEBUG = typeof process !== 'undefined' && process.env && process.env.CDEBUG;
const CORE = (() => {
  const TICK = 1 / 100;
  const HULL = [16, 36, 16];          // half extents: 32x72x32 player box
  const EYE = 28;                      // eye above box centre (64 above feet)
  const EPS = 0.03125;

  // Stock physics: identical for every player on the Stock board.
  const BASE = {
    gravity: 800, accel: 6, airaccel: 150, friction: 4.5, stopspeed: 75,
    maxspeed: 260, aircap: 30, jump: 301.993, maxvel: 5000,
    landKeep: 0.15,    // share of the speed a hard ramp entry would eat that is given back (CS: 0)
    sync: 0.3,         // strafe assist blend toward perfect sync (stock)
    prespeed: 290,     // start zone exit cap
    boost: 0           // overdrive charges per stage
  };

  // ---------- perks (Open board only) ----------
  const PERKS = [
    { id: 'sync', name: 'Strafe Sync', max: 3, cost: [120, 300, 650],
      desc: 'Стрейф сам доворачивает к идеальному углу.', fx: l => `синк-ассист ${[30, 50, 65, 80][l]}%` },
    { id: 'air', name: 'Air Control', max: 3, cost: [150, 380, 800],
      desc: 'Резче поворот в воздухе.', fx: l => `airaccelerate ${150 + l * 60}` },
    { id: 'cap', name: 'Velocity Cap', max: 3, cost: [200, 450, 900],
      desc: 'Выше потолок скорости.', fx: l => `${5000 + l * 700} u/s` },
    { id: 'od', name: 'Overdrive', max: 2, cost: [350, 900],
      desc: 'E: рывок +320 u/s по вектору. Заряды на стейдж.', fx: l => `${l} заряд(а) на стейдж` },
  ];
  function cfgFor(perks, open) {
    const c = Object.assign({}, BASE);
    if (!open) return c;
    const p = perks || {};
    c.sync = [0.3, 0.5, 0.65, 0.8][p.sync | 0];
    c.airaccel = 150 + (p.air | 0) * 60;
    c.maxvel = 5000 + (p.cap | 0) * 700;
    c.boost = p.od | 0;
    return c;
  }

  // ---------- vector helpers ----------
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = a => Math.hypot(a[0], a[1], a[2]);
  const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const fwdOf = yaw => [-Math.sin(yaw), 0, -Math.cos(yaw)];
  const rightOf = yaw => [Math.cos(yaw), 0, -Math.sin(yaw)];

  // ---------- brushes ----------
  // Convex solids defined by outward planes (like Hammer brushes). Render polygons
  // are derived by clipping each plane against the others.
  function clipPoly(poly, n, d) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const da = dot(n, a) - d, db = dot(n, b) - d;
      if (da <= 0.01) out.push(a);
      if ((da < -0.01 && db > 0.01) || (da > 0.01 && db < -0.01)) {
        const t = da / (da - db);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
      }
    }
    return out;
  }
  function polyArea(poly) {
    let acc = [0, 0, 0];
    for (let i = 1; i < poly.length - 1; i++) acc = add(acc, cross(sub(poly[i], poly[0]), sub(poly[i + 1], poly[0])));
    return len(acc) / 2;
  }
  // bevels: undefined -> axial box bevels; array -> only +-Y axial plus these planes
  function brushFromPlanes(planes, kind, bevels) {
    const polys = [], faceN = [], keep = [];
    planes.forEach((p, i) => {
      const n = p.n;
      const t = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const u = norm(cross(n, t)), v = cross(n, u);
      const o = mul(n, p.d), S = 1e6;
      let poly = [add(o, add(mul(u, -S), mul(v, -S))), add(o, add(mul(u, S), mul(v, -S))), add(o, add(mul(u, S), mul(v, S))), add(o, add(mul(u, -S), mul(v, S)))];
      planes.forEach((q, j) => { if (j !== i && poly.length) poly = clipPoly(poly, q.n, q.d); });
      if (poly.length >= 3 && polyArea(poly) > 1) { polys.push(poly); faceN.push(n); keep.push(p); }
    });
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    polys.forEach(pl => pl.forEach(v => { for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], v[i]); max[i] = Math.max(max[i], v[i]); } }));
    // axial bevels keep the hull expansion tight at sharp edges
    const ax = [[1, 0, 0, max[0]], [-1, 0, 0, -min[0]], [0, 1, 0, max[1]], [0, -1, 0, -min[1]], [0, 0, 1, max[2]], [0, 0, -1, -min[2]]];
    const all = keep.slice();
    ax.forEach(a => {
      if (bevels && a[1] === 0) return;
      if (!keep.some(p => p.n[0] * a[0] + p.n[1] * a[1] + p.n[2] * a[2] > 0.9999)) all.push({ n: [a[0], a[1], a[2]], d: a[3] });
    });
    if (bevels) bevels.forEach(b => all.push(b));
    return { polys, faceN, faces: keep, planes: all, min, max, kind, bevels };
  }
  function planesFromVerts(verts, faces) {
    const c = [0, 0, 0];
    verts.forEach(v => { c[0] += v[0]; c[1] += v[1]; c[2] += v[2]; });
    c[0] /= verts.length; c[1] /= verts.length; c[2] /= verts.length;
    return faces.map(f => {
      const v0 = verts[f[0]], v1 = verts[f[1]], v2 = verts[f[2]];
      let n = norm(cross(sub(v1, v0), sub(v2, v0)));
      if (dot(n, sub(c, v0)) > 0) n = mul(n, -1);
      return { n, d: dot(n, v0) };
    });
  }
  function makeBrush(verts, faces, kind) { return brushFromPlanes(planesFromVerts(verts, faces), kind); }
  function translateBrush(b, dv) {
    const mv = p => Object.assign({}, p, { d: p.d + dot(p.n, dv) });
    const nb = brushFromPlanes(b.faces.map(mv), b.kind, b.bevels && b.bevels.map(mv));
    for (const k of ['ramp', 'side', 'stage']) if (b[k] !== undefined) nb[k] = b[k];
    if (b.ramp) nb.ramp = Object.assign({}, b.ramp, { R0: add(b.ramp.R0, dv) });
    return nb;
  }
  function boxBrush(min, max, kind) {
    const [x0, y0, z0] = min, [x1, y1, z1] = max;
    const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    const f = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]];
    return makeBrush(v, f, kind);
  }
  // Rotated box (yaw) centred at c with half sizes hx (right), hy, hz (forward)
  function yawBox(c, yaw, hx, hy, hz, kind) {
    const f = fwdOf(yaw), r = rightOf(yaw);
    const v = [];
    for (const sy of [-1, 1]) for (const sz of [-1, 1]) for (const sx of [-1, 1])
      v.push([c[0] + r[0] * hx * sx + f[0] * hz * sz, c[1] + hy * sy, c[2] + r[2] * hx * sx + f[2] * hz * sz]);
    const faces = [[0, 1, 3, 2], [4, 5, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5], [0, 1, 5, 4], [2, 3, 7, 6]];
    return makeBrush(v, faces, kind);
  }
  // Classic surf ramp: triangular prism, ridge on top, descending along its length.
  // `nose` > 0 adds a cutting plane at the start: a low entry gets deflected up
  // onto the slope instead of slamming into a vertical cap.
  // `startM` / `endM`: mitre normals for pieces of a curved ramp. Neighbouring pieces
  // share that plane exactly, so the slope is one continuous surface; the shared caps
  // are flagged `inner` and never stop a rider.
  function rampBrush(R0, yaw, length, drop, b, h, nose, startM, endM) {
    const f = fwdOf(yaw), r = rightOf(yaw);
    const A = add(add(R0, mul(r, -b)), [0, -h, 0]);
    const B = R0.slice();
    const C = add(add(R0, mul(r, b)), [0, -h, 0]);
    const d = add(mul(f, length), [0, -drop, 0]);
    const v = [A, B, C, add(A, d), add(B, d), add(C, d)];
    const planes = planesFromVerts(v, [[0, 1, 4, 3], [1, 2, 5, 4], [0, 3, 5, 2], [0, 2, 1], [3, 4, 5]]);
    const R1 = add(R0, d);
    if (startM) { const n = mul(startM, -1); planes[3] = { n, d: dot(n, R0), inner: true }; }
    if (endM) planes[4] = { n: endM.slice(), d: dot(endM, R1), inner: true };
    const taper = nose ? h * nose : 0;
    if (taper) {
      // passes through the base start edge (s=0, depth h) and the ridge at s=taper
      const n = norm(add(mul(f, -h), [0, taper, 0]));
      planes.push({ n, d: dot(n, add(R0, mul(f, taper))) });
    }
    // bevels: vertical planes along both base edges (caps the sharp slope/bottom corner)
    const bev = [{ n: mul(r, -1), d: dot(mul(r, -1), A) }, { n: r.slice(), d: dot(r, C) }];
    const br = brushFromPlanes(planes, 'ramp', bev);
    br.ramp = { R0, yaw, length, drop, b, h, taper };
    return br;
  }

  // ---------- tracing (Quake-style box vs convex brush) ----------
  function traceBrush(b, s, e, tr) {
    let enter = -1, leave = 1, clip = null, startOut = false, getOut = false;
    const P = b.planes;
    for (let i = 0; i < P.length; i++) {
      const p = P[i], n = p.n;
      const dist = p.d + Math.abs(n[0]) * HULL[0] + Math.abs(n[1]) * HULL[1] + Math.abs(n[2]) * HULL[2];
      const d1 = s[0] * n[0] + s[1] * n[1] + s[2] * n[2] - dist;
      const d2 = e[0] * n[0] + e[1] * n[1] + e[2] * n[2] - dist;
      if (d2 > 0) getOut = true;
      if (d1 > 0) startOut = true;
      // parallel or leaving: never a hit. The tolerance matters: a rider resting EPS off a
      // slope must not read float noise as "entering", or they freeze in place for a tick.
      if (d1 > 0 && (d2 >= EPS || d2 >= d1 - 1e-3)) return;
      if (d1 <= 0 && d2 <= 0) continue;
      if (d1 > d2) { const f = (d1 - EPS) / (d1 - d2); if (f > enter) { enter = f; clip = p; } }
      else { const f = (d1 + EPS) / (d1 - d2); if (f < leave) leave = f; }
    }
    if (!startOut) { tr.startsolid = true; if (!getOut) { tr.allsolid = true; tr.fraction = 0; } return; }
    if (enter < leave && enter > -1 && enter < tr.fraction) {
      if (clip.inner) return;   // entering through a seam shared with the neighbouring piece
      tr.fraction = Math.max(0, enter); tr.plane = clip.n; tr.brush = b;
    }
  }
  function trace(world, s, e) {
    const tr = { fraction: 1, plane: null, brush: null, startsolid: false, allsolid: false, end: null };
    const mnx = Math.min(s[0], e[0]) - HULL[0] - 1, mxx = Math.max(s[0], e[0]) + HULL[0] + 1;
    const mny = Math.min(s[1], e[1]) - HULL[1] - 1, mxy = Math.max(s[1], e[1]) + HULL[1] + 1;
    const mnz = Math.min(s[2], e[2]) - HULL[2] - 1, mxz = Math.max(s[2], e[2]) + HULL[2] + 1;
    const B = world.brushes;
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      if (b.max[0] < mnx || b.min[0] > mxx || b.max[1] < mny || b.min[1] > mxy || b.max[2] < mnz || b.min[2] > mxz) continue;
      traceBrush(b, s, e, tr);
      if (tr.allsolid) break;
    }
    const f = tr.fraction;
    tr.end = [s[0] + (e[0] - s[0]) * f, s[1] + (e[1] - s[1]) * f, s[2] + (e[2] - s[2]) * f];
    return tr;
  }

  // ---------- player movement (Source gamemovement, trimmed) ----------
  function newPlayer(pos, yaw) {
    return { pos: pos.slice(), vel: [0, 0, 0], yaw: yaw || 0, onGround: false, touchN: null, touchT: -99,
      tick: 0, boostLeft: 0, lastJump: false, syncGood: 0, syncAll: 0, strafes: 0, lastSide: 0, jumps: 0 };
  }
  function clipVel(v, n, ob) {
    const back = dot(v, n) * ob;
    const o = [v[0] - n[0] * back, v[1] - n[1] * back, v[2] - n[2] * back];
    const adj = dot(o, n);
    if (adj < 0) { o[0] -= n[0] * adj; o[1] -= n[1] * adj; o[2] -= n[2] * adj; }
    return o;
  }
  function slideMove(world, p, dt) {
    const primal = p.vel.slice();
    let orig = p.vel.slice();
    let left = dt;
    const planes = [];
    for (let bump = 0; bump < 4; bump++) {
      if (len(p.vel) < 1e-6) break;
      const end = add(p.pos, mul(p.vel, left));
      let tr = trace(world, p.pos, end);
      if (tr.allsolid) { unstick(world, p); return; }
      // rampfix: a seam between ramp pieces can expose a sliver of wall. While surfing,
      // retry the move lifted a few units off the slope before accepting the hit.
      if (tr.fraction < 1 && tr.plane && Math.abs(tr.plane[1]) < 0.3 && p.touchN && p.tick - p.touchT < 4) {
        const n = p.touchN;
        for (const lift of [0.5, 1.5, 3]) {
          const s2 = add(p.pos, mul(n, lift));
          if (trace(world, s2, s2).startsolid) continue;
          const t2 = trace(world, s2, add(end, mul(n, lift)));
          if (t2.fraction > tr.fraction + 0.05 || t2.fraction === 1) { p.pos = s2; tr = t2; break; }
        }
      }
      if (tr.fraction > 0) { p.pos = tr.end; orig = p.vel.slice(); planes.length = 0; }
      if (tr.fraction === 1) break;
      left -= left * tr.fraction;
      const n = tr.plane;
      const surfPlane = n[1] < 0.7 && n[1] > 0.02;
      const landing = surfPlane && p.tick - p.touchT > 4 && !p.onGround;
      if (surfPlane) { p.touchN = n; p.touchT = p.tick; }
      if (planes.length >= 5) { p.vel = [0, 0, 0]; break; }
      planes.push(n);
      let nearPar = planes.length > 1;
      for (let i = 1; i < planes.length && nearPar; i++) if (dot(planes[i], planes[0]) < 0.95) nearPar = false;
      if (planes.length === 1 && !p.onGround) {
        p.vel = clipVel(orig, n, 1);
        if (landing) {
          // soft landing: most of the speed the clip would eat is redirected along the slope
          const s0 = len(orig), s1 = len(p.vel);
          p.landQ = s0 > 1 ? s1 / s0 : 1; p.landT = p.tick;
          if (s1 > 1) { const k = (s1 + (s0 - s1) * (p.landKeep || 0)) / s1; p.vel = mul(p.vel, k); }
        }
        orig = p.vel.slice();
      } else if (nearPar) {
        // rampfix: seam between nearly coplanar ramp pieces is not a crease
        let v = p.vel;
        for (const q of planes) v = clipVel(v, q, 1);
        p.vel = v; orig = v.slice();
        continue;
      } else {
        let i;
        for (i = 0; i < planes.length; i++) {
          p.vel = clipVel(orig, planes[i], 1);
          let j;
          for (j = 0; j < planes.length; j++) if (j !== i && dot(p.vel, planes[j]) < 0) break;
          if (j === planes.length) break;
        }
        if (i === planes.length) {
          if (planes.length !== 2) { p.vel = [0, 0, 0]; break; }
          const dir = norm(cross(planes[0], planes[1]));
          p.vel = mul(dir, dot(dir, p.vel));
        }
      }
      if (dot(p.vel, primal) <= 0) { p.vel = [0, 0, 0]; break; }
    }
  }
  function unstick(world, p) {
    const offs = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
    for (let r = 1; r <= 24; r *= 2) for (const o of offs) {
      const q = add(p.pos, mul(o, r));
      const tr = trace(world, q, q);
      if (!tr.startsolid) { p.pos = q; return true; }
    }
    return false;
  }
  function categorize(world, p) {
    if (p.vel[1] > 180) { p.onGround = false; return; }
    const tr = trace(world, p.pos, [p.pos[0], p.pos[1] - 2, p.pos[2]]);
    if (tr.fraction < 1 && tr.plane && tr.plane[1] >= 0.7 && tr.brush.kind !== 'ramp') { p.onGround = true; p.pos = tr.end; }
    else p.onGround = false;
  }
  function friction(p, cfg, dt) {
    const sp = Math.hypot(p.vel[0], p.vel[2]);
    if (sp < 0.1) return;
    const ctrl = Math.max(sp, cfg.stopspeed);
    const ns = Math.max(0, sp - ctrl * cfg.friction * dt) / sp;
    p.vel[0] *= ns; p.vel[2] *= ns;
  }
  function accelerate(p, wd, ws, acc, dt) {
    const cur = p.vel[0] * wd[0] + p.vel[2] * wd[2];
    const addsp = ws - cur; if (addsp <= 0) return;
    const a = Math.min(acc * dt * ws, addsp);
    p.vel[0] += a * wd[0]; p.vel[2] += a * wd[2];
  }
  function airAccelerate(p, wd, ws, cfg, dt) {
    const wsc = Math.min(ws, cfg.aircap);
    const cur = p.vel[0] * wd[0] + p.vel[2] * wd[2];
    const addsp = wsc - cur; if (addsp <= 0) return 0;
    const a = Math.min(cfg.airaccel * ws * dt, addsp);
    const before = p.vel[0] * p.vel[0] + p.vel[2] * p.vel[2];
    p.vel[0] += a * wd[0]; p.vel[2] += a * wd[2];
    return p.vel[0] * p.vel[0] + p.vel[2] * p.vel[2] - before;
  }
  // cmd: {fwd, side (-1..1), yaw, jump, boost}
  function step(world, p, cmd, cfg) {
    const dt = TICK;
    p.tick++;
    p.yaw = cmd.yaw;
    const f = fwdOf(cmd.yaw), r = rightOf(cmd.yaw);
    let wx = f[0] * cmd.fwd + r[0] * cmd.side, wz = f[2] * cmd.fwd + r[2] * cmd.side;
    const wl = Math.hypot(wx, wz);
    let wd = wl > 0 ? [wx / wl, 0, wz / wl] : [0, 0, 0];
    const ws = wl > 0 ? cfg.maxspeed : 0;

    // half gravity
    p.vel[1] -= cfg.gravity * 0.5 * dt;
    // jump (autobhop: hold)
    if (cmd.jump && p.onGround) {
      p.vel[1] = cfg.jump; p.onGround = false; p.jumps++;
    }
    if (p.onGround) { p.vel[1] = 0; friction(p, cfg, dt); }

    if (cmd.boost && p.boostLeft > 0 && !p.onGround) {
      const hs = Math.hypot(p.vel[0], p.vel[2]);
      if (hs > 50) { p.vel[0] += p.vel[0] / hs * 320; p.vel[2] += p.vel[2] / hs * 320; p.boostLeft--; p.boosted = p.tick; }
    }

    if (p.onGround) {
      if (ws) accelerate(p, wd, ws, cfg.accel, dt);
      p.vel[1] = 0;
      const hs = Math.hypot(p.vel[0], p.vel[2]);
      if (hs > cfg.maxspeed) { p.vel[0] *= cfg.maxspeed / hs; p.vel[2] *= cfg.maxspeed / hs; }
      walkMove(world, p, dt);
    } else {
      const hs = Math.hypot(p.vel[0], p.vel[2]);
      if (ws && cmd.side !== 0 && hs > 60) {
        // strafe assist: blend wishdir toward the perfect (perpendicular) angle on the same side
        const vx = p.vel[0] / hs, vz = p.vel[2] / hs;
        const vr = [-vz, 0, vx];
        const side = Math.sign(wd[0] * vr[0] + wd[2] * vr[2]);
        if (side !== 0) {
          const ix = vr[0] * side - vx * 0.035, iz = vr[2] * side - vz * 0.035; // tiny lead below 90°
          const k = cfg.sync;
          let nx = wd[0] * (1 - k) + ix * k, nz = wd[2] * (1 - k) + iz * k;
          const nl = Math.hypot(nx, nz) || 1; wd = [nx / nl, 0, nz / nl];
          if (side !== p.lastSide) { p.strafes++; p.lastSide = side; }
        }
      }
      let g = 0;
      const hs0 = Math.hypot(p.vel[0], p.vel[2]);
      if (ws) {
        g = airAccelerate(p, wd, ws, cfg, dt);
        if (cmd.side !== 0) { p.syncAll++; if (g > 0) p.syncGood++; }
      }
      p.landKeep = cfg.landKeep;
      slideMove(world, p, dt);
      chain(p, cmd, g, hs0);
    }
    if (p.onGround && p.chain) p.chain.n = 0;
    // clamp
    const sp = len(p.vel);
    if (sp > cfg.maxvel) p.vel = mul(p.vel, cfg.maxvel / sp);
    categorize(world, p);
    if (!p.onGround) p.vel[1] -= cfg.gravity * 0.5 * dt;
    else p.vel[1] = 0;
  }
  // Entry chain. Every ramp-to-ramp flight ends in an entry: keep >=97% of your speed
  // with a decent strafe sync in the air and the chain grows (max x8); a sloppy entry
  // (<90% kept) breaks it. Each link amplifies air-strafe gain and pays a speed bonus
  // on the clean entry itself, so a long clean chain accelerates you.
  const CHAIN_MAX = 8;
  function chain(p, cmd, g, hs0) {
    const ch = p.chain || (p.chain = { n: 0, best: 0, ev: '', evT: -99, q: 1, sync: 1 });
    const surf = p.tick - p.touchT < 2;
    if (!surf && p.wasSurf) p.flight = { t0: p.tick, good: 0, all: 0 };
    if (!surf && p.flight && cmd.side !== 0) { p.flight.all++; if (g > 0) p.flight.good++; }
    if (p.landT === p.tick && p.flight) {
      if (p.tick - p.flight.t0 > 25) {
        const sync = p.flight.all > 8 ? p.flight.good / p.flight.all : 1;
        ch.q = p.landQ; ch.sync = sync; ch.evT = p.tick;
        if (p.landQ >= 0.97 && sync >= 0.6) {
          ch.n = Math.min(CHAIN_MAX, ch.n + 1); ch.ev = 'clean';
          const k = 1 + 0.012 * ch.n;
          p.vel[0] *= k; p.vel[1] *= k; p.vel[2] *= k;
        } else if (p.landQ < 0.9) { ch.n = 0; ch.ev = 'dirty'; }
        else ch.ev = 'ok';
        ch.best = Math.max(ch.best, ch.n);
      }
      p.flight = null;
    }
    p.wasSurf = surf;
    if (g > 0 && !surf && ch.n > 0) {
      const hs = Math.hypot(p.vel[0], p.vel[2]);
      const extra = Math.max(0, hs - hs0) * 0.3 * ch.n;
      if (hs > 1) { p.vel[0] += p.vel[0] / hs * extra; p.vel[2] += p.vel[2] / hs * extra; }
    }
  }
  function walkMove(world, p, dt) {
    const start = p.pos.slice(), sv = p.vel.slice();
    slideMove(world, p, dt);
    const downPos = p.pos, downVel = p.vel;
    // try a step-up version (18u)
    p.pos = start; p.vel = sv;
    const up = trace(world, p.pos, add(p.pos, [0, 18, 0]));
    p.pos = up.end;
    slideMove(world, p, dt);
    const dn = trace(world, p.pos, add(p.pos, [0, -18 - (up.end[1] - start[1]) + 0, 0]));
    if (dn.fraction < 1 && dn.plane && dn.plane[1] >= 0.7 && !dn.startsolid) p.pos = dn.end;
    const d1 = (downPos[0] - start[0]) ** 2 + (downPos[2] - start[2]) ** 2;
    const d2 = (p.pos[0] - start[0]) ** 2 + (p.pos[2] - start[2]) ** 2;
    if (d1 >= d2 || !(dn.fraction < 1 && dn.plane && dn.plane[1] >= 0.7)) { p.pos = downPos; p.vel = downVel; }
    else { p.vel[0] = sv[0] === 0 ? p.vel[0] : p.vel[0]; p.vel[1] = downVel[1]; }
    // stay on ground
    const st = trace(world, p.pos, add(p.pos, [0, -18, 0]));
    if (st.fraction > 0 && st.fraction < 1 && !st.startsolid && st.plane && st.plane[1] >= 0.7) p.pos = st.end;
  }

  // ---------- maps ----------
  // Ramp spec: len, drop (negative = uphill), b (half base), ang (deg), turn (banked curve along
  // the ramp, deg), gap (air distance before it), air (deg the rider must turn in that flight),
  // side (+1 ride the right slope / -1 the left), ring (u/s added mid-flight).
  const deg = Math.PI / 180;
  const FD = 0.3;          // the reference rider lands this far (share of ramp height) below the ridge
  // Stages are laid out by simulation against an expert rider. Each flight is designed first
  // (distance, how far to turn in the air), the expert flies it, and the next ramp is put where
  // the expert arrives, near the top of the slope. A slower or straighter rider arrives lower
  // or off to the side and misses. If even the expert cannot ride a ramp, that piece is eased.
  function buildStage(st) {
    const brushes = [], path = [], rings = [];
    const world = { brushes };
    const ramps = st.ramps;
    const cfg = Object.assign({}, BASE);
    let yaw = 0, spawn, spawnYaw = 0, startZone, ok = true, eased = 0;
    const TP = 0.6, MARGIN = 30;
    const segFor = (R0, yaw, r, side, o, tanA) => {
      const f = fwdOf(yaw), rv = rightOf(yaw);
      const a = add(add(R0, mul(rv, o)), [0, -(Math.abs(o) * tanA) + 64, 0]);
      return { a, b: add(add(a, mul(f, r.len)), [0, -r.drop, 0]), side, yaw, len: r.len, bw: r.b, h: r.b * tanA, air: 0 };
    };
    // a ramp with `turn` is a chain of mitred prisms, banked: the high side is outside the bend
    const addRamp = (R0, yaw0, r, side, o, tanA, h, taper, out) => {
      const turn = -Math.abs(r.turn || 0) * deg * side;
      const k = Math.max(1, Math.ceil(Math.abs(turn) / (2 * deg)));
      const L = r.len / k, D = r.drop / k, dy = turn / k;
      let Rk = R0, yk = yaw0;
      for (let j = 0; j < k; j++) {
        const sm = j > 0 ? norm(add(fwdOf(yk - dy), fwdOf(yk))) : null;
        const em = j < k - 1 ? norm(add(fwdOf(yk), fwdOf(yk + dy))) : null;
        const br = rampBrush(Rk, yk, L, D, r.b, h, j === 0 ? taper / h : 0, sm, em);
        br.side = side; out.brushes.push(br);
        out.path.push(segFor(Rk, yk, Object.assign({}, r, { len: L, drop: D }), side, o, tanA));
        Rk = add(add(Rk, mul(fwdOf(yk), L)), [0, -D, 0]);
        yk += dy;
      }
      out.yaw = yk - dy;
    };
    const commit = out => { out.brushes.forEach(b => brushes.push(b)); out.path.forEach(sg => path.push(sg)); yaw = out.yaw; };
    // first ramp + spawn platform
    const r0 = ramps[0], t0 = Math.tan((r0.ang || 60) * deg), s0 = r0.side || 1, o0 = s0 * r0.b * 0.4;
    const P0 = [0, 0, -500];
    const R00 = add(add(P0, mul(rightOf(0), -o0)), [0, Math.abs(o0) * t0 - 100, 0]);
    { const out = { brushes: [], path: [] }; addRamp(R00, 0, r0, s0, o0, t0, r0.b * t0, 0, out); commit(out); }
    {
      const top = P0[1] + 16, c = add(P0, mul(fwdOf(0), -260));
      brushes.push(yawBox([c[0], top - 24, c[2]], 0, 190, 24, 230, 'plat'));
      spawn = [c[0], top + 37, c[2]];
      startZone = { c: [c[0], top + 90, c[2]], yaw: 0, hx: 190, hy: 90, hz: 230 };
    }
    // the reference rider
    const p = newPlayer(spawn, 0);
    const bot = { seg: 0 };
    let hist = [], ringCd = {};
    const snapshot = () => JSON.stringify({ p, bot, ringCd, hl: hist.length });
    const restore = js => { const o = JSON.parse(js); Object.keys(p).forEach(k => delete p[k]); Object.assign(p, o.p); Object.keys(bot).forEach(k => delete bot[k]); Object.assign(bot, o.bot); ringCd = o.ringCd; hist.length = o.hl; };
    const tickOnce = () => { step(world, p, botCmdPath(p, path, bot), cfg); applyRings(p, rings, ringCd, 0); hist.push(p.pos.slice()); };
    // fly until `dist` units (horizontal) past the point where the rider left the last ramp
    const simFlight = (dist) => {
      const last = path[path.length - 1], f = fwdOf(last.yaw);
      let exit = null;
      for (let t = 0; t < 3000; t++) {
        tickOnce();
        const surf = p.tick - p.touchT < 3;
        if (!exit && !surf && dot(sub(p.pos, last.b), f) > -400) exit = p.pos.slice();
        if (exit && surf) exit = null;                       // touched again: not airborne yet
        if (exit && Math.hypot(p.pos[0] - exit[0], p.pos[2] - exit[2]) >= dist) return { pos: p.pos.slice(), vel: p.vel.slice() };
        if (p.pos[1] < last.b[1] - last.h - 2500) break;
      }
      return null;
    };
    // ride the newest ramp to its end; false if the rider falls off it
    const rideThrough = (startSeg) => {
      const last = path[path.length - 1], f = fwdOf(last.yaw), first = path[startSeg];
      const floor = Math.min(first.a[1] - first.h, last.b[1] - last.h) - 250;
      let touched = false;
      for (let t = 0; t < 4000; t++) {
        tickOnce();
        if (p.tick - p.touchT < 2 && bot.seg >= startSeg) touched = true;
        if (touched && dot(sub(p.pos, last.b), f) > 0) return true;
        if (CORE_DEBUG > 1 && t % 20 === 0) console.log('    ride', t, p.pos.map(Math.round).join(','), 'v', p.vel.map(Math.round).join(','), 'seg', bot.seg, '/', path.length, 'start', startSeg, 'touch', p.tick - p.touchT, 'floor', Math.round(floor), 'side', path[bot.seg].side);
        if (p.pos[1] < floor) return false;
      }
      return false;
    };
    for (let i = 1; i < ramps.length; i++) {
      const r0i = ramps[i];
      const snap = snapshot(), hist0 = hist.length, nRing = rings.length;
      let done = false;
      for (const e of [1, 0.85, 0.7, 0.55, 0.4, 0.25, 0.1]) {
        restore(snap); rings.length = nRing;
        const r = Object.assign({}, r0i, {
          gap: Math.max(300, (r0i.gap || 400) * e), air: (r0i.air || 0) * e, turn: (r0i.turn || 0) * e,
          drop: r0i.drop < 0 ? r0i.drop * e + 700 * (1 - e) : r0i.drop,
        });
        const tanA = Math.tan((r.ang || 60) * deg), h = r.b * tanA;
        const side = r.side || 1, o = side * r.b * FD;
        const taper = h * TP, sL = (1 - FD) * taper + 150;
        path[path.length - 1].air = r.air;
        if (r.ring) {
          const m = simFlight(r.gap * 0.5);
          if (m) rings.push({ c: m.pos, yaw: Math.atan2(-m.vel[0], -m.vel[2]), r: 240, power: r.ring });
          restore(snap);
        }
        const hit = simFlight(r.gap + sL);
        if (!hit) { if (CORE_DEBUG) console.log('  ramp', i, 'e', e, 'no hit'); continue; }
        const y = Math.atan2(-hit.vel[0], -hit.vel[2]);
        const f = fwdOf(y), rv = rightOf(y);
        let R0 = add(add(add(hit.pos, mul(f, -sL)), mul(rv, -o)), [0, FD * h - 64 - MARGIN + r.drop * sL / r.len, 0]);
        // the whole approach must pass above the slope
        let lower = 0;
        for (let q = hist0; q < hist.length; q++) {
          const hq = hist[q], sq = dot(sub(hq, R0), f);
          if (sq < 0 || sq > sL) continue;
          const surf = R0[1] - FD * h - r.drop * sq / r.len;
          lower = Math.max(lower, surf + 64 + 20 - hq[1]);
        }
        R0 = add(R0, [0, -lower, 0]);
        const out = { brushes: [], path: [] };
        addRamp(R0, y, r, side, o, tanA, h, taper, out);
        // never cut through the line already flown
        const tw = { brushes: out.brushes };
        let clash = false;
        for (let q = 1; q < hist.length && !clash; q++) { const t = trace(tw, hist[q - 1], hist[q]); if (t.fraction < 1 || t.startsolid) clash = true; }
        if (clash) { if (CORE_DEBUG) console.log('  ramp', i, 'e', e, 'clash'); continue; }
        const nb = brushes.length, np = path.length;
        commit(out);
        restore(snap);
        if (rideThrough(np)) { restore(snap); done = true; if (e < 1) eased++; break; }
        if (CORE_DEBUG) console.log('  ramp', i, 'e', e, 'ride fail', JSON.stringify({gap:Math.round(r.gap),air:Math.round(r.air),turn:Math.round(r.turn),drop:Math.round(r.drop),b:Math.round(r.b)}));
        brushes.length = nb; path.length = np;
        restore(snap);
      }
      if (!done) { ok = false; restore(snap); break; }
    }
    const exit = simFlight(700) || { pos: add(path[path.length - 1].b, mul(fwdOf(yaw), 700)), vel: mul(fwdOf(yaw), 1000) };
    const lr = ramps[ramps.length - 1];
    const gyaw = Math.atan2(-exit.vel[0], -exit.vel[2]);
    const gate = { c: add(exit.pos, [0, -150, 0]), yaw: gyaw, hx: lr.b + 500, hy: 900, hz: 160 };
    let minY = Infinity;
    brushes.forEach(b => { minY = Math.min(minY, b.min[1]); });
    return { brushes, path, rings, spawn, spawnYaw, startZone, gate, ok, eased, killY: Math.min(minY, gate.c[1] - gate.hy) - 500 };
  }
  function planOf(def) {
    if (def.stages) return { stages: def.stages.length };
    const t = Math.pow((def.tier - 1) / 9, 1.35);
    return { stages: def.stagesN || Math.round(3 + 3 * t) };
  }
  // Procedural stage specs from tier + seed. t runs 0 (tier 1) .. 1 (tier 10).
  function genStages(def) {
    let sd = def.seed >>> 0 || 1;
    const rnd = () => (sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296;
    // difficulty grows gently through the middle tiers and steeply at the top
    const t = Math.pow((def.tier - 1) / 9, 1.35), L = (a, b) => a + (b - a) * t, R = (a, b) => a + (b - a) * rnd();
    const stages = [];
    const nStages = def.stagesN || Math.round(L(3, 6)), nRamps = def.rampsN || Math.round(L(5, 8));
    for (let si = 0; si < nStages; si++) {
      const ramps = [];
      let side = rnd() < 0.5 ? 1 : -1;
      for (let i = 0; i < nRamps; i++) {
        const b = L(480, 170) * R(0.9, 1.1);
        let drop = L(1050, 760) * R(0.85, 1.15);
        if (i >= 2 && rnd() < L(0, 0.3)) drop = -L(150, 480) * R(0.7, 1);
        if (i > 0 && rnd() < L(0.25, 0.55)) side = -side;
        const r = { len: L(3800, 2900) * R(0.85, 1.15), drop, b, ang: R(58, 63), side,
          gap: L(420, 2100) * R(0.8, 1.15),
          air: (rnd() < 0.5 ? -1 : 1) * L(4, 48) * R(0.55, 1),
          turn: rnd() < L(0.4, 0.8) ? L(8, 50) * R(0.35, 1) : 0 };
        if (i > 0 && rnd() < L(0.25, 0.08)) r.ring = 260;
        ramps.push(r);
      }
      stages.push({ ramps });
    }
    return stages;
  }
  function bboxOf(stage) {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    const grow = v => { for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], v[i]); mx[i] = Math.max(mx[i], v[i]); } };
    stage.brushes.forEach(b => { grow(b.min); grow(b.max); });
    const g = stage.gate; grow([g.c[0] - g.hx - 200, g.c[1] - g.hy, g.c[2] - g.hx - 200]); grow([g.c[0] + g.hx + 200, g.c[1] + g.hy, g.c[2] + g.hx + 200]);
    return { mn, mx };
  }
  function translateStage(s, d) {
    const T = v => [v[0] + d[0], v[1] + d[1], v[2] + d[2]];
    s.brushes = s.brushes.map(b => translateBrush(b, d));
    s.path.forEach(p => { p.a = T(p.a); p.b = T(p.b); });
    s.rings.forEach(r => { r.c = T(r.c); });
    s.spawn = T(s.spawn); s.startZone.c = T(s.startZone.c); s.gate.c = T(s.gate.c);
    s.killY += d[1];
  }
  function buildMap(def) {
    const stages = [];
    let cursorX = 0;
    (def.stages || genStages(def)).forEach((sd, si) => {
      const s = buildStage(sd);
      const bb = bboxOf(s);
      const dx = si === 0 ? 0 : cursorX - bb.mn[0] + 2600;
      const dy = (sd.y || 0) - si * 300;
      translateStage(s, [dx, dy, 0]);
      s.bb = bboxOf(s);
      const bb2 = bboxOf(s);
      cursorX = bb2.mx[0];
      s.index = si;
      stages.push(s);
    });
    const world = { brushes: [], stages, def };
    stages.forEach(s => s.brushes.forEach(b => { b.stage = s.index; world.brushes.push(b); }));
    return world;
  }

  // ---------- zones ----------
  function inYawBox(pos, z, pad) {
    const d = sub(pos, z.c);
    const f = fwdOf(z.yaw), r = rightOf(z.yaw);
    const lx = d[0] * r[0] + d[2] * r[2], lz = d[0] * f[0] + d[2] * f[2];
    return Math.abs(lx) <= z.hx + pad && Math.abs(d[1]) <= z.hy + HULL[1] && Math.abs(lz) <= z.hz + pad;
  }

  function applyRings(p, rings, cd, stage) {
    let hit = false;
    rings.forEach((rg, i) => {
      const key = stage + ':' + i;
      if ((cd[key] || 0) > p.tick) return;
      if (len(sub(p.pos, rg.c)) < rg.r) {
        const hs = Math.hypot(p.vel[0], p.vel[2]) || 1;
        p.vel[0] += p.vel[0] / hs * rg.power; p.vel[2] += p.vel[2] / hs * rg.power;
        cd[key] = p.tick + 100;
        hit = true;
      }
    });
    return hit;
  }
  // ---------- run state machine ----------
  // Handles start zone / stage gates / kill / rings. Returns events.
  function newRun(world, cfg) {
    const s0 = world.stages[0];
    const p = newPlayer(s0.spawn, s0.spawnYaw);
    p.boostLeft = cfg.boost;
    return { p, stage: 0, state: 'start', time: 0, splits: [], deaths: 0, ringCd: {}, maxSpeed: 0, finished: false };
  }
  function respawnStage(world, run, cfg) {
    const s = world.stages[run.stage];
    run.p.pos = s.spawn.slice(); run.p.vel = [0, 0, 0]; run.p.yaw = s.spawnYaw; run.p.onGround = false;
    run.p.boostLeft = cfg.boost;
    run.p.teleported = true;
    if (run.p.chain) run.p.chain.n = 0;
    run.p.flight = null;
    if (run.state === 'start') return;
  }
  function runTick(world, run, cmd, cfg) {
    const ev = [];
    const p = run.p;
    if (run.state === 'finished') { step(world, p, cmd, cfg); return ev; }
    step(world, p, cmd, cfg);
    const s = world.stages[run.stage];
    const sp = Math.hypot(p.vel[0], p.vel[2]);
    if (run.state === 'start') {
      if (!inYawBox(p.pos, s.startZone, 0)) {
        if (sp > cfg.prespeed) { p.vel[0] *= cfg.prespeed / sp; p.vel[2] *= cfg.prespeed / sp; }
        run.state = 'running'; run.time = 0; ev.push({ t: 'start' });
      }
    } else if (run.state === 'running') {
      run.time += TICK;
      if (sp > run.maxSpeed) run.maxSpeed = sp;
    }
    if (run.state === 'running' && run.stage > 0) {
      // nothing special at stage starts besides spawn zones (no prespeed games there)
    }
    if (applyRings(p, s.rings, run.ringCd, run.stage)) ev.push({ t: 'ring' });
    // gate
    if (inYawBox(p.pos, s.gate, HULL[0])) {
      if (run.state === 'running' || run.state === 'start') {
        run.splits[run.stage] = run.time;
        if (run.stage === world.stages.length - 1) {
          run.state = 'finished'; run.finished = true;
          ev.push({ t: 'finish', time: run.time });
          p.vel = mul(p.vel, 0.15);
        } else {
          run.stage++;
          if (run.state === 'start') run.state = 'running';
          respawnStage(world, run, cfg);
          ev.push({ t: 'stage', stage: run.stage, time: run.time });
        }
      }
    }
    if (p.pos[1] < s.killY) {
      run.deaths++;
      respawnStage(world, run, cfg);
      if (run.stage === 0) { run.state = 'start'; run.time = 0; run.splits = []; }
      ev.push({ t: 'fail' });
    }
    return ev;
  }

  // ---------- bots ----------
  // Expert: rides into the ramp along its line, and in each flight turns by the designed
  // amount (seg.air) using air strafes. Its behaviour never depends on ramps it has not reached,
  // so the build-time rider and a live replay are identical tick for tick.
  // Naive (style 'naive'): holds the key into the ramp, never moves the mouse.
  function newBot(style) { return { seg: 0, stage: -1, style: style || 'expert' }; }
  function botCmd(world, run, bot) {
    const s = world.stages[run.stage];
    if (bot.stage !== run.stage || run.p.teleported) { bot.stage = run.stage; bot.seg = 0; bot.rode = undefined; bot.fly = null; run.p.teleported = false; bot.yaw0 = s.spawnYaw; }
    return botCmdPath(run.p, s.path, bot);
  }
  function botCmdPath(p, path, bot) {
    let seg = path[bot.seg];
    const proj = (sg) => dot(sub(p.pos, sg.a), fwdOf(sg.yaw));
    while (bot.seg < path.length - 1 && proj(seg) > seg.len) { bot.seg++; seg = path[bot.seg]; }
    const tp = add(seg.a, mul(sub(seg.b, seg.a), (proj(seg) + 650) / seg.len));
    const to = sub(tp, p.pos);
    const cmd = { fwd: 0, side: 0, yaw: Math.atan2(-to[0], -to[2]), jump: false, boost: false };
    if (bot.style === 'naive') {
      cmd.yaw = bot.yaw0 || 0;
      if (p.onGround) { cmd.fwd = 1; return cmd; }
      cmd.side = -seg.side;
      return cmd;
    }
    if (p.onGround) { cmd.fwd = 1; cmd.yaw = seg.yaw; return cmd; }
    const touching = p.tick - p.touchT < 3;
    const pj = proj(seg);
    if (touching && pj > 0 && pj < seg.len) { bot.rode = bot.seg; bot.fly = null; }
    if (touching || (bot.rode === bot.seg && pj < seg.len)) {
      // hold the line: push into the ramp when below it, ease off when riding too high
      const lineY = seg.a[1] + (seg.b[1] - seg.a[1]) * Math.max(0, Math.min(1, pj / seg.len));
      cmd.side = p.pos[1] - lineY > seg.h * 0.12 ? 0 : -seg.side;
      return cmd;
    }
    const vy = Math.atan2(-p.vel[0], -p.vel[2]);
    cmd.yaw = vy;
    if (bot.rode === undefined) return cmd;
    if (!bot.fly || bot.fly.from !== bot.rode) bot.fly = { from: bot.rode, target: vy + (path[bot.rode].air || 0) * deg };
    let d = bot.fly.target - vy; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    if (Math.abs(d) > 1.5 * deg && Math.hypot(p.vel[0], p.vel[2]) > 100) cmd.side = d > 0 ? -1 : 1;
    return cmd;
  }

  return { TICK, HULL, EYE, BASE, PERKS, cfgFor, trace, step, newPlayer, buildMap, newRun, runTick, respawnStage,
    newBot, botCmd, botCmdPath, inYawBox, genStages, planOf, fwdOf, rightOf, len, sub, add, mul, dot, norm, deg };
})();
if (typeof module !== 'undefined') module.exports = CORE;
