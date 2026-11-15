// Collapse highlight clips: while a clip is "armed", every rendered frame is copied onto a small 2D
// canvas with a burned-in caption (game name, map, play time) and recorded with MediaRecorder.
// A clip starts when a target building collapses (or the run completes) and keeps extending while
// more things fall, up to MAX seconds. The newest finished clip is kept for saving / sharing.
const MAX = 12;
// phones encode the clip while the game is at its busiest (a collapse): a smaller frame and a codec
// they usually encode in hardware (H.264 / VP8 rather than VP9) keep that off the game's back
const PHONE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
const W = PHONE ? 640 : 960;

export const supported = typeof MediaRecorder !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream;

let cap = null, capKey = ''; // the caption bar, pre-drawn
let cv = null, g = null, rec = null, chunks = [], t0 = 0, stopAt = 0, mime = '', final = false;
let clip = null; // { blob, url, ext, final, sec }
const listeners = new Set();

function pickMime() {
  const order = PHONE ? ['video/mp4;codecs=avc1', 'video/webm;codecs=h264', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
    : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=avc1', 'video/mp4'];
  for (const m of order)
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
    rec = new MediaRecorder(cv.captureStream(30), { mimeType: mime || undefined, videoBitsPerSecond: PHONE ? 2_500_000 : 4_000_000 });
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
  // caption bar: drawn once per new text (the time changes every second), then just copied each frame
  const key = caption.map + '|' + caption.time;
  if (key !== capKey) {
    capKey = key;
    const c = cap.getContext('2d');
    c.clearRect(0, 0, W, 46);
    c.fillStyle = 'rgba(10,11,14,0.62)'; c.fillRect(0, 0, W, 46);
    c.fillStyle = '#3182f6'; c.font = '800 22px "Pretendard Variable", Pretendard, sans-serif'; c.textBaseline = 'middle';
    c.fillText('회사 때려부수기', 16, 23);
    c.fillStyle = '#ffffff'; c.font = '600 18px "Pretendard Variable", Pretendard, sans-serif';
    c.fillText(caption.map, 190, 23);
    c.textAlign = 'right'; c.fillText(caption.time, W - 16, 23); c.textAlign = 'left';
  }
  g.drawImage(cap, 0, h - 46);
  if (performance.now() / 1000 > stopAt && rec.state === 'recording') rec.stop();
}

export function init() {
  if (!supported) return;
  cv = document.createElement('canvas'); cv.width = W; cv.height = 540;
  // must live in the document or some browsers never emit frames from captureStream
  cv.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1';
  document.body.appendChild(cv);
  g = cv.getContext('2d');
  cap = document.createElement('canvas'); cap.width = W; cap.height = 46;
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
