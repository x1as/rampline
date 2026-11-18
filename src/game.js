// ============================================================
// RAMPLINE game: input, loop, progression, shared leaderboard, UI
// ============================================================
(() => {
  const $ = s => document.querySelector(s);
  const C = CORE;
  const TIER_COL = ['', 'var(--t1)', 'var(--t2)', 'var(--t3)', 'var(--t4)', 'var(--t5)', 'var(--t6)', 'var(--t7)', 'var(--t8)', 'var(--t9)', 'var(--t10)'];
  const TIER_NAME = ['', 'Новичок', 'Лёгкий', 'Уверенный', 'Средний', 'Непростой', 'Сложный', 'Очень сложный', 'Хардкор', 'Безумие', 'Невозможный'];
  // map geometry version: a layout change starts fresh boards instead of mixing times
  const MAPV = ':v3:';
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = t => { if (t == null || !isFinite(t)) return '—'; const m = Math.floor(t / 60), s = t - m * 60; return (m ? m + ':' + (s < 10 ? '0' : '') : '') + s.toFixed(2); };
  const fmtT = t => { const m = Math.floor(t / 60), s = t - m * 60; return String(m).padStart(2, '0') + ':' + (s < 10 ? '0' : '') + s.toFixed(2); };
  const ago = ts => { if (!ts) return ''; const d = (Date.now() - ts) / 1000; if (d < 90) return 'только что'; if (d < 3600) return Math.round(d / 60) + ' мин'; if (d < 86400) return Math.round(d / 3600) + ' ч'; return Math.round(d / 86400) + ' дн'; };

  // ---------------- persistence ----------------
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('rampline:' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('rampline:' + k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } },
  };
  const DEF = { v: 1, callsign: '', credits: 0, perks: {}, perksOn: false, cleared: {}, pbs: {}, owned: ['white'], trail: 'white', updated: 0,
    settings: { sens: 2.0, fov: 100, vol: 0.5, roll: true, ghost: 'wr', fx: true } };
  const merge = (a, b) => { const o = JSON.parse(JSON.stringify(a)); if (b && typeof b === 'object') for (const k in b) o[k] = (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && o[k] && typeof o[k] === 'object') ? Object.assign({}, o[k], b[k]) : b[k]; return o; };
  let profile = merge(DEF, LS.get('profile', {}));
  const TRAILS = [
    { id: 'white', c: '#ffffff', cost: 0 }, { id: 'ember', c: '#ff8a3d', cost: 150 }, { id: 'mint', c: '#46e3a0', cost: 150 },
    { id: 'violet', c: '#b98aff', cost: 300 }, { id: 'gold', c: '#ffd36b', cost: 600 }, { id: 'crimson', c: '#ff3d6e', cost: 600 },
  ];

  // ---------------- shared leaderboard ("server") ----------------
  const Net = {
    mode: 'local', db: null, user: null, room: null, uid: null, runs: {}, peers: [], status: 'connecting', subs: new Set(), chain: Promise.resolve(),
    on(fn) { this.subs.add(fn); }, emit(what) { this.subs.forEach(f => f(what)); },
    async init() {
      const cl = window.claude;
      if (cl && cl.use) {
        try {
          const [db, user] = await Promise.all([cl.use('db'), cl.use('user')]);
          this.user = user;
          this.uid = user ? await user.id() : null;
          if (db && this.uid) { this.db = db; this.mode = 'live'; }
        } catch (e) { /* fall back to local */ }
        cl.use('room').then(room => {
          if (!room) return;
          this.room = room;
          room.onPeers(ch => { this.peers = ch.peers.slice(); this.emit('peers'); });
          this.presence();
        }).catch(() => {});
      }
      if (this.mode === 'live') {
        await this.loadProfile();
        let timer = setTimeout(() => { this.status = 'slow'; this.emit('status'); }, 10000);
        this.db.collection('runs').onSnapshot(snap => {
          clearTimeout(timer);
          const prev = this.runs;
          const next = {};
          snap.docs.forEach(d => { if (d.exists) next[d.id] = d.data(); });
          this.runs = next; this.status = 'live';
          this.announce(prev, next);
          this.emit('runs');
        }, err => { clearTimeout(timer); this.status = 'error'; this.emit('status'); console.warn('runs', err); });
      } else {
        this.status = 'offline';
        const mine = LS.get('localRuns', null);
        if (mine) this.runs = { me: mine };
        this.uid = 'me';
      }
      this.emit('status');
    },
    announce(prev, next) {
      if (!Object.keys(prev).length) return;
      MAPS.forEach(m => ['stock', 'open'].forEach(bd => {
        const a = this.board(m.id, bd, prev)[0], b = this.board(m.id, bd, next)[0];
        if (b && (!a || b.t < a.t - 1e-6) && b.uid !== this.uid) toast(`${b.name} взял WR на ${m.name} · ${fmt(b.t)}`, 'gold');
      }));
    },
    presence() { if (this.room) this.room.presence({ m: Game.mapId || '', s: Game.mode }).catch(() => {}); },
    online() { return this.peers.length || (this.room ? 1 : 0); },
    onlineOn(id) { return this.peers.filter(p => p.presence && p.presence.m === id && p.presence.s === 'play').length; },
    name(uid, row) {
      const n = (row && row.name) || '';
      if (n) return n;
      const p = this.profCache[uid];
      return (p && p.name) || 'Surfer';
    },
    profCache: {},
    async resolveNames(ids) {
      if (!this.user || !ids.length) return;
      try { const ps = await this.user.profiles(ids); let ch = false; for (const id in ps) { if (!this.profCache[id] || this.profCache[id].name !== ps[id].name) { this.profCache[id] = ps[id]; ch = true; } } if (ch) this.emit('names'); } catch (e) { /* names are optional */ }
    },
    board(mapId, bd, src) {
      const rows = [], all = src || this.runs;
      for (const uid in all) { const r = all[uid]; const e = r && r.b && r.b[mapId + MAPV + bd]; if (e && typeof e.t === 'number' && e.t > 1) rows.push({ uid: uid === 'me' ? this.uid : uid, name: this.name(uid, r), t: e.t, at: e.at || 0 }); }
      rows.sort((a, b) => a.t - b.t || a.at - b.at);
      return rows;
    },
    async submit(mapId, bd, t, splits, ghost) {
      const key = mapId + MAPV + bd;
      const mine = JSON.parse(JSON.stringify(this.runs[this.uid === 'me' ? 'me' : this.uid] || { b: {} }));
      mine.name = profile.callsign || '';
      mine.b = mine.b || {};
      const old = mine.b[key];
      if (old && old.t <= t) return;
      mine.b[key] = { t: +t.toFixed(3), at: Date.now(), s: splits.map(x => +x.toFixed(2)) };
      if (this.mode !== 'live') { this.runs = { me: mine }; LS.set('localRuns', mine); this.emit('runs'); return; }
      this.runs = Object.assign({}, this.runs, { [this.uid]: mine }); this.emit('runs');
      this.chain = this.chain.then(async () => {
        await this.db.doc('runs/' + this.uid).set(mine);
        if (ghost) await this.db.doc('runs/' + this.uid + '/ghosts/' + mapId + '-v3-' + bd).set({ t, d: ghost, at: Date.now() });
      }).catch(e => { console.warn('submit', e); toast('Рекорд не отправлен на сервер: ' + (e && e.code || 'ошибка сети'), 'bad'); });
    },
    async rename() {
      if (this.mode !== 'live') { const mine = this.runs.me; if (mine) { mine.name = profile.callsign; LS.set('localRuns', mine); } this.emit('runs'); return; }
      const mine = this.runs[this.uid];
      if (!mine) return;
      const nm = Object.assign({}, mine, { name: profile.callsign });
      this.runs = Object.assign({}, this.runs, { [this.uid]: nm }); this.emit('runs');
      this.chain = this.chain.then(() => this.db.doc('runs/' + this.uid).set(nm)).catch(() => {});
    },
    async ghost(mapId, bd, uid) {
      if (this.mode !== 'live') return LS.get('ghost:' + mapId + MAPV + bd, null);
      try { const s = await this.db.doc('runs/' + uid + '/ghosts/' + mapId + '-v3-' + bd).get(); return s.exists ? s.data() : null; } catch (e) { return null; }
    },
    async loadProfile() {
      try {
        const s = await this.db.doc('data/users/' + this.uid + '/profile').get();
        if (s.exists) { const r = s.data(); if ((r.updated || 0) > (profile.updated || 0)) profile = merge(DEF, r); }
      } catch (e) { /* keep local */ }
    },
    saveTimer: 0,
    saveProfile() {
      profile.updated = Date.now();
      LS.set('profile', profile);
      if (this.mode !== 'live') return;
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => { this.chain = this.chain.then(() => this.db.doc('data/users/' + this.uid + '/profile').set(JSON.parse(JSON.stringify(profile)))).catch(() => {}); }, 800);
    },
  };

  // ghost encoding: 20 Hz integer positions, delta-coded
  const encGhost = pts => { const o = []; let p = [0, 0, 0]; pts.forEach(q => { for (let i = 0; i < 3; i++) { o.push(q[i] - p[i]); } p = q; }); return o.join(','); };
  const decGhost = s => { const a = s.split(',').map(Number), o = []; let p = [0, 0, 0]; for (let i = 0; i + 2 < a.length; i += 3) { p = [p[0] + a[i], p[1] + a[i + 1], p[2] + a[i + 2]]; o.push(p); } return o; };

  // ---------------- audio ----------------
  // Everything is synthesised: layered wind, a slide hiss while surfing, soft bells through a reverb.
  const Sfx = {
    ctx: null, master: null, rev: null,
    start() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      try {
        const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3; comp.connect(ctx.destination);
        this.master = ctx.createGain(); this.master.gain.value = profile.settings.vol; this.master.connect(comp);
        // reverb from a generated impulse: decaying stereo noise
        const len = ctx.sampleRate * 2.4, ir = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
        this.rev = ctx.createConvolver(); this.rev.buffer = ir;
        const wet = ctx.createGain(); wet.gain.value = 0.32; this.rev.connect(wet); wet.connect(this.master);
        // pink-ish noise source
        const nb = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate), nd = nb.getChannelData(0);
        let b0 = 0, b1 = 0, b2 = 0;
        for (let i = 0; i < nd.length; i++) { const w = Math.random() * 2 - 1; b0 = 0.997 * b0 + w * 0.029; b1 = 0.985 * b1 + w * 0.032; b2 = 0.95 * b2 + w * 0.048; nd[i] = (b0 + b1 + b2 + w * 0.02) * 1.6; }
        this.noise = nb;
        const loop = () => { const s = ctx.createBufferSource(); s.buffer = nb; s.loop = true; s.loopStart = Math.random(); s.start(0, Math.random() * 2); return s; };
        // wind body + whistle, panned by strafe lean
        this.pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
        this.pan.connect(this.master);
        const w1 = loop(); this.windLP = ctx.createBiquadFilter(); this.windLP.type = 'lowpass'; this.windLP.frequency.value = 400;
        this.windG = ctx.createGain(); this.windG.gain.value = 0; w1.connect(this.windLP); this.windLP.connect(this.windG); this.windG.connect(this.pan);
        const w2 = loop(); this.whistle = ctx.createBiquadFilter(); this.whistle.type = 'bandpass'; this.whistle.Q.value = 6; this.whistle.frequency.value = 900;
        this.whistleG = ctx.createGain(); this.whistleG.gain.value = 0; w2.connect(this.whistle); this.whistle.connect(this.whistleG); this.whistleG.connect(this.pan);
        // ramp slide: airy hiss plus a low hum, only while touching a ramp
        const w3 = loop(); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2200;
        this.slideBP = ctx.createBiquadFilter(); this.slideBP.type = 'peaking'; this.slideBP.frequency.value = 3500; this.slideBP.gain.value = 6;
        this.slideG = ctx.createGain(); this.slideG.gain.value = 0; w3.connect(hp); hp.connect(this.slideBP); this.slideBP.connect(this.slideG); this.slideG.connect(this.pan);
        this.hum = ctx.createOscillator(); this.hum.type = 'sine'; this.hum.frequency.value = 52;
        this.humG = ctx.createGain(); this.humG.gain.value = 0; this.hum.connect(this.humG); this.humG.connect(this.master); this.hum.start();
      } catch (e) { this.ctx = null; }
    },
    vol(v) { if (this.master) this.master.gain.value = v; },
    update(speed, surfing, active, lean) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime, k = active ? Math.min(1, speed / 3600) : 0;
      this.windG.gain.setTargetAtTime(Math.pow(k, 1.3) * 0.55, t, 0.12);
      this.windLP.frequency.setTargetAtTime(250 + speed * 0.45, t, 0.15);
      this.whistleG.gain.setTargetAtTime(Math.max(0, k - 0.35) * 0.18, t, 0.2);
      this.whistle.frequency.setTargetAtTime(700 + speed * 0.35, t, 0.2);
      this.slideG.gain.setTargetAtTime(surfing && active ? 0.05 + k * 0.16 : 0, t, surfing ? 0.04 : 0.12);
      this.slideBP.frequency.setTargetAtTime(2800 + speed * 0.6, t, 0.1);
      this.humG.gain.setTargetAtTime(surfing && active ? 0.03 + k * 0.05 : 0, t, 0.08);
      this.hum.frequency.setTargetAtTime(46 + k * 30, t, 0.2);
      if (this.pan.pan) this.pan.pan.setTargetAtTime(Math.max(-0.6, Math.min(0.6, lean || 0)), t, 0.15);
    },
    bell(f, when = 0, g = 0.12, dur = 1.6) {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime + when;
      const car = ctx.createOscillator(), mod = ctx.createOscillator(), mg = ctx.createGain(), a = ctx.createGain();
      car.frequency.value = f; mod.frequency.value = f * 3.5;
      mg.gain.setValueAtTime(f * 2.2, t); mg.gain.exponentialRampToValueAtTime(f * 0.05, t + dur * 0.5);
      a.gain.setValueAtTime(0.0001, t); a.gain.exponentialRampToValueAtTime(g, t + 0.008); a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      mod.connect(mg); mg.connect(car.frequency); car.connect(a); a.connect(this.master); a.connect(this.rev);
      car.start(t); mod.start(t); car.stop(t + dur + 0.1); mod.stop(t + dur + 0.1);
    },
    burst(freq, q, dur, g, sweep, when = 0, pan = 0) {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime + when, s = ctx.createBufferSource(); s.buffer = this.noise;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q; bp.frequency.setValueAtTime(freq, t);
      if (sweep) bp.frequency.exponentialRampToValueAtTime(freq * sweep, t + dur);
      const a = ctx.createGain(); a.gain.setValueAtTime(0.0001, t); a.gain.exponentialRampToValueAtTime(g, t + dur * 0.25); a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      let out = a;
      if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; a.connect(p); out = p; }
      s.connect(bp); bp.connect(a); out.connect(this.master); out.connect(this.rev);
      s.start(t, Math.random() * 2); s.stop(t + dur + 0.05);
    },
    thump(g = 0.25) {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), a = ctx.createGain();
      o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
      a.gain.setValueAtTime(g, t); a.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(a); a.connect(this.master); o.start(t); o.stop(t + 0.25);
      this.burst(900, 0.8, 0.08, g * 0.25, 0.5);
    },
    PENTA: [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66],
    stage() { this.bell(659.25, 0, 0.1); this.bell(987.77, 0.11, 0.09); },
    start_() { this.burst(1200, 2, 0.18, 0.06, 1.8); },
    fail() { this.burst(600, 1.2, 0.6, 0.12, 0.2); this.thump(0.18); },
    ring() { this.burst(500, 1.5, 0.5, 0.14, 4); this.bell(1318.5, 0.08, 0.06, 1.2); },
    boost() { this.burst(300, 1.2, 0.6, 0.16, 6); },
    whoosh(side) { this.burst(1400, 1.4, 0.22, 0.035, 0.6, 0, side * 0.7); },
    land(q) { if (q > 0.93) this.burst(2600, 1.5, 0.25, 0.05, 0.5); else this.thump(0.12); },
    combo(lvl) { const f = this.PENTA[Math.min(this.PENTA.length - 1, lvl)]; this.bell(f, 0, 0.09, 1.3); if (lvl >= 6) this.bell(f * 1.5, 0.09, 0.07, 1.6); },
    step() { this.thump(0.05); },
    finish(wr) { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.bell(f, i * 0.1, 0.1, 1.8)); if (wr) [1318.5, 1567.98].forEach((f, i) => this.bell(f, 0.45 + i * 0.12, 0.09, 2.2)); },
  };

  // ---------------- input ----------------
  const keys = {};
  let mouseDX = 0, lastSide = 0, sideTimer = 0;
  const Input = { locked: false };
  const canvas = $('#gl');
  function lock() {
    Sfx.start();
    try {
      const p = canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { canvas.requestPointerLock(); } catch (e) { } });
    } catch (e) { try { canvas.requestPointerLock(); } catch (e2) { } }
  }
  document.addEventListener('pointerlockchange', () => {
    Input.locked = document.pointerLockElement === canvas;
    if (Game.mode === 'play') { $('#resume').hidden = Input.locked || !$('#finish').hidden || Game.menuOpen; Game.paused = !Input.locked; }
  });
  document.addEventListener('mousemove', e => {
    if (!Input.locked || Game.mode !== 'play') return;
    const k = profile.settings.sens * 0.022 * Math.PI / 180;
    Game.yaw -= e.movementX * k;
    Game.pitch = Math.max(-1.55, Math.min(1.55, Game.pitch - e.movementY * k));
    mouseDX += e.movementX;
  });
  window.addEventListener('keydown', e => {
    if (e.target && (e.target.tagName === 'INPUT')) return;
    if (Game.mode === 'play') {
      if (['Space', 'Tab', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'F1'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      keys[e.code] = true;
      if (e.code === 'KeyR') Game.restart();
      else if (e.code === 'KeyF') Game.back();
      else if (e.code === 'KeyE') Game.boostReq = true;
      else if (e.code === 'KeyV' || e.code === 'F1') { Game.third = !Game.third; profile.settings.third = Game.third; LS.set('profile', profile); }
      else if (e.code === 'KeyP') Game.togglePractice();
      else if (e.code === 'Digit1') Game.cpSave();
      else if (e.code === 'Digit2') Game.cpLoad();
      else if (e.code === 'Tab') showBigLb(true);
      else if (e.code === 'Enter' && !$('#finish').hidden) Game.restart();
    }
  });
  window.addEventListener('keyup', e => { keys[e.code] = false; if (e.code === 'Tab') showBigLb(false); });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; showBigLb(false); });
  canvas.addEventListener('mousedown', () => { if (Game.mode === 'play' && !Input.locked && $('#finish').hidden) lock(); });
  $('#resume').addEventListener('mousedown', () => lock());

  // ---------------- game ----------------
  const worlds = {};
  const getWorld = id => worlds[id] || (worlds[id] = C.buildMap(MAPS.find(m => m.id === id)));
  const Game = {
    mode: 'menu', mapId: null, def: null, world: null, run: null, cfg: null, board: 'stock', paused: false, menuOpen: false,
    yaw: 0, pitch: 0, third: false, practice: false, cp: null, boostReq: false,
    prevPos: [0, 0, 0], rec: [], ghost: null, ghostPts: null, ghostAv: null, selfAv: null, botAv: null,
    demo: null, selected: null, fovK: 0, rollK: 0, gainT: 0, lastSpeed: 0,

    unlocked(tier) { if (tier <= 1) return true; return MAPS.some(m => m.tier === tier - 1 && profile.cleared[m.id]); },
    curBoard() { return profile.perksOn && Object.values(profile.perks).some(v => v > 0) ? 'open' : 'stock'; },

    load(id) {
      this.mapId = id; this.def = MAPS.find(m => m.id === id); this.world = getWorld(id);
      GFX.load(this.world, this.def);
      document.documentElement.style.setProperty('--accent', this.def.theme.accent);
    },
    start(id) {
      if (id !== this.mapId) this.load(id);
      this.board = this.curBoard();
      this.cfg = C.cfgFor(profile.perks, this.board === 'open');
      this.mode = 'play'; this.menuOpen = false; this.practice = false; this.cp = null;
      this.newRun();
      $('#menu').hidden = true; $('#hud').hidden = false; $('#finish').hidden = true;
      $('#hMap').textContent = this.def.name;
      $('#hMap').style.color = TIER_COL[this.def.tier];
      $('#hBoard').textContent = this.board === 'open' ? 'Open · перки' : 'Stock';
      $('#hBoard').className = 'badge' + (this.board === 'open' ? ' open' : '');
      $('#hPractice').hidden = true;
      this.loadGhost();
      renderHudLb();
      Net.presence();
      lock();
    },
    newRun() {
      this.run = C.newRun(this.world, this.cfg);
      const s0 = this.world.stages[0];
      this.yaw = s0.spawnYaw; this.pitch = -0.08;
      this.prevPos = this.run.p.pos.slice(); this.rec = [];
      this.lastSpeed = 0;
      $('#finish').hidden = true;
      $('#hSplit').textContent = '';
      updOd();
    },
    restart() { if (this.mode !== 'play') return; if (!$('#finish').hidden) { $('#finish').hidden = true; lock(); } this.newRun(); },
    back() {
      if (this.mode !== 'play' || this.run.state === 'finished') return;
      C.respawnStage(this.world, this.run, this.cfg);
      if (this.run.stage === 0) { this.run.state = 'start'; this.run.time = 0; this.run.splits = []; this.rec = []; }
      this.yaw = this.world.stages[this.run.stage].spawnYaw; this.prevPos = this.run.p.pos.slice();
    },
    togglePractice() {
      this.practice = !this.practice; this.cp = null;
      $('#hPractice').hidden = !this.practice;
      toast(this.practice ? 'Practice: таймер не идёт в зачёт' : 'Practice выключен, новый заезд', this.practice ? 'gold' : '');
      if (!this.practice) this.newRun();
    },
    cpSave() { if (!this.practice) return; const p = this.run.p; this.cp = { pos: p.pos.slice(), vel: p.vel.slice(), yaw: this.yaw, pitch: this.pitch, stage: this.run.stage }; toast('Точка сохранена'); },
    cpLoad() { if (!this.practice || !this.cp) return; const p = this.run.p, c = this.cp; p.pos = c.pos.slice(); p.vel = c.vel.slice(); this.yaw = c.yaw; this.pitch = c.pitch; this.run.stage = c.stage; this.prevPos = p.pos.slice(); p.onGround = false; },

    async loadGhost() {
      this.ghost = null; this.ghostPts = null;
      const mode = profile.settings.ghost;
      if (mode === 'off') return;
      const rows = Net.board(this.mapId, this.board);
      let src = null;
      if (mode === 'wr' && rows[0]) src = rows[0].uid;
      if (mode === 'pb' || !src) src = Net.uid;
      const want = this.mapId + MAPV + this.board;
      let g = null;
      if (src === Net.uid) g = LS.get('ghost:' + want, null) || (Net.mode === 'live' ? await Net.ghost(this.mapId, this.board, src) : null);
      else g = await Net.ghost(this.mapId, this.board, src);
      if (want !== this.mapId + MAPV + this.board || !g || !g.d) return;
      try { this.ghostPts = decGhost(g.d); this.ghost = { t: g.t, who: src === Net.uid ? 'PB' : 'WR' }; } catch (e) { this.ghostPts = null; }
    },

    tick() {
      const run = this.run, p = run.p;
      this.prevPos = p.pos.slice();
      const side = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
      const fwd = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
      const cmd = { fwd, side, yaw: this.yaw, jump: !!keys.Space, boost: this.boostReq };
      this.boostReq = false;
      const before = p.boostLeft;
      const ev = C.runTick(this.world, run, cmd, this.cfg);
      if (p.boostLeft < before) { Sfx.boost(); updOd(); this.dashT = clock; }
      if (p.landT === p.tick) Sfx.land(p.landQ);
      const ch = p.chain;
      if (ch && ch.evT === p.tick) {
        if (ch.ev === 'clean') { Sfx.combo(ch.n); comboPulse(); comboNote(`Чистый вход · +${(1.2 * ch.n).toFixed(1)}% скорости`, 'good'); }
        else if (ch.ev === 'dirty') comboNote(`Грязный вход ${Math.round(ch.q * 100)}% · цепь сброшена`, 'bad');
        else comboNote(`Вход ${Math.round(ch.q * 100)}%` + (ch.sync < 0.6 ? ' · слабый синк' : ''), '');
      }
      if (!p.onGround && p.strafes !== this.lastStrafes) { if (this.lastStrafes !== undefined) Sfx.whoosh(p.lastSide); }
      this.lastStrafes = p.strafes;
      if (run.state === 'running' && p.tick % 5 === 0) this.rec.push([Math.round(p.pos[0]), Math.round(p.pos[1]), Math.round(p.pos[2])]);
      for (const e of ev) this.onEvent(e);
    },
    onEvent(e) {
      const run = this.run;
      if (e.t === 'start') { this.rec = []; Sfx.start_(); }
      else if (e.t === 'ring') { Sfx.ring(); this.dashT = clock; comboNote('Кольцо: +скорость'); }
      else if (e.t === 'fail') {
        Sfx.fail(); flash();
        this.yaw = this.world.stages[run.stage].spawnYaw; this.prevPos = run.p.pos.slice();
        if (run.stage === 0) this.rec = [];
        updOd();
      } else if (e.t === 'stage') {
        Sfx.stage();
        this.yaw = this.world.stages[run.stage].spawnYaw; this.prevPos = run.p.pos.slice(); this.pitch = -0.08;
        const pb = profile.pbs[this.mapId + MAPV + this.board];
        const ref = pb && pb.splits && pb.splits[run.stage - 1];
        const el = $('#hSplit');
        if (ref != null && !this.practice) { const d = e.time - ref; el.textContent = (d <= 0 ? '−' : '+') + Math.abs(d).toFixed(2); el.className = d <= 0 ? 'up' : 'down'; }
        else { el.textContent = fmt(e.time); el.className = ''; }
        clearTimeout(this._splitT); this._splitT = setTimeout(() => { el.textContent = ''; }, 3000);
        updOd();
      } else if (e.t === 'finish') this.finish(e.time);
    },
    finish(t) {
      const key = this.mapId + MAPV + this.board, def = this.def;
      $('#hTimer').className = 'done';
      if (this.practice) { toast('Practice-финиш: ' + fmt(t)); Sfx.finish(false); return; }
      const rowsBefore = Net.board(this.mapId, this.board);
      const wrBefore = rowsBefore[0] ? rowsBefore[0].t : Infinity;
      const pb = profile.pbs[key];
      const improved = !pb || t < pb.t;
      const first = !profile.cleared[this.mapId];
      let cr = 30 * def.tier + 10 * this.world.stages.length;
      if (first) cr += 120 * def.tier;
      if (improved && pb) cr += 20 * def.tier;
      const wr = t < wrBefore;
      if (wr && rowsBefore.length) cr += 100 * def.tier;
      profile.credits += cr; profile.cleared[this.mapId] = true;
      if (improved) {
        profile.pbs[key] = { t, splits: this.run.splits.slice(), at: Date.now() };
        const gs = encGhost(this.rec);
        LS.set('ghost:' + key, { t, d: gs });
        Net.submit(this.mapId, this.board, t, this.run.splits.slice(), gs);
      }
      Net.saveProfile();
      Sfx.finish(wr);
      const rows = Net.board(this.mapId, this.board);
      const myT = profile.pbs[key].t;
      const rank = rows.findIndex(r => r.uid === Net.uid && Math.abs(r.t - myT) < 1e-3) + 1 || (rows.filter(r => r.t < myT).length + 1);
      $('#finTime').textContent = fmt(t);
      const dEl = $('#finDelta');
      if (wr) { dEl.textContent = rowsBefore.length ? `Новый рекорд сервера · −${(wrBefore - t).toFixed(2)}` : 'Первый рекорд сервера на этой карте'; dEl.style.color = 'var(--gold)'; }
      else if (!pb) { dEl.textContent = `Первое прохождение · до WR +${(t - wrBefore).toFixed(2)}`; dEl.style.color = 'var(--good)'; }
      else if (improved) { dEl.textContent = `Личный рекорд · −${(pb.t - t).toFixed(2)}`; dEl.style.color = 'var(--good)'; }
      else { dEl.textContent = `Личный рекорд ${fmt(pb.t)} · +${(t - pb.t).toFixed(2)}`; dEl.style.color = 'var(--bad)'; }
      $('#finTitle').textContent = `Финиш · ${def.name} · ${this.board === 'open' ? 'Open' : 'Stock'}`;
      $('#finRank').textContent = `#${rank} из ${Math.max(rows.length, rank)}`;
      $('#finMax').textContent = Math.round(this.run.maxSpeed);
      $('#finCr').textContent = '+' + cr;
      const nxt = nextMap(this.mapId);
      $('#finNext').disabled = !nxt;
      $('#finish').hidden = false;
      if (document.pointerLockElement) document.exitPointerLock();
      $('#resume').hidden = true;
      if (first) { const tierUp = MAPS.find(m => m.tier === def.tier + 1); if (tierUp && MAPS.filter(m => m.tier === def.tier && profile.cleared[m.id]).length === 1) toast(`Открыт Tier ${def.tier + 1}`, 'gold'); }
      renderHudLb();
    },
    openMenu() {
      this.mode = 'menu'; this.menuOpen = true;
      if (document.pointerLockElement) document.exitPointerLock();
      $('#hud').hidden = true; $('#finish').hidden = true; $('#resume').hidden = true; $('#menu').hidden = false;
      showBigLb(false);
      this.startDemo(this.selected || this.mapId || MAPS[0].id);
      renderMenu();
      Net.presence();
    },
    startDemo(id) {
      if (id !== this.mapId) this.load(id);
      const cfg = C.cfgFor({}, false);
      const run = C.newRun(this.world, cfg);
      this.demo = { run, bot: C.newBot(), cfg, prev: run.p.pos.slice(), camYaw: 0, camPos: null, t: 0 };
    },
    demoTick() {
      const d = this.demo; if (!d) return;
      d.prev = d.run.p.pos.slice();
      d.cmd = C.botCmd(this.world, d.run, d.bot);
      const ev = C.runTick(this.world, d.run, d.cmd, d.cfg);
      if (ev.some(e => e.t === 'stage' || e.t === 'fail')) d.prev = d.run.p.pos.slice();
      if (d.run.finished) { d.t += C.TICK; if (d.t > 1.5) this.startDemo(this.mapId); }
    },
  };
  function nextMap(id) { const i = MAPS.findIndex(m => m.id === id); for (let j = i + 1; j < MAPS.length; j++) if (Game.unlocked(MAPS[j].tier)) return MAPS[j].id; return null; }
  function flash() { const f = $('#flash'); f.classList.add('on'); requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on'))); }
  function toast(msg, kind) {
    const el = document.createElement('div'); el.className = 'toast ' + (kind || ''); el.textContent = msg;
    $('#toasts').appendChild(el); setTimeout(() => el.remove(), 2700);
  }
  function updOd() {
    const el = $('#hOd');
    if (!Game.cfg || !Game.cfg.boost) { el.hidden = true; return; }
    el.hidden = false; el.textContent = `Overdrive [E] · ${Game.run ? Game.run.p.boostLeft : 0}/${Game.cfg.boost}`;
  }

  // ---------------- HUD ----------------
  const keyEls = {}; document.querySelectorAll('#hKeys span').forEach(s => { keyEls[s.dataset.k] = s; });
  let hudLast = {};
  function setText(id, v) { if (hudLast[id] !== v) { hudLast[id] = v; $(id).textContent = v; } }
  function updateHud(speed) {
    const run = Game.run, p = run.p;
    const t = run.state === 'start' ? 0 : run.time;
    setText('#hTimer', fmtT(t));
    const tc = run.state === 'finished' ? 'done' : run.state === 'start' ? 'idle' : '';
    if (hudLast.tc !== tc) { hudLast.tc = tc; $('#hTimer').className = tc; }
    setText('#hStage', run.state === 'start' ? `Start zone · ${Game.world.stages.length} stage${Game.world.stages.length > 1 ? 's' : ''}` : `Stage ${run.stage + 1}/${Game.world.stages.length}`);
    setText('#hSpeed', String(Math.round(speed)));
    const hue = Math.min(1, speed / 3000);
    $('#hSpeed').style.color = hue < 0.33 ? 'var(--text)' : hue < 0.7 ? 'var(--accent)' : 'var(--gold)';
    $('#hBar').style.width = Math.min(100, speed / Game.cfg.maxvel * 100) + '%';
    setText('#hSync', (p.syncAll ? Math.round(p.syncGood / p.syncAll * 100) : 0) + '%');
    setText('#hStrafes', String(p.strafes));
    setText('#hMax', String(Math.round(run.maxSpeed)));
    // gain readout
    Game.gainT += 1 / 60;
    if (Game.gainT > 0.25) {
      const g = speed - Game.lastSpeed; Game.lastSpeed = speed; Game.gainT = 0;
      const el = $('#hGain');
      el.textContent = Math.abs(g) < 4 ? '' : (g > 0 ? '+' : '') + Math.round(g * 4) + '/s';
      el.style.color = g > 0 ? 'var(--good)' : 'var(--bad)';
    }
    for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space']) keyEls[k].classList.toggle('on', !!keys[k]);
    if (mouseDX) { lastSide = Math.sign(mouseDX); sideTimer = 6; mouseDX = 0; } else if (sideTimer > 0) sideTimer--; else lastSide = 0;
    keyEls.ml.classList.toggle('on', lastSide < 0); keyEls.mr.classList.toggle('on', lastSide > 0);
    updateCombo(p);
  }
  let noteT = 0;
  function comboNote(msg, kind) {
    const el = $('#cmbNote'); el.textContent = msg; el.style.opacity = 1;
    el.style.color = kind === 'bad' ? 'var(--bad)' : kind === 'good' ? 'var(--good)' : 'var(--text)';
    clearTimeout(noteT); noteT = setTimeout(() => { el.style.opacity = 0; }, 1600);
  }
  function comboPulse() { const el = $('#cmbLvl'); el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }
  const pipEls = Array.from(document.querySelectorAll('#cmbPips i'));
  function updateCombo(p) {
    const c = p.chain || { n: 0, q: 1, sync: 1, evT: -99 };
    setText('#cmbLvl', 'x' + c.n);
    const cls = c.n >= 8 ? 'max' : c.n >= 1 ? 'hot' : '';
    if (hudLast.cmbCls !== cls) { hudLast.cmbCls = cls; const el = $('#cmbLvl'); el.classList.remove('hot', 'max'); if (cls) el.classList.add(cls); }
    const air = p.flight && p.flight.all > 0 ? p.flight.good / p.flight.all : null;
    $('#cmbBar').style.width = (air == null ? 0 : Math.round(air * 100)) + '%';
    pipEls.forEach((el, i) => { el.classList.toggle('on', i < c.n); el.classList.toggle('max', c.n >= 8); });
    setText('#cmbFx', c.n > 0 ? `стрейф +${30 * c.n}% · вход +${(1.2 * c.n).toFixed(1)}%` : 'входи в рампу чисто: ≥97% скорости');
  }
  function lbRowsHtml(rows, max, meT) {
    let h = '', meShown = false;
    rows.slice(0, max).forEach((r, i) => { const me = r.uid === Net.uid; if (me) meShown = true; h += `<div class="lbrow ${me ? 'me' : ''} ${i === 0 ? 'wr' : ''}"><span class="r">${i + 1}</span><span class="n">${esc(r.name)}</span><span class="t">${fmt(r.t)}</span></div>`; });
    if (!meShown) { const i = rows.findIndex(r => r.uid === Net.uid); if (i >= 0) h += `<div class="lbrow me"><span class="r">${i + 1}</span><span class="n">${esc(rows[i].name)}</span><span class="t">${fmt(rows[i].t)}</span></div>`; }
    return h || '<div class="hint" style="padding:4px 0">Пока пусто. Первый финиш станет рекордом сервера.</div>';
  }
  function renderHudLb() {
    if (!Game.mapId) return;
    const rows = Net.board(Game.mapId, Game.board);
    const gh = Game.ghost ? `<span style="color:var(--accent)">ghost ${Game.ghost.who}</span>` : '';
    $('#hLb').innerHTML = `<h4><span>${Game.board === 'open' ? 'Open' : 'Stock'} топ</span>${gh}</h4>` + lbRowsHtml(rows, 5);
  }
  function showBigLb(on) {
    const el = $('#bigLb');
    if (!on || Game.mode !== 'play') { el.hidden = true; return; }
    const rows = Net.board(Game.mapId, Game.board);
    el.innerHTML = `<h4 style="margin:0 0 10px;font:700 13px var(--f-display);letter-spacing:.22em;color:var(--mute);text-transform:uppercase">${esc(Game.def.name)} · ${Game.board}</h4>` + lbTable(rows, 15);
    el.hidden = false;
  }
  function lbTable(rows, max) {
    if (!rows.length) return '<div class="empty">Ещё никто не прошёл эту карту на этом борде. Первый финиш станет рекордом сервера.</div>';
    const wr = rows[0].t;
    let h = '<table class="lb"><thead><tr><th>#</th><th>Игрок</th><th style="text-align:right">Время</th><th style="text-align:right">До WR</th><th style="text-align:right">Когда</th></tr></thead><tbody>';
    rows.slice(0, max).forEach((r, i) => { h += `<tr class="${r.uid === Net.uid ? 'me' : ''}"><td class="r">${i + 1}</td><td>${esc(r.name)}</td><td class="t">${fmt(r.t)}</td><td class="g">${i ? '+' + (r.t - wr).toFixed(2) : 'WR'}</td><td class="g">${ago(r.at)}</td></tr>`; });
    return h + '</tbody></table>';
  }

  // ---------------- menu ----------------
  let tab = 'maps', topMap = null, topBoard = 'stock';
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; renderMenu(); }));
  function renderSrv() {
    const live = Net.mode === 'live' && Net.status === 'live';
    $('#srvDot').className = 'dot' + (live ? '' : ' off');
    const total = Object.keys(Net.runs).length;
    const st = Net.mode !== 'live' ? 'офлайн · рекорды только на этом устройстве' : Net.status === 'live' ? `${Net.online()} онлайн · ${total} в таблице` : Net.status === 'slow' ? 'сервер отвечает медленно' : Net.status === 'error' ? 'нет связи с таблицей' : 'подключение…';
    $('#srvText').textContent = `surf · 100 tick · ${st}`;
  }
  function renderMenu() {
    renderSrv();
    document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    const pane = $('#pane');
    if (tab === 'maps') pane.innerHTML = mapsHtml();
    else if (tab === 'top') pane.innerHTML = topHtml();
    else if (tab === 'perks') pane.innerHTML = perksHtml();
    else pane.innerHTML = setHtml();
    wirePane();
    const d = Game.def; if (d) $('#demoTag').innerHTML = `Демо-заезд<b>${esc(d.name)}</b>`;
  }
  function mapsHtml() {
    const sel = Game.selected || MAPS[0].id;
    const board = Game.curBoard();
    let h = '';
    for (let tier = 1; tier <= 10; tier++) {
      const ms = MAPS.filter(m => m.tier === tier); if (!ms.length) continue;
      const un = Game.unlocked(tier);
      h += `<div class="tier"><div class="tier-h"><span class="tb" style="background:${TIER_COL[tier]}">T${tier}</span>${TIER_NAME[tier]}${un ? '' : `<span class="lock">· пройди любую карту T${tier - 1}</span>`}</div>`;
      ms.forEach(m => {
        const rows = Net.board(m.id, board), wr = rows[0];
        const pb = profile.pbs[m.id + MAPV + board];
        const live = Net.onlineOn(m.id);
        h += `<button class="mcard" data-map="${m.id}" aria-pressed="${m.id === sel}" style="--mc:${m.theme.accent}" ${un ? '' : 'disabled'}>
          <span class="nm">${esc(m.name)}</span>
          <span class="rt">${wr ? `WR <b>${fmt(wr.t)}</b><br>${esc(wr.name)}` : 'WR —'}${pb ? `<br><span class="pb">PB ${fmt(pb.t)}</span>` : ''}</span>
          <span class="sub">${C.planOf(m).stages} стейджей · ${esc(m.blurb)}</span>
          ${live ? `<span class="live">● ${live} на карте</span>` : ''}
        </button>`;
      });
      h += '</div>';
    }
    const m = MAPS.find(x => x.id === sel);
    const canPlay = window.matchMedia('(pointer: fine)').matches;
    h += `<div class="sel"><div class="sel-top"><span class="sel-name" style="color:${m.theme.accent}">${esc(m.name)}</span>
      <span class="badge ${board === 'open' ? 'open' : ''}">${board === 'open' ? 'Open · перки включены' : 'Stock · чистый скилл'}</span></div>
      <div class="row"><button class="btn primary" id="play" ${Game.unlocked(m.tier) && canPlay ? '' : 'disabled'}>Серфить</button>
      <button class="btn" id="seeTop">Таблица карты</button></div>
      ${canPlay ? '' : '<div class="hint">Для игры нужны клавиатура и мышь.</div>'}
      <div class="keys-help"><span><kbd>A</kbd>/<kbd>D</kbd> держись в рампу</span><span>мышь веди за стрейфом</span><span><kbd>Space</kbd> бхоп</span><span><kbd>R</kbd> рестарт</span><span><kbd>F</kbd> к началу стейджа</span><span><kbd>P</kbd> practice</span><span><kbd>F1</kbd> 3-е лицо</span><span><kbd>Tab</kbd> топ</span></div></div>`;
    return h;
  }
  function topHtml() {
    const id = topMap || Game.selected || MAPS[0].id;
    let h = `<div class="row" style="margin-bottom:12px;align-items:center;justify-content:space-between">
      <div class="seg" role="group" aria-label="Карта">${MAPS.map(m => `<button data-topmap="${m.id}" aria-pressed="${m.id === id}" title="${esc(m.name)}" style="${m.id === id ? '' : `color:${TIER_COL[m.tier]}`}">T${m.tier}</button>`).join('')}</div>
      <div class="seg" role="group" aria-label="Борд"><button data-topboard="stock" aria-pressed="${topBoard === 'stock'}">Stock</button><button data-topboard="open" aria-pressed="${topBoard === 'open'}">Open</button></div></div>`;
    const m = MAPS.find(x => x.id === id);
    h += `<div class="sel-name" style="font-size:24px;margin-bottom:8px;color:${m.theme.accent}">${esc(m.name)}</div>`;
    h += lbTable(Net.board(id, topBoard), 50);
    // server ranking: points per stock time, scaled by tier and distance to WR
    const pts = {};
    MAPS.forEach(mm => { const rows = Net.board(mm.id, 'stock'); if (!rows.length) return; const wr = rows[0].t; rows.forEach((r, i) => { const v = Math.round(mm.tier * 100 * Math.pow(wr / r.t, 2)) + (i === 0 ? mm.tier * 50 : 0); (pts[r.uid] = pts[r.uid] || { name: r.name, p: 0, n: 0 }).p += v; pts[r.uid].n++; }); });
    const rk = Object.entries(pts).sort((a, b) => b[1].p - a[1].p);
    h += `<div class="tier-h" style="margin-top:22px">Рейтинг сервера · Stock</div>`;
    if (!rk.length) h += '<div class="empty">Очки появятся после первых финишей.</div>';
    else { h += '<table class="lb"><tbody>'; rk.slice(0, 20).forEach(([uid, r], i) => { h += `<tr class="${uid === Net.uid ? 'me' : ''}"><td class="r">${i + 1}</td><td>${esc(r.name)}</td><td class="g">${r.n} карт</td><td class="t">${r.p} pts</td></tr>`; }); h += '</tbody></table>'; }
    return h;
  }
  function perksHtml() {
    const anyPerk = Object.values(profile.perks).some(v => v > 0);
    let h = `<div class="wallet"><div><small>Кредиты</small><b>${profile.credits}</b></div><div class="hint" style="max-width:300px">Кредиты дают финиши: первое прохождение, личные и серверные рекорды. Чем выше тир, тем больше.</div></div>
      <div class="switch"><label class="chk"><input type="checkbox" id="perksOn" ${profile.perksOn ? 'checked' : ''} ${anyPerk ? '' : 'disabled'}> Перки включены</label>
      <p>С перками время идёт в борд <b style="color:var(--accent)">Open</b>. Без них в <b>Stock</b>, где у всех одинаковая физика.</p></div>`;
    C.PERKS.forEach(pk => {
      const lv = profile.perks[pk.id] | 0, max = lv >= pk.max, cost = pk.cost[lv];
      h += `<div class="perk"><div><div class="nm">${pk.name}</div><div class="pips">${Array.from({ length: pk.max }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</div></div>
        <button class="btn ${max ? '' : 'primary'}" data-buy="${pk.id}" ${max || profile.credits < cost ? 'disabled' : ''}>${max ? 'Макс.' : cost + ' кр.'}</button>
        <div class="ds">${pk.desc} Сейчас: ${pk.fx(lv)}${max ? '' : ` → ${pk.fx(lv + 1)}`}</div></div>`;
    });
    h += `<div class="tier-h" style="margin-top:18px">Цвет трейла <span class="lock">видно в 3-м лице и у призрака</span></div><div class="swatches" style="margin-bottom:26px">`;
    TRAILS.forEach(tr => { const own = profile.owned.includes(tr.id); h += `<button class="sw" data-trail="${tr.id}" aria-pressed="${profile.trail === tr.id}" aria-label="${tr.id}" style="background:${tr.c}" ${!own && profile.credits < tr.cost ? 'disabled' : ''}>${own ? '' : `<span class="c">${tr.cost}</span>`}</button>`; });
    return h + '</div>';
  }
  function setHtml() {
    const s = profile.settings;
    return `<div class="form">
      <label for="cs">Ник в таблице<input type="text" id="cs" maxlength="20" value="${esc(profile.callsign)}" placeholder="как тебя видят на сервере"></label>
      <label><span class="rowv">Чувствительность (как в CS)<span id="sensV">${s.sens.toFixed(2)}</span></span><input type="range" id="sens" min="0.3" max="6" step="0.05" value="${s.sens}"></label>
      <label><span class="rowv">FOV по горизонтали<span id="fovV">${s.fov}°</span></span><input type="range" id="fov" min="80" max="120" step="1" value="${s.fov}"></label>
      <label><span class="rowv">Громкость<span id="volV">${Math.round(s.vol * 100)}%</span></span><input type="range" id="vol" min="0" max="1" step="0.05" value="${s.vol}"></label>
      <label>Призрак<div class="seg"><button data-ghost="wr" aria-pressed="${s.ghost === 'wr'}">WR</button><button data-ghost="pb" aria-pressed="${s.ghost === 'pb'}">Мой PB</button><button data-ghost="off" aria-pressed="${s.ghost === 'off'}">Выкл</button></div></label>
      <label class="chk"><input type="checkbox" id="roll" ${s.roll ? 'checked' : ''}> Лёгкий крен камеры при стрейфе</label>
      <label class="chk"><input type="checkbox" id="fx" ${s.fx ? 'checked' : ''}> Скоростные линии и FOV-разгон</label>
      <div class="foot">Таблица общая для всех, кто открыл эту страницу. Время считается на клиенте, так что это честный сервер для своих, а не античит.</div>
    </div>`;
  }
  function wirePane() {
    const pane = $('#pane');
    pane.querySelectorAll('[data-map]').forEach(b => b.addEventListener('click', () => { Game.selected = b.dataset.map; Game.startDemo(b.dataset.map); renderMenu(); }));
    const play = pane.querySelector('#play'); if (play) play.addEventListener('click', () => Game.start(Game.selected || MAPS[0].id));
    const st = pane.querySelector('#seeTop'); if (st) st.addEventListener('click', () => { topMap = Game.selected || MAPS[0].id; topBoard = Game.curBoard(); tab = 'top'; renderMenu(); });
    pane.querySelectorAll('[data-topmap]').forEach(b => b.addEventListener('click', () => { topMap = b.dataset.topmap; renderMenu(); }));
    pane.querySelectorAll('[data-topboard]').forEach(b => b.addEventListener('click', () => { topBoard = b.dataset.topboard; renderMenu(); }));
    pane.querySelectorAll('[data-buy]').forEach(b => b.addEventListener('click', () => {
      const pk = C.PERKS.find(p => p.id === b.dataset.buy), lv = profile.perks[pk.id] | 0, cost = pk.cost[lv];
      if (lv >= pk.max || profile.credits < cost) return;
      profile.credits -= cost; profile.perks[pk.id] = lv + 1; profile.perksOn = true; Net.saveProfile(); renderMenu();
      toast(`${pk.name} ${lv + 1} куплен`, 'good');
    }));
    const po = pane.querySelector('#perksOn'); if (po) po.addEventListener('change', () => { profile.perksOn = po.checked; Net.saveProfile(); renderMenu(); });
    pane.querySelectorAll('[data-trail]').forEach(b => b.addEventListener('click', () => {
      const tr = TRAILS.find(x => x.id === b.dataset.trail);
      if (!profile.owned.includes(tr.id)) { if (profile.credits < tr.cost) return; profile.credits -= tr.cost; profile.owned.push(tr.id); }
      profile.trail = tr.id; Net.saveProfile(); applyTrail(); renderMenu();
    }));
    const cs = pane.querySelector('#cs');
    if (cs) cs.addEventListener('change', () => { profile.callsign = cs.value.trim().slice(0, 20); Net.saveProfile(); Net.rename(); });
    const rng = (id, key, f, lab) => { const el = pane.querySelector('#' + id); if (!el) return; el.addEventListener('input', () => { profile.settings[key] = +el.value; pane.querySelector('#' + id + 'V').textContent = lab(+el.value); if (f) f(+el.value); }); el.addEventListener('change', () => Net.saveProfile()); };
    rng('sens', 'sens', null, v => v.toFixed(2)); rng('fov', 'fov', null, v => v + '°'); rng('vol', 'vol', v => Sfx.vol(v), v => Math.round(v * 100) + '%');
    pane.querySelectorAll('[data-ghost]').forEach(b => b.addEventListener('click', () => { profile.settings.ghost = b.dataset.ghost; Net.saveProfile(); renderMenu(); }));
    for (const id of ['roll', 'fx']) { const el = pane.querySelector('#' + id); if (el) el.addEventListener('change', () => { profile.settings[id] = el.checked; Net.saveProfile(); }); }
  }
  $('#finAgain').addEventListener('click', () => Game.restart());
  $('#finMenu').addEventListener('click', () => Game.openMenu());
  $('#finNext').addEventListener('click', () => { const n = nextMap(Game.mapId); if (n) { Game.selected = n; Game.start(n); } });
  document.addEventListener('keydown', e => {
    if (e.code !== 'Escape') return;
    if (Game.mode === 'play') {
      if (!$('#finish').hidden || !Input.locked) Game.openMenu();
    } else if (Game.mode === 'menu' && Game.run && Game.mapId) { /* stay in menu */ }
  });
  function applyTrail() {
    const c = (TRAILS.find(t => t.id === profile.trail) || TRAILS[0]).c;
    if (Game.selfAv) Game.selfAv.setColor(c);
    if (Game.ninja) Game.ninja.setAccent(profile.trail === 'white' ? '#ff3d6e' : c);
  }

  // ---------------- main loop ----------------
  let acc = 0, last = performance.now(), clock = 0, ftAvg = 1 / 60, ftT = 0, stepPh = 0;
  function adapt(dt) {
    // keep the frame rate smooth: trade resolution for frame time on slower GPUs
    ftAvg += (dt - ftAvg) * 0.05; ftT += dt;
    if (ftT < 1.5) return; ftT = 0;
    const k = GFX.scale();
    if (ftAvg > 1 / 50 && k > 0.6) GFX.setScale(Math.max(0.6, k - 0.15));
    else if (ftAvg < 1 / 100 && k < 1) GFX.setScale(Math.min(1, k + 0.1));
  }
  function loop(now) {
    requestAnimationFrame(loop);
    let dt = Math.min(0.1, (now - last) / 1000); last = now; clock += dt;
    if (!document.hidden) adapt(dt);
    const S = profile.settings;
    let camPos, yaw, pitch, roll = 0, speed = 0, surfing = false;
    if (Game.mode === 'play' && Game.run) {
      if (!Game.paused && $('#finish').hidden || (Game.run.state === 'finished' && !Game.paused)) {
        acc += dt;
        let n = 0; while (acc >= C.TICK && n < 12) { Game.tick(); acc -= C.TICK; n++; }
        if (n >= 12) acc = 0;
      }
      const p = Game.run.p, a = Math.min(1, acc / C.TICK);
      const pos = [Game.prevPos[0] + (p.pos[0] - Game.prevPos[0]) * a, Game.prevPos[1] + (p.pos[1] - Game.prevPos[1]) * a, Game.prevPos[2] + (p.pos[2] - Game.prevPos[2]) * a];
      speed = Math.hypot(p.vel[0], p.vel[2]);
      surfing = p.tick - p.touchT < 3;
      yaw = Game.yaw; pitch = Game.pitch;
      if (S.roll) { const side = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0); Game.rollK += ((p.onGround ? 0 : -side * 0.022) - Game.rollK) * Math.min(1, dt * 8); roll = Game.rollK; }
      if (Game.third) {
        // orbit camera behind the view direction; purely visual, physics is identical
        const cp = Math.cos(pitch), f = [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
        camPos = [pos[0] - f[0] * 240, pos[1] + 4 - f[1] * 240, pos[2] - f[2] * 240];
        GFX.placeAvatar(Game.selfAv, pos, true);
        Game.ninja.visible(true);
        NINJA.update(Game.ninja, { pos: [pos[0], pos[1], pos[2]], vel: p.vel, onGround: p.onGround, surfN: surfing ? p.touchN : null,
          side: (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0), viewYaw: yaw, dt, t: clock, dash: clock - (Game.dashT || -9) < 0.45, camPos });
      } else { camPos = [pos[0], pos[1] + C.EYE, pos[2]]; GFX.placeAvatar(Game.selfAv, pos, false); Game.ninja.visible(false); }
      if (p.onGround && speed > 60) { stepPh += speed * dt / 26; if (stepPh > Math.PI) { stepPh -= Math.PI; Sfx.step(); } }
      // ghost
      if (Game.ghostPts && Game.run.state === 'running' && !Game.practice) {
        const gi = Game.run.time * 20, i0 = Math.floor(gi), gp = Game.ghostPts;
        if (i0 < gp.length - 1) { const f = gi - i0, A = gp[i0], B = gp[i0 + 1]; GFX.placeAvatar(Game.ghostAv, [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f], true); }
        else GFX.placeAvatar(Game.ghostAv, gp[gp.length - 1], true);
      } else GFX.placeAvatar(Game.ghostAv, [0, 0, 0], false);
      GFX.placeAvatar(Game.botAv, [0, 0, 0], false);
      updateHud(speed);
    } else if (Game.demo) {
      acc += dt; let n = 0; while (acc >= C.TICK && n < 12) { Game.demoTick(); acc -= C.TICK; n++; }
      const d = Game.demo, p = d.run.p, a = Math.min(1, acc / C.TICK);
      const pos = [d.prev[0] + (p.pos[0] - d.prev[0]) * a, d.prev[1] + (p.pos[1] - d.prev[1]) * a, d.prev[2] + (p.pos[2] - d.prev[2]) * a];
      speed = Math.hypot(p.vel[0], p.vel[2]);
      const vy = speed > 80 ? Math.atan2(-p.vel[0], -p.vel[2]) : p.yaw;
      let dy = vy - d.camYaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      d.camYaw += dy * Math.min(1, dt * 2.2);
      const f = C.fwdOf(d.camYaw), r = C.rightOf(d.camYaw);
      const want = [pos[0] - f[0] * 480 - r[0] * 230, pos[1] + 150, pos[2] - f[2] * 480 - r[2] * 230];
      if (!d.camPos || Math.hypot(want[0] - d.camPos[0], want[2] - d.camPos[2]) > 3000) d.camPos = want.slice();
      const k = Math.min(1, dt * 5); for (let i = 0; i < 3; i++) d.camPos[i] += (want[i] - d.camPos[i]) * k;
      camPos = d.camPos; yaw = d.camYaw; pitch = -0.2;
      GFX.placeAvatar(Game.botAv, pos, true); GFX.placeAvatar(Game.selfAv, pos, false); GFX.placeAvatar(Game.ghostAv, pos, false);
      Game.ninja.visible(true);
      NINJA.update(Game.ninja, { pos, vel: p.vel, onGround: p.onGround, surfN: p.tick - p.touchT < 3 ? p.touchN : null,
        side: d.cmd ? d.cmd.side : 0, viewYaw: d.camYaw, dt, t: clock, dash: false, camPos: d.camPos });
      $('#demoTag').querySelector('b') && ($('#demoTag').querySelector('b').textContent = Game.def.name + ' · ' + Math.round(speed) + ' u/s');
    } else return;
    const target = S.fx ? Math.max(0, Math.min(1, (speed - 600) / 2600)) : 0;
    Game.fovK += (target - Game.fovK) * Math.min(1, dt * 3);
    GFX.frame(clock, { pos: camPos, yaw, pitch, roll, hfov: S.fov + Game.fovK * 14 }, S.fx ? speed : 0);
    Sfx.update(speed, surfing, Game.mode === 'play' && !Game.paused, Game.rollK * -20);
  }

  // ---------------- boot ----------------
  function boot() {
    if (!window.THREE) { $('#loading').textContent = 'Не загрузился three.js. Проверь сеть и обнови страницу.'; return; }
    GFX.init(canvas);
    GFX.resize();
    window.addEventListener('resize', () => GFX.resize());
    Game.selfAv = GFX.makeAvatar('#ffffff', 0.35, true);
    Game.ghostAv = GFX.makeAvatar('#9fd8ff', 0.28);
    Game.botAv = GFX.makeAvatar('#ffffff', 0.4, true);
    Game.ninja = NINJA.create(GFX.scene(), '#ff3d6e');
    Game.third = !!profile.settings.third;
    applyTrail();
    Game.selected = MAPS[0].id;
    Game.openMenu();
    $('#loading').hidden = true;
    Net.on(what => {
      if (what === 'runs' || what === 'names') { if (Game.mode === 'menu') renderMenu(); else renderHudLb(); if (what === 'runs') Net.resolveNames(Object.keys(Net.runs).filter(id => id !== 'me' && !Net.runs[id].name)); }
      else if (what === 'peers' || what === 'status') { if (Game.mode === 'menu') { if (tab === 'maps') renderMenu(); else renderSrv(); } }
    });
    Net.init().then(() => { if (Game.mode === 'menu') renderMenu(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { for (const k in keys) keys[k] = false; } });
    requestAnimationFrame(loop);
  }
  boot();
  window.RAMPLINE = { Game, Net, profile: () => profile };
})();
