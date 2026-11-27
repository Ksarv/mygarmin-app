// On-device pose model (MediaPipe Pose Landmarker) and the video side of the
// technique analysis. The model files are published with the app
// (vendor/mediapipe, added at deploy); the official CDN is the fallback.
// The video never leaves the phone.
import { KEEP } from './pose.js';

export const MP_VERSION = '0.10.14';
const LOCAL = new URL('../vendor/mediapipe/', import.meta.url).href;
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/`;
const MODEL_CDN = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

let landmarker = null;
// Timestamps must grow for the whole life of the model, across videos.
let clock = 0;
export const modelInfo = { source: null, delegate: null };
/** After a model error the graph stays broken: drop it so the next run starts fresh. */
export function resetModel() { try { landmarker?.close?.(); } catch { /* already gone */ } landmarker = null; clock = 0; }

/** Load once; GPU first, CPU if the GPU path fails. Tests may provide globalThis.__poseLandmarker. */
export async function loadModel(onStatus = () => {}) {
  if (globalThis.__poseLandmarker) { modelInfo.source = 'test'; return globalThis.__poseLandmarker; }
  if (landmarker) return landmarker;
  let vision, base = LOCAL, model = LOCAL + 'pose_landmarker_full.task';
  onStatus('Завантажую модель розпізнавання пози (≈ 20 МБ, лише перший раз)…');
  try {
    const head = await fetch(LOCAL + 'vision_bundle.mjs', { method: 'HEAD' });
    if (!head.ok) throw new Error('no local model');
    vision = await import(LOCAL + 'vision_bundle.mjs');
  } catch {
    base = CDN; model = MODEL_CDN;
    vision = await import(CDN + 'vision_bundle.mjs');
  }
  const fileset = await vision.FilesetResolver.forVisionTasks(base + 'wasm');
  let last = null;
  for (const delegate of ['GPU', 'CPU']) {
    try {
      landmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: model, delegate }, runningMode: 'VIDEO', numPoses: 1,
        minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      });
      Object.assign(modelInfo, { source: base === LOCAL ? 'app' : 'cdn', delegate });
      return landmarker;
    } catch (e) { last = e; }
  }
  throw last ?? new Error('Модель не завантажилась');
}

const once = (el, ev) => new Promise((resolve, reject) => {
  const ok = () => { el.removeEventListener('error', bad); resolve(); };
  const bad = () => { el.removeEventListener(ev, ok); reject(new Error('Відео не відкривається в браузері')); };
  el.addEventListener(ev, ok, { once: true });
  el.addEventListener('error', bad, { once: true });
});
const r4 = (v) => Math.round(v * 1e4) / 1e4;

/**
 * Run the model over a video file at a fixed frame rate.
 * @returns {{ frames: {t, lm}[], width, height, duration, fps, video, url }}
 */
export async function processVideo(file, lm, { onProgress = () => {}, maxSeconds = 90, signal } = {}) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  Object.assign(video, { muted: true, playsInline: true, preload: 'auto', src: url });
  await once(video, 'loadeddata');
  const duration = Math.min(video.duration || 0, maxSeconds);
  if (!duration) throw new Error('Не вдалося прочитати тривалість відео');
  const fps = duration > 45 ? 10 : 15;
  const frames = [];
  const total = Math.floor(duration * fps);
  const base = clock + 1000;
  for (let k = 0; k < total; k += 1) {
    if (signal?.aborted) throw new Error('Скасовано');
    const t = k / fps;
    video.currentTime = t;
    await once(video, 'seeked');
    const ts = base + Math.round(t * 1000);
    clock = ts;
    const res = lm.detectForVideo(video, ts);
    const pts = res?.landmarks?.[0];
    frames.push({ t, lm: pts ? pts.map((p, i) => (KEEP.includes(i) ? [r4(p.x), r4(p.y), r4(p.z ?? 0), Math.round((p.visibility ?? 1) * 100) / 100] : null)) : null });
    if (k % 3 === 0) { onProgress((k + 1) / total, k + 1, total); await new Promise((r) => setTimeout(r, 0)); }
  }
  onProgress(1, total, total);
  return { frames, width: video.videoWidth, height: video.videoHeight, duration, fps, video, url };
}

const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [27, 29], [29, 31], [27, 31], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32], [0, 7], [0, 8]];
const NEAR = { L: new Set([11, 13, 15, 23, 25, 27, 29, 31, 7]), R: new Set([12, 14, 16, 24, 26, 28, 30, 32, 8]) };
/** Skeleton over a video frame; the analysed side bright, the far side dim. */
export function drawPose(ctx, lm, w, h, side = 'L', label = '') {
  if (!lm) return;
  ctx.lineCap = 'round';
  for (const [a, b] of BONES) {
    const p = lm[a], q = lm[b];
    if (!p || !q || p[3] < 0.3 || q[3] < 0.3) continue;
    const near = NEAR[side].has(a) && NEAR[side].has(b);
    ctx.strokeStyle = near ? 'rgba(255, 196, 0, .95)' : 'rgba(120, 200, 255, .6)';
    ctx.lineWidth = Math.max(2, w / 160) * (near ? 1.3 : 0.9);
    ctx.beginPath(); ctx.moveTo(p[0] * w, p[1] * h); ctx.lineTo(q[0] * w, q[1] * h); ctx.stroke();
  }
  for (const i of KEEP) {
    const p = lm[i];
    if (!p || p[3] < 0.3) continue;
    ctx.fillStyle = NEAR[side].has(i) ? '#ffd24d' : '#8fd3ff';
    ctx.beginPath(); ctx.arc(p[0] * w, p[1] * h, Math.max(2.5, w / 130), 0, 2 * Math.PI); ctx.fill();
  }
  if (label) {
    ctx.font = `600 ${Math.round(w / 22)}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(8, 8, ctx.measureText(label).width + 16, w / 22 + 14);
    ctx.fillStyle = '#fff'; ctx.fillText(label, 16, 8 + w / 22 + 3);
  }
}

/** Nearest analysed frame to a playback time. */
export function frameAt(frames, t) {
  if (!frames.length) return null;
  const fps = frames.length > 1 ? 1 / (frames[1].t - frames[0].t) : 15;
  return frames[Math.max(0, Math.min(frames.length - 1, Math.round(t * fps)))];
}

/** Still image of the video at time t with the skeleton, as a JPEG data URL. */
export async function snapshot(video, frames, t, side, { width = 360, label = '' } = {}) {
  video.currentTime = t;
  await once(video, 'seeked');
  const w = width, h = Math.round((video.videoHeight / video.videoWidth) * width);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(video, 0, 0, w, h);
  drawPose(ctx, frameAt(frames, t)?.lm, w, h, side, label);
  return c.toDataURL('image/jpeg', 0.72);
}
