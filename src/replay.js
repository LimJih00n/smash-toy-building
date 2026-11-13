// Collapse highlight clips: while a clip is "armed", every rendered frame is copied onto a small 2D
// canvas with a burned-in caption (game name, map, play time) and recorded with MediaRecorder.
// A clip starts when a target building collapses (or the run completes) and keeps extending while
// more things fall, up to MAX seconds. The newest finished clip is kept for saving / sharing.
const MAX = 12;
const W = 960;

export const supported = typeof MediaRecorder !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream;

let cv = null, g = null, rec = null, chunks = [], t0 = 0, stopAt = 0, mime = '', final = false;
let clip = null; // { blob, url, ext, final, sec }
const listeners = new Set();

function pickMime() {
  for (const m of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=avc1', 'video/mp4'])
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
  return '';
}

/** start recording (or keep the current recording going) for at least `sec` more seconds */
export function trigger(sec = 6, isFinal = false) {
  if (!supported) return;
  const now = performance.now() / 1000;
  if (isFinal) final = true;
  if (rec) { stopAt = Math.min(t0 + MAX, Math.max(stopAt, now + sec)); return; }
  try {
    mime = pickMime();
    rec = new MediaRecorder(cv.captureStream(30), { mimeType: mime || undefined, videoBitsPerSecond: 4_000_000 });
  } catch (e) { rec = null; return; }
  chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    const type = mime.split(';')[0] || 'video/webm';
    const blob = new Blob(chunks, { type });
    if (window.SMASH_DEBUG) console.warn('replay stop', chunks.length, blob.size, type);
    if (blob.size > 500) {
      if (clip) URL.revokeObjectURL(clip.url);
      clip = { blob, url: URL.createObjectURL(blob), ext: type.includes('mp4') ? 'mp4' : 'webm', final, sec: Math.round(performance.now() / 1000 - t0) };
      listeners.forEach((f) => f(clip));
    }
    rec = null; final = false;
  };
  t0 = now; stopAt = now + sec;
  rec.onerror = (e) => console.warn('replay recorder error', e && e.error);
  rec.start(500);
  const watch = () => { if (!rec) return; if (performance.now() / 1000 > stopAt && rec.state === 'recording') rec.stop(); else setTimeout(watch, 250); };
  setTimeout(watch, 250);
}

/** call right after the WebGL frame is rendered (same task, so the drawing buffer is still valid) */
export function tick(glCanvas, caption) {
  if (!rec) return;
  _ticks++;
  const h = Math.round(W * glCanvas.height / glCanvas.width);
  if (cv.height !== h) cv.height = h;
  g.drawImage(glCanvas, 0, 0, W, h);
  // caption bar
  g.fillStyle = 'rgba(10,11,14,0.62)'; g.fillRect(0, h - 46, W, 46);
  g.fillStyle = '#ff5a36'; g.font = '700 22px "Black Han Sans", sans-serif'; g.textBaseline = 'middle';
  g.fillText('회사 때려부수기', 16, h - 23);
  g.fillStyle = '#ffffff'; g.font = '600 18px sans-serif';
  g.fillText(caption.map, 190, h - 23);
  g.textAlign = 'right'; g.fillText(caption.time, W - 16, h - 23); g.textAlign = 'left';
  if (performance.now() / 1000 > stopAt && rec.state === 'recording') rec.stop();
}

export function init() {
  if (!supported) return;
  cv = document.createElement('canvas'); cv.width = W; cv.height = 540;
  // must live in the document or some browsers never emit frames from captureStream
  cv.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1';
  document.body.appendChild(cv);
  g = cv.getContext('2d');
}
export const recording = () => !!rec;
export const latest = () => clip;
export function onClip(f) { listeners.add(f); }
export function reset() {
  if (rec && rec.state === 'recording') { rec.onstop = () => { rec = null; }; rec.stop(); }
  rec = null; final = false;
}
export const _debug = () => ({ cv: cv && [cv.width, cv.height, !!cv.parentNode], rec: rec && rec.state, ticks: _ticks });
export const _canvas = () => cv;
let _ticks = 0;
