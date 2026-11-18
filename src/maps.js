// ============================================================
// RAMPLINE maps. Geometry is generated from tier + seed (see CORE.genStages) and laid out
// against an expert rider: higher tiers mean longer flights that need real speed, bigger
// turns in the air, uphill ramps that eat speed, and narrower slopes with less room to miss.
// ============================================================
const MAPS = (() => {
  const list = [
    { id: 'daybreak', name: 'Daybreak', tier: 1, seed: 1101,
      blurb: 'Широкие рампы, короткие перелёты. Научись держаться и входить чисто.',
      theme: { sky: ['#1d3b6e', '#f2a65a', '#f7d9b0'], fog: '#e9b88a', ramp: ['#f4ead8', '#e48a5a'], edge: '#ffd29a', deco: 'dunes', sun: [0.3, 0.25, -1], grid: 0.18, accent: '#ff9d5c' } },
    { id: 'tidepool', name: 'Tidepool', tier: 2, seed: 2207,
      blurb: 'Первые повороты в воздухе. Без мыши дальше не пройти.',
      theme: { sky: ['#06324a', '#2bb3b1', '#bff3e6'], fog: '#5fc9c0', ramp: ['#e9fbf6', '#2aa39c'], edge: '#7ff7e4', deco: 'reef', sun: [-0.4, 0.35, -1], grid: 0.16, accent: '#38e1c8' } },
    { id: 'cinder', name: 'Cinder Run', tier: 3, seed: 3313,
      blurb: 'Перелёты длиннее, рампы уже. Скорость начинает решать.',
      theme: { sky: ['#12060a', '#7a1f1b', '#ff7a3d'], fog: '#5a1a14', ramp: ['#3b2a2a', '#ff5a2a'], edge: '#ff8a3d', deco: 'spires', sun: [0.1, 0.12, -1], grid: 0.22, accent: '#ff6a2a' } },
    { id: 'aurora', name: 'Aurora Spine', tier: 4, seed: 4421,
      blurb: 'Первые рампы в гору. Береги скорость на входах.',
      theme: { sky: ['#030617', '#123a5c', '#3cf0a8'], fog: '#0d2a3d', ramp: ['#1a2d3f', '#4dffb0'], edge: '#7dffd0', deco: 'crystals', sun: [-0.2, 0.5, -1], grid: 0.25, accent: '#5dffbe' } },
    { id: 'vanta', name: 'Vanta Drop', tier: 5, seed: 5531,
      blurb: 'Узкие рампы в пустоте. Промах по высоте = падение.',
      theme: { sky: ['#000000', '#0b0b14', '#2b2350'], fog: '#07060e', ramp: ['#14121d', '#b07bff'], edge: '#c79bff', deco: 'monoliths', sun: [0.0, 0.6, -1], grid: 0.3, accent: '#b98aff' } },
    { id: 'helix', name: 'Helix Theory', tier: 6, seed: 6637,
      blurb: 'Крутые виражи и развороты в полёте.',
      theme: { sky: ['#071b10', '#1f5a2c', '#d9ff6b'], fog: '#163d21', ramp: ['#0f2416', '#c6ff3d'], edge: '#e2ff7a', deco: 'helix', sun: [0.5, 0.3, -1], grid: 0.28, accent: '#c8ff3c' } },
    { id: 'glacier', name: 'Glacier Fault', tier: 7, seed: 7741,
      blurb: 'Ледяной разлом. Длинные перелёты, ошибка на входе не прощается.',
      theme: { sky: ['#0a1a2e', '#6fa8d6', '#eaf6ff'], fog: '#9cc4e4', ramp: ['#f2f8ff', '#3d8fd6'], edge: '#bfe6ff', deco: 'crystals', sun: [0.2, 0.3, -1], grid: 0.2, accent: '#63c3ff' } },
    { id: 'solar', name: 'Solar Wind', tier: 8, seed: 8849,
      blurb: 'Поток над звездой. Нужна цепочка чистых входов, чтобы долететь.',
      theme: { sky: ['#1a0518', '#a11f5c', '#ffb347'], fog: '#5c1236', ramp: ['#2a0f22', '#ff4fa3'], edge: '#ffb0d6', deco: 'rings', sun: [-0.1, 0.15, -1], grid: 0.26, accent: '#ff5aa8' } },
    { id: 'static', name: 'Static Bloom', tier: 9, seed: 9953,
      blurb: 'Ядовитая тишина. Почти без права на ошибку.',
      theme: { sky: ['#020604', '#0c2416', '#7dff3c'], fog: '#06140c', ramp: ['#0a1610', '#59ff2e'], edge: '#a4ff7a', deco: 'monoliths', sun: [0.4, 0.4, -1], grid: 0.3, accent: '#7dff4a' } },
    { id: 'zenith', name: 'Zenith', tier: 10, seed: 10061,
      blurb: 'Финальный экзамен. Максимальная скорость, точные входы, полные развороты в воздухе.',
      theme: { sky: ['#000206', '#101826', '#ff2e63'], fog: '#0b0f18', ramp: ['#0d1220', '#ff2e63'], edge: '#ff6b8f', deco: 'rings', sun: [-0.3, 0.2, -1], grid: 0.32, accent: '#ff3d6e' } },
  ];
  return list;
})();
if (typeof module !== 'undefined') module.exports = MAPS;
