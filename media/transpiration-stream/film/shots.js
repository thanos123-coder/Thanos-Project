// Master shot list. Times are seconds on the 64 s timeline (see timeline.json).
// Overlapping shots cross-dissolve with a push-in "scale" transition; the
// second shot of an overlapping pair is the incoming one.
//
// Narration (start → end): n1 1.20–10.18 · n2 10.80–17.60 · n3a 18.20–24.39 ·
// n3b 24.70–29.36 · n4 29.95–37.66 · n5a 38.25–45.26 · n5b 45.58–48.79 ·
// n6a 49.40–56.24 · n6b 56.80–62.31

const lazy = (file) => ({ build: async (env) => (await import(file)).build(env) });

export const WORLDS = {
  tree: lazy('./worlds/tree.js'),
  soil: lazy('./worlds/soil.js'),
  roothair: lazy('./worlds/roothair.js'),
  rootxs: lazy('./worlds/rootxs.js'),
  xylem: lazy('./worlds/xylem.js'),
  leaf: lazy('./worlds/leaf.js'),
  wall: lazy('./worlds/wall.js'),
  molecules: lazy('./worlds/molecules.js'),
  stoma: lazy('./worlds/stoma.js'),
};

export const SHOTS = [
  // Scene 1 — root absorption
  { id: 's1a', world: 'tree',      t0: 0.00,  t1: 4.20 },
  { id: 's1b', world: 'soil',      t0: 3.70,  t1: 5.90, zoom: 0.22 },
  { id: 's1c', world: 'roothair',  t0: 5.40,  t1: 11.20, zoom: 0.22 },
  // Scene 2 — the xylem water column
  { id: 's2a', world: 'rootxs',    t0: 10.70, t1: 14.10, zoom: 0.16 },
  { id: 's2b', world: 'xylem',     t0: 13.60, t1: 16.40, zoom: 0.2 },
  { id: 's2c', world: 'tree',      t0: 15.90, t1: 18.70, zoom: -0.12 },
  // Scene 3 — evaporation inside the leaf
  { id: 's3a', world: 'leaf',      t0: 18.20, t1: 22.20, zoom: 0.24 },
  { id: 's3b', world: 'wall',      t0: 21.70, t1: 25.20, zoom: 0.22 },
  { id: 's3c', world: 'leaf',      t0: 24.70, t1: 30.40, zoom: -0.14 },
  // Scene 4 — the cause of transpiration pull
  { id: 's4a', world: 'wall',      t0: 29.90, t1: 34.40, zoom: 0.2 },
  { id: 's4b', world: 'leaf',      t0: 33.90, t1: 36.30, zoom: -0.16 },
  { id: 's4c', world: 'xylem',     t0: 35.80, t1: 38.70, zoom: 0.16 },
  // Scene 5 — cohesion, adhesion, hydrogen bonds
  { id: 's5a', world: 'molecules', t0: 38.20, t1: 45.90, zoom: 0.22 },
  { id: 's5b', world: 'molecules', t0: 45.40, t1: 49.80, zoom: 0.08 },
  // Scene 6 — stomatal control and recap
  { id: 's6a', world: 'stoma',     t0: 49.30, t1: 56.90, zoom: -0.12 },
  { id: 's6b', world: 'tree',      t0: 56.40, t1: 64.00, zoom: -0.18 },
];

const CHAPTERS = [
  { num: '01', title: 'Absorption', sub: 'Root hair cells · osmosis', t0: 0.9, t1: 10.55 },
  { num: '02', title: 'The xylem', sub: 'A continuous column of liquid water', t0: 10.95, t1: 18.05 },
  { num: '03', title: 'Evaporation in the leaf', sub: 'Mesophyll cell walls · air spaces · stomata', t0: 18.45, t1: 29.75 },
  { num: '04', title: 'Transpiration pull', sub: 'Evaporation creates tension', t0: 30.15, t1: 38.05 },
  { num: '05', title: 'Cohesion & adhesion', sub: 'Hydrogen bonds hold the column together', t0: 38.45, t1: 49.15 },
  { num: '06', title: 'Stomatal control', sub: 'Guard cells balance CO₂ uptake and water loss', t0: 49.55, t1: 56.55 },
];

export function globals(ov, t) {
  for (const c of CHAPTERS) ov.chapter(c, t);
}
