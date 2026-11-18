// ============================================================
// RAMPLINE ninja: low-poly rig with procedural animation. Purely visual:
// it reads the player state and never writes anything back to physics.
// ============================================================
const NINJA = (() => {
  const T = THREE;
  const SUIT = '#14161d', SUIT2 = '#1f2330', WRAP = '#2a2f3d';

  function part(parent, w, h, d, color, x, y, z, outline = true) {
    const g = new T.BoxGeometry(w, h, d);
    const m = new T.Mesh(g, new T.MeshLambertMaterial({ color, flatShading: true }));
    m.position.set(x, y, z);
    parent.add(m);
    if (outline) {
      const o = new T.Mesh(g, OUTLINE);
      o.scale.setScalar(1.12); m.add(o);
    }
    return m;
  }
  const OUTLINE = new T.MeshBasicMaterial({ color: '#000000', side: T.BackSide });
  function joint(parent, x, y, z) { const j = new T.Group(); j.position.set(x, y, z); parent.add(j); return j; }

  function create(scene, accent) {
    const root = new T.Group();
    const body = new T.Group(); root.add(body);          // orientation (yaw + lean)
    const hips = joint(body, 0, 1, 0);
    part(hips, 17, 8, 10, SUIT, 0, 0, 0);
    const accentParts = [];
    const sash = part(hips, 18, 3, 11, accent, 0, 3, 0, false); accentParts.push(sash);
    const spine = joint(hips, 0, 4, 0);
    part(spine, 20, 20, 11, SUIT2, 0, 10, 0);
    part(spine, 16, 6, 12, WRAP, 0, 4, 0, false);
    // katana across the back
    const sword = joint(spine, 0, 12, 7);
    sword.rotation.z = 0.75;
    part(sword, 2.2, 34, 1.4, '#c9cfdb', 0, 6, 0, false);
    part(sword, 2.8, 9, 2.6, '#202020', 0, -15, 0, false);
    accentParts.push(part(sword, 6, 1.4, 4, accent, 0, -10.5, 0, false));
    const neck = joint(spine, 0, 20, 0);
    const head = part(neck, 12, 12, 12, SUIT, 0, 7, 0);
    accentParts.push(part(neck, 12.6, 2.6, 12.6, accent, 0, 9.5, 0, false));   // headband
    const visor = new T.Mesh(new T.BoxGeometry(9, 2, 1), new T.MeshBasicMaterial({ color: '#ffffff' }));
    visor.position.set(0, 7.5, -6.2); neck.add(visor);
    const arm = (sx) => {
      const sh = joint(spine, sx * 12.5, 18, 0);
      part(sh, 6, 14, 6, SUIT2, 0, -7, 0);
      const el = joint(sh, 0, -14, 0);
      part(el, 5, 13, 5, WRAP, 0, -6.5, 0);
      part(el, 5.5, 4, 5.5, SUIT, 0, -14, 0);
      return { sh, el };
    };
    const leg = (sx) => {
      const hp = joint(hips, sx * 5.5, -2, 0);
      part(hp, 7, 17, 7, SUIT2, 0, -8.5, 0);
      const kn = joint(hp, 0, -17, 0);
      part(kn, 6, 16, 6, WRAP, 0, -8, 0);
      part(kn, 6.5, 3, 11, SUIT, 0, -16.5, -2);
      return { hp, kn };
    };
    const L = { arm: arm(-1), leg: leg(-1) }, Rr = { arm: arm(1), leg: leg(1) };
    scene.add(root);

    // scarf: verlet chain from the back of the neck, drawn as a ribbon
    const N = 10, pts = [], prev = [];
    for (let i = 0; i < N; i++) { pts.push(new T.Vector3()); prev.push(new T.Vector3()); }
    const rg = new T.BufferGeometry();
    rg.setAttribute('position', new T.BufferAttribute(new Float32Array(N * 2 * 3), 3));
    const idx = []; for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    rg.setIndex(idx);
    const ribbon = new T.Mesh(rg, new T.MeshBasicMaterial({ color: accent, side: T.DoubleSide }));
    ribbon.frustumCulled = false;
    scene.add(ribbon);

    const n = {
      root, body, hips, spine, neck, head, L, R: Rr, sash, sword, ribbon, pts, prev, ready: false,
      ang: {}, phase: 0, land: 0, lastGround: true,
      visible(v) { root.visible = v; ribbon.visible = v; if (!v) n.ready = false; },
      setAccent(c) { accentParts.forEach(m => m.material.color.set(c)); ribbon.material.color.set(c); },
    };
    return n;
  }

  // Target pose per situation. Angle convention: +x swings a limb forward, knees (lkx/rkx)
  // and elbows (lex/rex) are bend amounts, shoulder z (lsz/rsz) is how far the arm is out.
  function pose(st, n, t) {
    const P = { lean: 0, roll: 0, hipsY: 0, spineX: 0, neckX: 0,
      lsx: 0, lsz: 0.12, lex: 0.2, rsx: 0, rsz: 0.12, rex: 0.2,
      lhx: 0, lkx: 0, rhx: 0, rkx: 0 };
    const sp = st.speed;
    if (st.onGround) {
      if (sp < 25) {                       // idle: low ready stance, breathing
        const b = Math.sin(t * 2.2) * 0.04;
        Object.assign(P, { spineX: 0.12 + b, lsx: 0.35, lex: 1.3, rsx: 0.2, rex: 1.5, lsz: 0.2, rsz: 0.25, lhx: 0.25, lkx: 0.45, rhx: -0.15, rkx: 0.3, hipsY: -2 });
      } else {                             // ninja run: torso forward, arms swept back
        const ph = n.phase, s = Math.sin(ph), c = Math.cos(ph);
        Object.assign(P, { lean: 0.6, spineX: 0.15, neckX: -0.5,
          lsx: -1.35, lsz: 0.2, lex: 0.15, rsx: -1.35, rsz: 0.2, rex: 0.15,
          lhx: 1.0 * s + 0.25, lkx: 0.5 + 0.9 * Math.max(0, -c), rhx: -1.0 * s + 0.25, rkx: 0.5 + 0.9 * Math.max(0, c) });
        P.hipsY = -Math.abs(c) * 3;
      }
    } else if (st.surf) {                  // surfing: crouched, leaning into the ramp, hand trailing on the slope
      const ramp = st.rampSide;            // -1 ramp on the left, +1 on the right
      const bob = Math.sin(t * 9) * 0.03 * Math.min(1, sp / 2000);
      Object.assign(P, { lean: 0.3, spineX: 0.4 + bob, neckX: -0.35, lhx: 1.0, lkx: 1.6, rhx: 0.35, rkx: 0.9, hipsY: -6 });
      if (ramp < 0) { P.lsx = -0.3; P.lsz = 1.35; P.lex = 0.15; P.rsx = 0.7; P.rsz = 0.8; P.rex = 0.6; }
      else { P.rsx = -0.3; P.rsz = 1.35; P.rex = 0.15; P.lsx = 0.7; P.lsz = 0.8; P.lex = 0.6; }
    } else if (st.dash) {                  // ring / overdrive: superman dash
      Object.assign(P, { lean: 1.3, spineX: 0.05, neckX: -0.95, lsx: 2.8, lsz: 0.15, lex: 0, rsx: -1.2, rsz: 0.3, rex: 0.2, lhx: -0.25, lkx: 0.3, rhx: -0.1, rkx: 0.5 });
    } else if (st.vy > 80 && st.sinceGround < 0.6) {  // jump: tuck
      Object.assign(P, { spineX: 0.3, lsx: -0.7, lsz: 0.9, lex: 1.0, rsx: -0.7, rsz: 0.9, rex: 1.0, lhx: 1.3, lkx: 2.0, rhx: 0.95, rkx: 1.7 });
    } else if (st.vy < -1100) {             // free fall: skydiver spread
      const w = Math.sin(t * 7) * 0.08;
      Object.assign(P, { lean: 1.15, spineX: -0.15, neckX: -0.7, lsx: 0.3, lsz: 1.45 + w, lex: 0.5, rsx: 0.3, rsz: 1.45 - w, rex: 0.5, lhx: -0.2, lkx: 0.7, rhx: -0.2, rkx: 0.7 });
    } else {                               // air strafe: glide, lean into the strafe
      const s = st.side;
      Object.assign(P, { lean: 0.8, spineX: 0.2, neckX: -0.65, roll: -s * 0.5,
        lsx: -0.5, lsz: 1.15 + (s < 0 ? 0.35 : 0), lex: 0.15, rsx: -0.5, rsz: 1.15 + (s > 0 ? 0.35 : 0), rex: 0.15,
        lhx: -0.35, lkx: 0.5, rhx: 0.15, rkx: 1.1 });
    }
    if (n.land > 0) { const k = n.land; P.lkx += 1.2 * k; P.rkx += 1.2 * k; P.lhx += 1.0 * k; P.rhx += 1.0 * k; P.hipsY -= 10 * k; P.spineX += 0.4 * k; }
    return P;
  }

  const tmpQ = new T.Quaternion(), tmpQ2 = new T.Quaternion(), up = new T.Vector3(0, 1, 0), e = new T.Euler();
  // st: {pos, vel, onGround, surfN, side, viewYaw, dt, t, dash}
  function update(n, st) {
    const dt = Math.min(0.05, st.dt);
    const hs = Math.hypot(st.vel[0], st.vel[2]);
    st.speed = hs; st.vy = st.vel[1];
    if (st.onGround && !n.lastGround) n.land = Math.min(1, 0.4 + Math.abs(n.lastVy || 0) / 1400);
    n.lastGround = st.onGround; n.lastVy = st.vel[1];
    n.sinceGround = st.onGround ? 0 : (n.sinceGround || 0) + dt; st.sinceGround = n.sinceGround;
    n.land = Math.max(0, n.land - dt * 4);
    if (st.onGround) n.phase += hs * dt / 26;
    st.rampSide = 0;
    if (st.surfN) {
      const yaw = hs > 30 ? Math.atan2(-st.vel[0], -st.vel[2]) : st.viewYaw;
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      st.rampSide = (st.surfN[0] * rx + st.surfN[2] * rz) > 0 ? -1 : 1;   // normal points away from the ramp
      st.surf = true;
    }
    const P = pose(st, n, st.t);
    const a = n.ang, k = 1 - Math.exp(-dt * (st.surf ? 14 : 11));
    for (const key in P) a[key] = a[key] === undefined ? P[key] : a[key] + (P[key] - a[key]) * k;

    // body orientation: face velocity, align up with the ramp normal while surfing
    const yaw = hs > 40 ? Math.atan2(-st.vel[0], -st.vel[2]) : st.viewYaw;
    let dy = yaw - (n.yaw === undefined ? yaw : n.yaw); while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    n.yaw = (n.yaw === undefined ? yaw : n.yaw) + dy * (1 - Math.exp(-dt * 12));
    const tu = new T.Vector3(0, 1, 0);
    if (st.surfN) tu.set(st.surfN[0], st.surfN[1], st.surfN[2]).lerp(up, 0.25).normalize();
    n.up = n.up ? n.up.lerp(tu, 1 - Math.exp(-dt * 10)).normalize() : tu.clone();
    tmpQ.setFromUnitVectors(up, n.up);
    tmpQ2.setFromEuler(e.set(-a.lean, n.yaw, a.roll, 'YXZ'));
    n.body.quaternion.copy(tmpQ).multiply(tmpQ2);
    n.root.position.set(st.pos[0], st.pos[1], st.pos[2]);
    n.hips.position.y = 1 + a.hipsY;
    n.spine.rotation.x = -a.spineX; n.neck.rotation.x = -a.neckX;
    // a hanging limb rotated by +x swings toward -z, where the ninja faces; knees bend the other way
    n.L.arm.sh.rotation.set(a.lsx, 0, -a.lsz); n.L.arm.el.rotation.x = a.lex;
    n.R.arm.sh.rotation.set(a.rsx, 0, a.rsz); n.R.arm.el.rotation.x = a.rex;
    n.L.leg.hp.rotation.x = a.lhx; n.L.leg.kn.rotation.x = -a.lkx;
    n.R.leg.hp.rotation.x = a.rhx; n.R.leg.kn.rotation.x = -a.rkx;

    // scarf
    n.root.updateMatrixWorld(true);
    const anchor = new T.Vector3(0, 6, 6).applyMatrix4(n.neck.matrixWorld);
    const pts = n.pts, prev = n.prev, N = pts.length;
    if (!n.ready) { for (let i = 0; i < N; i++) { pts[i].copy(anchor); prev[i].copy(anchor); } n.ready = true; }
    const seg = 4.2 + Math.min(4, hs / 900);
    const vel = new T.Vector3(st.vel[0], st.vel[1], st.vel[2]);
    pts[0].copy(anchor); prev[0].copy(anchor);
    for (let i = 1; i < N; i++) {
      const p = pts[i], q = prev[i];
      const v = p.clone().sub(q).multiplyScalar(0.86);
      q.copy(p);
      // air drag pulls the cloth toward the rider's frame
      v.add(vel.clone().multiplyScalar(-dt * 0.12));
      v.y -= 120 * dt * dt;
      v.x += Math.sin(st.t * 13 + i) * 0.25; v.z += Math.cos(st.t * 11 + i * 1.3) * 0.25;
      p.add(v);
    }
    for (let it = 0; it < 3; it++) for (let i = 1; i < N; i++) {
      const a0 = pts[i - 1], b0 = pts[i], d = b0.clone().sub(a0), l = d.length() || 1;
      b0.copy(a0).add(d.multiplyScalar(seg / l));
    }
    // follow the rider (teleports / big moves)
    if (pts[N - 1].distanceTo(anchor) > seg * N * 2) n.ready = false;
    const arr = n.ribbon.geometry.attributes.position.array;
    const cam = st.camPos ? new T.Vector3(st.camPos[0], st.camPos[1], st.camPos[2]) : anchor.clone().add(new T.Vector3(0, 100, 100));
    for (let i = 0; i < N; i++) {
      const dir = (i < N - 1 ? pts[i + 1].clone().sub(pts[i]) : pts[i].clone().sub(pts[i - 1])).normalize();
      const side = dir.clone().cross(cam.clone().sub(pts[i])).normalize().multiplyScalar(2.6 * (1 - i / N * 0.6));
      arr[i * 6] = pts[i].x + side.x; arr[i * 6 + 1] = pts[i].y + side.y; arr[i * 6 + 2] = pts[i].z + side.z;
      arr[i * 6 + 3] = pts[i].x - side.x; arr[i * 6 + 4] = pts[i].y - side.y; arr[i * 6 + 5] = pts[i].z - side.z;
    }
    n.ribbon.geometry.attributes.position.needsUpdate = true;
  }
  return { create, update };
})();
