// ============================================================
// RAMPLINE renderer (three.js r149)
// ============================================================
const GFX = (() => {
  const T = THREE;
  const col = h => new T.Color(h);
  let renderer, scene, camera, overlayScene, overlayCam, speedFx;
  let sky, dust, world3 = null, theme = null;
  const avatars = [];

  function init(canvas) {
    renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.autoClear = false;
    scene = new T.Scene();
    // lights only touch the ninja (every world material is a custom shader)
    scene.add(new T.HemisphereLight('#dfe8ff', '#2a2230', 0.9));
    const key = new T.DirectionalLight('#ffffff', 0.9); key.position.set(0.4, 1, 0.3); scene.add(key);
    camera = new T.PerspectiveCamera(75, 1, 2, 160000);
    camera.rotation.order = 'YXZ';
    overlayScene = new T.Scene();
    overlayCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    speedFx = new T.Mesh(new T.PlaneGeometry(2, 2), new T.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false, blending: T.AdditiveBlending,
      uniforms: { uT: { value: 0 }, uAmt: { value: 0 }, uAsp: { value: 1 }, uCol: { value: col('#ffffff') } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
      fragmentShader: `
        varying vec2 vUv; uniform float uT, uAmt, uAsp; uniform vec3 uCol;
        float h(float n){ return fract(sin(n*91.345)*47453.21); }
        void main(){
          vec2 p = (vUv - 0.5) * vec2(uAsp, 1.);
          float r = length(p), a = atan(p.y, p.x);
          float k = floor(a * 110.);
          float sp = h(k) * 0.8 + 0.4;
          float s = fract(h(k + 7.) - uT * sp * 1.6 + r * 0.6);
          float line = smoothstep(0.965, 1.0, s) * step(0.6, h(k + 3.));
          float mask = smoothstep(0.42, 0.95, r);
          gl_FragColor = vec4(uCol * line * mask * uAmt * 0.32, 1.);
        }`
    }));
    overlayScene.add(speedFx);
    // sky dome
    sky = new T.Mesh(new T.SphereGeometry(120000, 48, 24), new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false, fog: false,
      uniforms: { uTop: { value: col('#000') }, uHor: { value: col('#000') }, uBot: { value: col('#000') }, uSun: { value: new T.Vector3(0, .3, -1) }, uSunCol: { value: col('#fff') }, uStars: { value: 0 }, uAur: { value: 0 }, uAurCol: { value: col('#4dffb0') }, uT: { value: 0 } },
      vertexShader: 'varying vec3 vD; void main(){ vD = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position = p.xyww; }',
      fragmentShader: `
        varying vec3 vD; uniform vec3 uTop, uHor, uBot, uSun, uSunCol, uAurCol; uniform float uStars, uAur, uT;
        float hash(vec3 p){ p = fract(p * 0.3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        void main(){
          vec3 d = normalize(vD); float y = d.y;
          vec3 c = y > 0. ? mix(uHor, uTop, pow(clamp(y, 0., 1.), 0.55)) : mix(uHor, uBot, pow(clamp(-y, 0., 1.), 0.45));
          float s = max(dot(d, normalize(uSun)), 0.);
          c += uSunCol * (smoothstep(0.9993, 0.9996, s) * 1.6 + pow(s, 40.) * 0.22 + pow(s, 4.) * 0.06);
          vec3 q = d * 420.; vec3 cell = floor(q);
          float st = hash(cell); float tw = 0.6 + 0.4 * sin(uT * 2. + st * 40.);
          float star = smoothstep(0.9975, 1.0, st) * smoothstep(0.55, 0.0, length(fract(q) - 0.5)) * tw;
          c += vec3(star) * uStars * smoothstep(0.0, 0.25, y);
          if (uAur > 0.) {
            float band = sin(d.x * 5.0 + sin(d.z * 3.0 + uT * 0.15) * 2.0 + uT * 0.05);
            float a = smoothstep(0.55, 1.0, band) * smoothstep(0.06, 0.25, y) * smoothstep(0.75, 0.3, y);
            float fl = 0.6 + 0.4 * sin(d.z * 40. + uT * 0.8);
            c += uAurCol * a * fl * uAur;
          }
          gl_FragColor = vec4(c, 1.);
        }`
    }));
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    scene.add(sky);
    // dust that wraps around the camera: gives parallax at speed
    const N = 2200, pos = new Float32Array(N * 3);
    for (let i = 0; i < N * 3; i++) pos[i] = Math.random() * 6000;
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3));
    dust = new T.Points(g, new T.ShaderMaterial({
      transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      uniforms: { uCam: { value: new T.Vector3() }, uCol: { value: col('#fff') }, uPx: { value: 1 } },
      vertexShader: `uniform vec3 uCam; uniform float uPx; varying float vA;
        void main(){ vec3 p = mod(position - uCam + 3000., 6000.) - 3000. + uCam;
          vec4 mv = modelViewMatrix * vec4(p, 1.); float d = -mv.z;
          vA = smoothstep(3000., 600., d) * smoothstep(40., 200., d);
          gl_PointSize = clamp(2600. / d, 1., 5.) * uPx; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uCol; varying float vA;
        void main(){ float r = length(gl_PointCoord - .5); gl_FragColor = vec4(uCol, (1. - smoothstep(.2, .5, r)) * vA * .55); }`
    }));
    dust.frustumCulled = false;
    scene.add(dust);
  }

  const surfaceVS = `
    attribute float aH; attribute float aK;
    varying vec3 vW; varying vec3 vN; varying float vH; varying float vK;
    void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vN = normal; vH = aH; vK = aK;
      gl_Position = projectionMatrix * viewMatrix * w; }`;
  const surfaceFS = `
    uniform vec3 uA, uB, uEdge, uFog, uSun, uCam; uniform float uFogD, uGrid;
    varying vec3 vW; varying vec3 vN; varying float vH; varying float vK;
    float gl1(float x, float s){ float v = x / s; return 1. - min(abs(fract(v - .5) - .5) / fwidth(v), 1.); }
    void main(){
      vec3 n = normalize(vN); vec3 an = abs(n);
      vec2 uv = an.y > 0.75 ? vW.xz : (an.x > an.z ? vW.zy : vW.xy);
      float grid = max(gl1(uv.x, 256.), gl1(uv.y, 256.)) + 0.35 * max(gl1(uv.x, 64.), gl1(uv.y, 64.));
      vec3 base;
      if (vK < 0.5) {            // surf ramp: gradient ridge -> base, height bands to read your line
        base = mix(uB, uA, smoothstep(0.0, 1.0, vH));
        float band = gl1(vH * 1000., 100.);
        base += uEdge * band * 0.18;
        float ridge = smoothstep(0.985, 1.0, vH);
        base += uEdge * ridge * 0.8;
        if (n.y < -0.2) base *= 0.35;
      } else if (vK < 1.5) {     // platform
        base = mix(uA * 0.3, uB * 0.45, 0.5);
      } else {                   // floor
        base = uB * 0.12;
      }
      vec3 V = normalize(uCam - vW);
      float diff = max(dot(n, normalize(uSun)), 0.);
      vec3 c = base * (0.52 + 0.55 * diff + 0.12 * n.y);
      float fres = pow(1. - abs(dot(n, V)), 3.);
      c += uEdge * fres * 0.25;
      float d = length(uCam - vW);
      c += uEdge * grid * uGrid * smoothstep(9000., 600., d);
      float f = 1. - exp(-pow(d * uFogD, 1.6));
      gl_FragColor = vec4(mix(c, uFog, clamp(f, 0., 1.)), 1.);
    }`;

  function rng(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }

  function load(world, def) {
    unload();
    theme = def.theme;
    const th = theme, g = new T.Group();
    world3 = { group: g, gates: [], rings: [], zones: [], mats: [] };
    sky.material.uniforms.uTop.value.set(th.sky[0]);
    sky.material.uniforms.uHor.value.set(th.sky[1]);
    sky.material.uniforms.uBot.value.set(th.fog);
    sky.material.uniforms.uSun.value.set(th.sun[0], th.sun[1], th.sun[2]);
    sky.material.uniforms.uSunCol.value.set(th.sky[2]);
    const dark = col(th.sky[0]).getHSL({}).l < 0.12;
    sky.material.uniforms.uStars.value = dark ? 1 : 0;
    sky.material.uniforms.uAur.value = th.deco === 'crystals' ? 0.55 : 0;
    sky.material.uniforms.uAurCol.value.set(th.edge);
    dust.material.uniforms.uCol.value.set(dark ? th.edge : '#ffffff');
    speedFx.material.uniforms.uCol.value.set(th.edge);
    scene.add(g);

    // ----- brushes -----
    const P = [], N = [], H = [], K = [], E = [];
    let minY = Infinity, bb = new T.Box3();
    world.brushes.forEach(b => {
      const k = b.kind === 'ramp' ? 0 : 1;
      const rp = b.ramp;
      const hOf = v => {
        if (!rp) return 0.5;
        const f = CORE.fwdOf(rp.yaw);
        const s = (v[0] - rp.R0[0]) * f[0] + (v[2] - rp.R0[2]) * f[2];
        const ry = rp.R0[1] - rp.drop * s / rp.length;
        return Math.max(0, Math.min(1, 1 - (ry - v[1]) / rp.h));
      };
      b.polys.forEach((poly, i) => {
        const n = b.faceN[i];
        for (let j = 1; j < poly.length - 1; j++) for (const v of [poly[0], poly[j], poly[j + 1]]) {
          P.push(v[0], v[1], v[2]); N.push(n[0], n[1], n[2]); H.push(hOf(v)); K.push(k);
        }
        for (let j = 0; j < poly.length; j++) { const a = poly[j], c = poly[(j + 1) % poly.length]; E.push(a[0], a[1], a[2], c[0], c[1], c[2]); }
      });
      minY = Math.min(minY, b.min[1]);
      bb.expandByPoint(new T.Vector3(...b.min)); bb.expandByPoint(new T.Vector3(...b.max));
    });
    // void floor far below
    const fy = minY - 5000, cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2, R = 120000;
    for (const v of [[cx - R, fy, cz - R], [cx + R, fy, cz - R], [cx + R, fy, cz + R], [cx - R, fy, cz - R], [cx + R, fy, cz + R], [cx - R, fy, cz + R]]) { P.push(...v); N.push(0, 1, 0); H.push(0); K.push(2); }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(P, 3));
    geo.setAttribute('normal', new T.Float32BufferAttribute(N, 3));
    geo.setAttribute('aH', new T.Float32BufferAttribute(H, 1));
    geo.setAttribute('aK', new T.Float32BufferAttribute(K, 1));
    const mat = new T.ShaderMaterial({
      vertexShader: surfaceVS, fragmentShader: surfaceFS, side: T.DoubleSide, extensions: { derivatives: true },
      uniforms: { uA: { value: col(th.ramp[0]) }, uB: { value: col(th.ramp[1]) }, uEdge: { value: col(th.edge) }, uFog: { value: col(th.fog) },
        uSun: { value: new T.Vector3(th.sun[0], Math.max(0.35, th.sun[1] + 0.4), th.sun[2]) }, uCam: { value: new T.Vector3() }, uFogD: { value: 1 / 26000 }, uGrid: { value: th.grid } }
    });
    world3.mats.push(mat);
    const mesh = new T.Mesh(geo, mat); mesh.frustumCulled = false; g.add(mesh);
    const eg = new T.BufferGeometry(); eg.setAttribute('position', new T.Float32BufferAttribute(E, 3));
    const lines = new T.LineSegments(eg, new T.LineBasicMaterial({ color: th.edge, transparent: true, opacity: 0.85, fog: true }));
    g.add(lines);
    scene.fog = new T.FogExp2(th.fog, 1 / 30000);

    // ----- stage zones -----
    world.stages.forEach((s, si) => {
      const last = si === world.stages.length - 1;
      // start pad glow
      const z = s.startZone;
      const box = new T.Mesh(new T.BoxGeometry(z.hx * 2, z.hy * 2, z.hz * 2), new T.MeshBasicMaterial({ color: si === 0 ? '#46e3a0' : th.edge, transparent: true, opacity: 0.06, depthWrite: false, blending: T.AdditiveBlending }));
      box.position.set(...z.c); box.rotation.y = z.yaw; g.add(box);
      const bl = new T.LineSegments(new T.EdgesGeometry(box.geometry), new T.LineBasicMaterial({ color: si === 0 ? '#46e3a0' : th.edge, transparent: true, opacity: 0.6 }));
      bl.position.copy(box.position); bl.rotation.copy(box.rotation); g.add(bl);
      // gate
      const gt = s.gate;
      const gm = new T.ShaderMaterial({
        transparent: true, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending,
        uniforms: { uC: { value: col(last ? '#ffd36b' : th.edge) }, uT: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
        fragmentShader: `varying vec2 vUv; uniform vec3 uC; uniform float uT;
          void main(){ vec2 e = min(vUv, 1. - vUv); float edge = 1. - smoothstep(0.0, 0.02, min(e.x, e.y));
            float scan = smoothstep(0.85, 1., fract(vUv.y * 14. - uT * 0.9)) * 0.35;
            float body = 0.08 + scan * smoothstep(0., .3, e.y);
            gl_FragColor = vec4(uC * (body + edge * 1.4), 1.); }`
      });
      const gp = new T.Mesh(new T.PlaneGeometry(gt.hx * 2, gt.hy * 2), gm);
      gp.position.set(...gt.c); gp.rotation.y = gt.yaw; g.add(gp);
      world3.gates.push(gm);
      // rings
      s.rings.forEach(r => {
        const tm = new T.Mesh(new T.TorusGeometry(r.r, 12, 12, 64), new T.MeshBasicMaterial({ color: th.edge, transparent: true, opacity: 0.9, blending: T.AdditiveBlending, depthWrite: false }));
        tm.position.set(...r.c); tm.rotation.y = r.yaw; g.add(tm);
        const halo = new T.Mesh(new T.CircleGeometry(r.r - 10, 48), new T.MeshBasicMaterial({ color: th.edge, transparent: true, opacity: 0.07, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
        halo.position.copy(tm.position); halo.rotation.y = r.yaw; g.add(halo);
        world3.rings.push(tm);
      });
    });

    // ----- decor: silhouettes in the fog, per theme -----
    const rnd = rng(def.id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
    const dc = col(th.fog).lerp(col(th.ramp[1]), 0.22).lerp(col('#000'), 0.25);
    const dm = new T.MeshBasicMaterial({ color: dc, fog: true });
    const glow = new T.MeshBasicMaterial({ color: th.edge, transparent: true, opacity: 0.55, fog: true });
    const span = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) + 40000;
    const decoCount = 140;
    let shape;
    switch (th.deco) {
      case 'dunes': shape = new T.SphereGeometry(1, 16, 10); break;
      case 'reef': shape = new T.CylinderGeometry(0.5, 1, 1, 7); break;
      case 'spires': shape = new T.ConeGeometry(1, 1, 5); break;
      case 'crystals': shape = new T.OctahedronGeometry(1, 0); break;
      case 'monoliths': shape = new T.BoxGeometry(1, 1, 1); break;
      case 'helix': shape = new T.BoxGeometry(1, 1, 1); break;
      default: shape = new T.TorusGeometry(1, 0.06, 6, 48);
    }
    const inst = new T.InstancedMesh(shape, dm, decoCount);
    const m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), sc = new T.Vector3(), ps = new T.Vector3();
    // decor is scenery only: it must stay well clear of every stage's volume (it has no collision)
    const boxes = world.stages.map(s => s.bb || { mn: s.brushes.reduce((m, b) => m.map((v, k) => Math.min(v, b.min[k])), [Infinity, Infinity, Infinity]), mx: s.brushes.reduce((m, b) => m.map((v, k) => Math.max(v, b.max[k])), [-Infinity, -Infinity, -Infinity]) });
    const clear = (x, y, z, rad) => boxes.every(bx => {
      const dx = Math.max(bx.mn[0] - x, 0, x - bx.mx[0]), dy = Math.max(bx.mn[1] - 1500 - y, 0, y - bx.mx[1] - 1500), dz = Math.max(bx.mn[2] - z, 0, z - bx.mx[2]);
      return Math.hypot(dx, dy, dz) > rad + 3500;
    });
    let placed = 0;
    for (let tries = 0; tries < decoCount * 12 && placed < decoCount; tries++) {
      const i = placed;
      const a = rnd() * Math.PI * 2, r = 9000 + rnd() * span * 0.6;
      const x = cx + Math.cos(a) * r, zz = cz + Math.sin(a) * r;
      let w = 800 + rnd() * 2600, h = w * (1 + rnd() * 3), y = fy + h * 0.5 - rnd() * 2000;
      e.set(0, rnd() * 6.28, 0);
      if (th.deco === 'dunes') { h = w * 0.35; y = fy + h * 0.2; w *= 2.2; }
      if (th.deco === 'reef') { w *= 0.35; h *= 2.5; y = fy + h * 0.5; }
      if (th.deco === 'spires') { w *= 0.45; h *= 3.2; y = fy + h * 0.5; }
      if (th.deco === 'crystals') { h = w * 2.4; y = fy + h * 0.6 + rnd() * 4000; e.set(rnd() * 0.5, rnd() * 6.28, rnd() * 0.5); }
      if (th.deco === 'monoliths') { w *= 0.6; h = w * (4 + rnd() * 6); y = fy + h * 0.5 + rnd() * 3000; }
      if (th.deco === 'helix') { w *= 0.5; h = w * 0.5; y = fy + 3000 + i * 160 % 18000; e.set(0, i * 0.4, 0); }
      if (th.deco === 'rings') { w = 4000 + rnd() * 9000; h = w; y = fy + 6000 + rnd() * 18000; e.set(rnd() * 3, rnd() * 3, 0); }
      if (!clear(x, y, zz, Math.max(w, h) * (th.deco === 'rings' ? 1.05 : 0.75))) continue;
      ps.set(x, y, zz); q.setFromEuler(e); sc.set(w, h, w);
      m4.compose(ps, q, sc); inst.setMatrixAt(placed++, m4);
    }
    inst.count = placed;
    inst.frustumCulled = false; g.add(inst);
    if (th.deco === 'rings' || th.deco === 'crystals' || th.deco === 'monoliths') {
      const lines2 = new T.LineSegments(new T.EdgesGeometry(shape), new T.LineBasicMaterial({ color: th.edge, transparent: true, opacity: 0.35, fog: true }));
      const holder = new T.Group();
      for (let i = 0; i < placed; i += 3) { inst.getMatrixAt(i, m4); const l = lines2.clone(); l.applyMatrix4(m4); holder.add(l); }
      g.add(holder);
    }
    void glow;
  }
  function unload() {
    if (!world3) return;
    world3.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); });
    scene.remove(world3.group);
    world3 = null;
  }

  // ----- avatars (ghost, bot, third-person self) -----
  function makeAvatar(color, opacity, trailOnly) {
    const grp = new T.Group();
    const body = new T.Mesh(new T.CapsuleGeometry(16, 40, 4, 10), new T.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: T.AdditiveBlending }));
    grp.add(body);
    const edges = new T.LineSegments(new T.EdgesGeometry(new T.CapsuleGeometry(16, 40, 2, 6), 30), new T.LineBasicMaterial({ color, transparent: true, opacity: Math.min(1, opacity * 2) }));
    grp.add(edges);
    const TN = 90, tp = new Float32Array(TN * 3), ta = new Float32Array(TN);
    for (let i = 0; i < TN; i++) ta[i] = 1 - i / TN;
    const tg = new T.BufferGeometry(); tg.setAttribute('position', new T.BufferAttribute(tp, 3)); tg.setAttribute('aA', new T.BufferAttribute(ta, 1));
    const trail = new T.Line(tg, new T.ShaderMaterial({ transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      uniforms: { uC: { value: col(color) } },
      vertexShader: 'attribute float aA; varying float vA; void main(){ vA = aA; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: 'uniform vec3 uC; varying float vA; void main(){ gl_FragColor = vec4(uC * vA * vA, 1.); }' }));
    trail.frustumCulled = false;
    if (trailOnly) grp.scale.setScalar(0.0001);
    scene.add(grp); scene.add(trail);
    const av = { grp, trail, tp, filled: 0, last: null, setColor(c) { body.material.color.set(c); edges.material.color.set(c); trail.material.uniforms.uC.value.set(c); } };
    avatars.push(av);
    return av;
  }
  function placeAvatar(av, pos, visible) {
    av.grp.visible = visible; av.trail.visible = visible;
    if (!visible) { av.filled = 0; return; }
    av.grp.position.set(pos[0], pos[1], pos[2]);
    const tp = av.tp, n = tp.length / 3;
    if (av.last && (Math.abs(av.last[0] - pos[0]) + Math.abs(av.last[1] - pos[1]) + Math.abs(av.last[2] - pos[2]) > 2500)) av.filled = 0;
    tp.copyWithin(3, 0, tp.length - 3);
    tp[0] = pos[0]; tp[1] = pos[1] - 10; tp[2] = pos[2];
    av.filled = Math.min(n, av.filled + 1);
    for (let i = av.filled; i < n; i++) { tp[i * 3] = pos[0]; tp[i * 3 + 1] = pos[1] - 10; tp[i * 3 + 2] = pos[2]; }
    av.trail.geometry.attributes.position.needsUpdate = true;
    av.last = pos.slice();
  }

  let scaleK = 1;
  function setScale(k) { scaleK = k; renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * k); resize(); }
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    speedFx.material.uniforms.uAsp.value = w / h;
    dust.material.uniforms.uPx.value = renderer.getPixelRatio();
  }
  function setHFov(hdeg) {
    const v = 2 * Math.atan(Math.tan(hdeg * Math.PI / 360) / Math.max(camera.aspect, 0.5)) * 180 / Math.PI;
    camera.fov = Math.min(120, v); camera.updateProjectionMatrix();
  }
  function frame(t, cam, speed) {
    camera.position.set(cam.pos[0], cam.pos[1], cam.pos[2]);
    camera.rotation.set(cam.pitch, cam.yaw, cam.roll || 0);
    setHFov(cam.hfov);
    sky.position.copy(camera.position);
    sky.material.uniforms.uT.value = t;
    dust.material.uniforms.uCam.value.copy(camera.position);
    if (world3) {
      world3.mats.forEach(m => m.uniforms.uCam.value.copy(camera.position));
      world3.gates.forEach(m => { m.uniforms.uT.value = t; });
      world3.rings.forEach((r, i) => { r.rotation.z = t * 0.6 + i; });
    }
    const amt = Math.max(0, Math.min(1, (speed - 1300) / 2200));
    speedFx.material.uniforms.uAmt.value = amt;
    speedFx.material.uniforms.uT.value = t;
    renderer.clear();
    renderer.render(scene, camera);
    if (amt > 0.01) renderer.render(overlayScene, overlayCam);
  }
  return { init, load, resize, frame, makeAvatar, placeAvatar, setScale, scene: () => scene, scale: () => scaleK };
})();
