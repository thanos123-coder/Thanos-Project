// Entry point: builds the Film from the master timeline, the shot list and the worlds.
import { Film } from './engine/core.js';
import { SHOTS, globals, WORLDS } from './shots.js';

const q = new URLSearchParams(location.search);
const TL = await (await fetch('../timeline.json')).json();
const W = +(q.get('w') || TL.width), H = +(q.get('h') || TL.height);
const film = new Film({ W, H, fps: TL.fps, duration: TL.duration, shots: SHOTS, worlds: WORLDS, globals });
film.debug = { nodof: q.has('nodof'), nobloom: q.has('nobloom') }; // profiling switches
try {
  await film.init();
  window.film = film;
  window.ready = true;
} catch (e) {
  window.initError = String(e && e.stack || e);
  throw e;
}
