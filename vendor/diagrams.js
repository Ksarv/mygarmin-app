// Exercise animations for the phone app.
//
// A small 2D skeleton with fixed bone lengths: poses are segment angles, so
// limbs never stretch. Every scene pins one point of the body (a foot on the
// floor, hands on a bar, the pelvis on a seat); optional second constraints
// rotate the body so another point touches the floor, and two-bone IK keeps a
// hand or foot on a target (a bench, a pedal, the thigh). Keyframes carry
// their own durations and phase labels, so the player can show the tempo
// ("Опускання · 2 с") in sync with the movement.
//
// Angles are in degrees from straight down: 0 = down, 90 = forward (to the
// right, where the figure faces), 180 = up, −90 = back.
(function (root) {
'use strict';
const W = 240, H = 176, F = 168;
const LEN = { trunk: 50, neck: 7, head: 10.5, upper: 26, fore: 24, thigh: 41, shin: 39, foot: 14 };
const D2R = Math.PI / 180;
const dir = (a) => [Math.sin(a * D2R), Math.cos(a * D2R)];
const add = (p, v, k = 1) => [p[0] + v[0] * k, p[1] + v[1] * k];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = (v) => Math.hypot(v[0], v[1]);
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const BASE = { t: 180, n: null, an: 4, fn: 10, af: -6, ff: 2, ln: 1, sn: -1, lf: -2, sf: -2, pn: 90, pf: 90, curve: 0, sh: 0, shx: 0, face: 1, roll: 0, aroll: 0 };
const P = (...parts) => Object.assign({}, BASE, ...parts);
// roll / aroll turn the legs / arms out of the drawing plane around the trunk axis (3D only).
const ANGLES = ['t', 'n', 'an', 'fn', 'af', 'ff', 'ln', 'sn', 'lf', 'sf', 'pn', 'pf', 'curve', 'sh', 'shx', 'roll', 'aroll'];
const SWAP = { an: 'af', fn: 'ff', ln: 'lf', sn: 'sf', pn: 'pf', af: 'an', ff: 'fn', lf: 'ln', sf: 'sn', pf: 'pn' };

// ---------------------------------------------------------------- skeleton --
function joints(p, view) {
  const J = {};
  J.pelvis = [0, 0];
  const td = dir(p.t);
  const perp = [-td[1], td[0]];
  J.faceDir = [perp[0] * p.face, perp[1] * p.face];
  J.neck = add(J.pelvis, td, LEN.trunk);
  let sh = add(J.pelvis, td, LEN.trunk - 5 + (p.sh || 0));
  if (view === 'front') {
    J.shN = add(sh, perp, 14); J.shF = add(sh, perp, -14);
    J.hipN = add(J.pelvis, perp, 8); J.hipF = add(J.pelvis, perp, -8);
  } else {
    sh = add(sh, J.faceDir, p.shx || 0);
    J.shN = sh; J.shF = sh; J.hipN = J.pelvis; J.hipF = J.pelvis;
  }
  J.head = add(J.neck, dir(p.n ?? p.t), LEN.neck + LEN.head);
  for (const s of ['N', 'F']) {
    const k = s === 'N' ? 'n' : 'f';
    J['elbow' + s] = add(J['sh' + s], dir(p['a' + k]), LEN.upper);
    J['hand' + s] = add(J['elbow' + s], dir(p['f' + k]), LEN.fore);
    J['knee' + s] = add(J['hip' + s], dir(p['l' + k]), LEN.thigh);
    J['ankle' + s] = add(J['knee' + s], dir(p['s' + k]), LEN.shin);
    J['toe' + s] = add(J['ankle' + s], dir(p['p' + k]), LEN.foot);
    J['heel' + s] = add(J['ankle' + s], dir(p['p' + k]), -3);
  }
  J.hands = mid(J.handN, J.handF);
  J.feet = mid(J.ankleN, J.ankleF);
  return J;
}
const POINTS = ['pelvis', 'neck', 'head', 'shN', 'shF', 'hipN', 'hipF', 'elbowN', 'elbowF', 'handN', 'handF', 'kneeN', 'kneeF', 'ankleN', 'ankleF', 'toeN', 'toeF', 'heelN', 'heelF', 'hands', 'feet'];
function moveAll(J, f) { for (const k of POINTS) J[k] = f(J[k]); }

function place(J, A) {
  const at = A.at;
  if (A.ground) {
    const ys = ['toeN', 'toeF', 'heelN', 'heelF'].map((k) => J[k][1]);
    const dx = at[0] - J[A.j || 'pelvis'][0], dy = F - 3 - Math.max(...ys) - (A.lift || 0);
    moveAll(J, (q) => [q[0] + dx, q[1] + dy]);
    return;
  }
  const a = J[A.j];
  const dx = at[0] - a[0], dy = at[1] - a[1] - (A.lift || 0);
  moveAll(J, (q) => [q[0] + dx, q[1] + dy]);
  if (A.j2) {
    // Rotate around the anchor so a second point lands on a given height.
    const c = J[A.j], v = sub(J[A.j2], c), R = len(v);
    if (R > 1) {
      const k = Math.max(-1, Math.min(1, (A.y2 - c[1]) / R));
      const phi = Math.atan2(v[1], v[0]);
      const norm = (x) => Math.atan2(Math.sin(x), Math.cos(x));
      const t1 = norm(Math.asin(k) - phi), t2 = norm(Math.PI - Math.asin(k) - phi);
      const th = Math.abs(t1) < Math.abs(t2) ? t1 : t2;
      const cs = Math.cos(th), sn = Math.sin(th);
      moveAll(J, (q) => { const x = q[0] - c[0], y = q[1] - c[1]; return [c[0] + x * cs - y * sn, c[1] + x * sn + y * cs]; });
      J.faceDir = [J.faceDir[0] * cs - J.faceDir[1] * sn, J.faceDir[0] * sn + J.faceDir[1] * cs];
    }
  }
}

// Two-bone IK: put the end of an arm or leg on a target, keep segment lengths.
function reach(base, target, a, b, bendDir) {
  let v = sub(target, base);
  let d = len(v);
  const max = a + b - 0.5;
  if (d > max) { v = [v[0] * max / d, v[1] * max / d]; d = max; }
  const u = [v[0] / d, v[1] / d];
  const along = (a * a - b * b + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a * a - along * along));
  const n1 = [-u[1], u[0]];
  const sign = n1[0] * bendDir[0] + n1[1] * bendDir[1] >= 0 ? 1 : -1;
  const j = add(add(base, u, along), n1, h * sign);
  return [j, add(base, v)];
}
function solveIK(J, ik, p) {
  for (const [key, spec] of Object.entries(ik || {})) {
    if (!spec) continue;
    const side = key.endsWith('N') ? 'N' : 'F';
    const target = spec.to ? add(J[spec.to], spec.off || [0, 0]) : spec.at;
    const bend = spec.bend === 'back' ? [-J.faceDir[0], -J.faceDir[1]] : Array.isArray(spec.bend) ? spec.bend : J.faceDir;
    if (key.startsWith('leg')) {
      const [knee, ankle] = reach(J['hip' + side], target, LEN.thigh, LEN.shin, bend);
      J['knee' + side] = knee; J['ankle' + side] = ankle;
      const pd = dir(p[side === 'N' ? 'pn' : 'pf']);
      J['toe' + side] = add(ankle, pd, LEN.foot);
      J['heel' + side] = add(ankle, pd, -3);
    } else {
      const [elbow, hand] = reach(J['sh' + side], target, LEN.upper, LEN.fore, bend);
      J['elbow' + side] = elbow; J['hand' + side] = hand;
    }
  }
  J.hands = mid(J.handN, J.handF);
  J.feet = mid(J.ankleN, J.ankleF);
}

// ------------------------------------------------------------------ scenes --
const scenes = {};
function S(key, def) { scenes[key] = def; }
const lerpPose = (a, b, t) => { const o = { ...b }; for (const k of ANGLES) { const x = a[k] ?? (k === 'n' ? a.t : 0), y = b[k] ?? (k === 'n' ? b.t : 0); o[k] = lerp(x, y, t); } return o; };
const swapPose = (p) => { const o = { ...p }; for (const [a, b] of Object.entries(SWAP)) o[a] = p[b]; return o; };
const lerpPt = (a, b, t) => (a && b ? [lerp(a[0], b[0], t), lerp(a[1], b[1], t)] : b || a);
function lerpIK(a = {}, b = {}, t) {
  const out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k], y = b[k];
    if (!x || !y || x.to || y.to) { out[k] = t < 0.5 ? x : y; continue; }
    out[k] = { ...y, at: lerpPt(x.at, y.at, t) };
  }
  return out;
}

/** Keyframes → timeline. Each key: { p, d (seconds to reach it), label, at?, lift?, ik? }. */
function timeline(sc) {
  const keys = [...sc.keys];
  if (sc.closed !== true) keys.push({ ...keys[0], d: sc.back ?? 1, label: sc.backLabel ?? 'Повернення' });
  const total = keys.reduce((s, k) => s + k.d, 0);
  return { keys, total: sc.mirror ? total * 2 : total, half: total };
}
function frameAt(sc, time) {
  if (sc.dyn) return sc.dyn(time);
  const tl = sc._tl || (sc._tl = timeline(sc));
  let t = ((time % tl.total) + tl.total) % tl.total;
  let mirrored = false;
  if (sc.mirror && t >= tl.half) { t -= tl.half; mirrored = true; }
  const k = tl.keys;
  let acc = 0, i = 0;
  for (; i < k.length; i += 1) { if (t < acc + k[i].d) break; acc += k[i].d; }
  i = Math.min(i, k.length - 1);
  const prev = k[Math.max(0, i - 1)], cur = k[i];
  const raw = i === 0 ? 1 : (t - acc) / cur.d;
  const e = ease(Math.max(0, Math.min(1, raw)));
  const remaining = Math.max(0, cur.d - (t - acc));
  let p = i === 0 ? cur.p : lerpPose(prev.p, cur.p, e);
  if (mirrored && sc.mirror === 'limbs') p = swapPose(p);
  const anchor = { ...sc.anchor, at: lerpPt(i === 0 ? cur.at : prev.at, cur.at, e) || sc.anchor.at, lift: lerp(i === 0 ? cur.lift || 0 : prev.lift || 0, cur.lift || 0, e) };
  const ik = { ...(sc.ik || {}), ...lerpIK(i === 0 ? cur.ik : prev.ik, cur.ik, e) };
  return { p, anchor, ik, label: cur.label, remaining, mirrored: mirrored && sc.mirror === 'x', side: mirrored };
}
function pose(sc, time) {
  const f = frameAt(sc, time);
  const J = joints(f.p, sc.view);
  place(J, f.anchor);
  solveIK(J, f.ik, f.p);
  return { J, f };
}

// ------------------------------------------------------------------ render --
const C = {
  skin: '#d9a07a', skinFar: '#b8825f', shirt: '#1b8577', shirtFar: '#13635a', shorts: '#26405a', shortsFar: '#1b2e42',
  shoe: '#2f3640', hair: '#3a2a22', metal: '#8a97a1', steel: '#5e6b75', pad: '#3f4d59', plate: '#2b3138', floor: '#c3ccc8',
  trace: '#d2852c', ghost: '#9fb0aa', cable: '#7d8b94',
};
const seg = (a, b, color, w, extra = '') => `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"${extra}/>`;
const dot = (c, r, color, extra = '') => `<circle cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="${r}" fill="${color}"${extra}/>`;

function body(J, view, side, opt = {}) {
  const far = side === 'F';
  const skin = far ? C.skinFar : C.skin, shirt = far ? C.shirtFar : C.shirt, shorts = far ? C.shortsFar : C.shorts;
  const off = view === 'side' && far && !opt.flat ? [-2.5, -1.5] : [0, 0];
  const o = (k) => add(J[k + side], off);
  let s = '';
  if (opt.part !== 'arm') {
    const hip = o('hip'), knee = o('knee'), ankle = o('ankle');
    s += seg(hip, knee, shorts, 12.5) + seg(mid(hip, knee), knee, skin, 11) + seg(knee, ankle, skin, 9.5);
    s += seg(o('heel'), o('toe'), C.shoe, 6);
  }
  if (opt.part !== 'leg') {
    const sh = o('sh'), el = o('elbow'), hand = o('hand');
    s += seg(sh, el, skin, 8.5) + seg(sh, lerpPt(sh, el, 0.45), shirt, 10) + seg(el, hand, skin, 7.5) + dot(hand, 4, skin);
  }
  return s;
}
function torso(J, view) {
  const pel = J.pelvis, sh = view === 'front' ? mid(J.shN, J.shF) : J.shN;
  const neck = J.neck;
  let s = '';
  if (view === 'front') {
    s += seg(J.hipN, J.hipF, C.shorts, 16) + seg(J.shN, J.shF, C.shirt, 16);
    s += `<path d="M${J.shF.map((v) => v.toFixed(1)).join(' ')}L${J.shN.map((v) => v.toFixed(1)).join(' ')}L${J.hipN.map((v) => v.toFixed(1)).join(' ')}L${J.hipF.map((v) => v.toFixed(1)).join(' ')}Z" fill="${C.shirt}" stroke="${C.shirt}" stroke-width="8" stroke-linejoin="round"/>`;
    s += seg(J.hipN, J.hipF, C.shorts, 12);
  } else {
    const m = mid(pel, sh);
    const fd = J.faceDir;
    const ctrl = add(m, fd, -(J.curve || 0) * 2);
    s += `<path d="M${pel[0].toFixed(1)} ${pel[1].toFixed(1)}Q${ctrl[0].toFixed(1)} ${ctrl[1].toFixed(1)} ${sh[0].toFixed(1)} ${sh[1].toFixed(1)}" fill="none" stroke="${C.shirt}" stroke-width="21" stroke-linecap="round"/>`;
    s += seg(pel, lerpPt(pel, sh, 0.16), C.shorts, 21);
  }
  s += seg(neck, add(neck, sub(J.head, neck), 0.45), C.skin, 7);
  // Head: hair behind, face towards faceDir.
  const fd = view === 'front' ? [0, 0] : J.faceDir;
  s += dot(J.head, LEN.head + 0.6, C.hair) + dot(add(J.head, fd, 2.2), LEN.head - 0.6, C.skin);
  if (view === 'side') s += dot(add(add(J.head, fd, 7), sub(J.head, J.neck), 0.05), 1.1, '#2b2118');
  return s;
}

// Props: drawn in world coordinates; some follow joints.
function props(sc, J, layer, time) {
  let s = '';
  for (const pr of sc.props || []) {
    if ((pr.layer || 'back') !== layer) continue;
    const P2 = (q) => (typeof q === 'string' ? J[q] : q);
    switch (pr.type) {
      case 'bench': s += seg([pr.x1 + 6, pr.y + 4], [pr.x1 + 6, F], C.steel, 4) + seg([pr.x2 - 6, pr.y + 4], [pr.x2 - 6, F], C.steel, 4) + seg([pr.x1, pr.y], [pr.x2, pr.y], C.pad, 8); break;
      case 'bar': s += (pr.posts !== false ? seg([pr.x1, pr.y], [pr.x1, F], C.steel, 3.5) + seg([pr.x2, pr.y], [pr.x2, F], C.steel, 3.5) : '') + seg([pr.x1 - 4, pr.y], [pr.x2 + 4, pr.y], C.metal, 4); break;
      case 'line': s += seg(P2(pr.a), P2(pr.b), pr.color || C.pad, pr.w || 8); break;
      case 'post': s += seg(P2(pr.a), P2(pr.b), C.steel, pr.w || 4); break;
      case 'roller': s += dot(P2(pr.at), pr.r || 5.5, C.pad); break;
      case 'wall': s += `<rect x="${pr.x}" y="0" width="${pr.w || 8}" height="${F}" fill="#dfe6e3"/>`; break;
      case 'backwall': s += `<rect x="${pr.x1}" y="${pr.y || 10}" width="${pr.x2 - pr.x1}" height="${F - (pr.y || 10)}" rx="3" fill="#e3e9e6"/>`; break;
      case 'mat': s += `<rect x="${pr.x1}" y="${F - 3}" width="${pr.x2 - pr.x1}" height="4" rx="2" fill="#9dbdb4"/>`; break;
      case 'column': s += seg([pr.x, 0], [pr.x, F], C.steel, 6) + dot([pr.x, pr.y], 4.5, C.metal); break;
      case 'cable': { const from = P2(pr.from), to = P2(pr.to); s += seg(from, to, C.cable, 1.6); if (pr.grip) s += seg(add(to, [-6, 0]), add(to, [6, 0]), C.steel, 3.5); break; }
      case 'dumbbell': { const h = P2(pr.at); const v = pr.vertical ? [0, 1] : [1, 0]; s += seg(add(h, v, -6), add(h, v, 6), C.steel, 2.5) + seg(add(h, v, -7), add(h, v, -4), C.plate, 7) + seg(add(h, v, 4), add(h, v, 7), C.plate, 7); break; }
      case 'barbell': { const h = P2(pr.at); s += seg(add(h, [-9, 0]), add(h, [9, 0]), C.steel, 2.5) + dot(h, pr.r || 11, C.plate, ' opacity=".92"') + dot(h, 2.5, C.metal); break; }
      case 'ezbar': { const h = P2(pr.at); s += `<path d="M${h[0] - 9} ${h[1]}l3 -2 3 3 3 -3 3 3 3 -2" fill="none" stroke="${C.steel}" stroke-width="2.4"/>` + dot(h, 7, C.plate, ' opacity=".9"'); break; }
      case 'cone': s += `<path d="M${pr.x - 5} ${F}L${pr.x} ${F - 12}L${pr.x + 5} ${F}Z" fill="#e07a2e"/>` + seg([pr.x - 14, F + 1], [pr.x + 14, F + 1], '#e0a23a', 2); break;
      case 'rope': {
        const a = J.handN, b = J.handF, ph = Math.cos((time / (pr.period || 0.45)) * 2 * Math.PI);
        const top = Math.min(a[1], b[1]) - 60, bottom = F + 1;
        const cy = lerp(bottom, top, (ph + 1) / 2);
        s += `<path d="M${a[0].toFixed(1)} ${a[1].toFixed(1)}Q${((a[0] + b[0]) / 2).toFixed(1)} ${cy.toFixed(1)} ${b[0].toFixed(1)} ${b[1].toFixed(1)}" fill="none" stroke="#6a4c93" stroke-width="1.8"/>`;
        break;
      }
      case 'box': s += `<rect x="${pr.x1}" y="${pr.y}" width="${pr.x2 - pr.x1}" height="${F - pr.y}" rx="3" fill="#56697a"/>`; break;
      case 'pedal': s += seg(add(P2(pr.at), [-8, 4]), add(P2(pr.at), [10, 4]), C.steel, 4); break;
      case 'poly': s += `<path d="M${pr.pts.map((q) => q.join(' ')).join('L')}Z" fill="${pr.color || C.pad}"/>`; break;
      default: break;
    }
  }
  return s;
}

function figure(sc, J, opt = {}) {
  const v = sc.view;
  let s = '';
  s += body(J, v, 'F', { part: 'leg' }) + body(J, v, 'F', { part: 'arm' });
  s += props(sc, J, 'mid', opt.time || 0);
  s += torso({ ...J, curve: opt.curve }, v);
  s += body(J, v, 'N', { part: 'leg' }) + body(J, v, 'N', { part: 'arm' });
  return s;
}

function traceOf(sc) {
  if (sc._trace !== undefined) return sc._trace;
  sc._trace = '';
  if (!sc.trace || sc.dyn) return '';
  const tl = sc._tl || (sc._tl = timeline(sc));
  const pts = [];
  const n = 64, span = sc.mirror === 'x' ? tl.half : tl.total;
  for (let i = 0; i <= n; i += 1) { const { J } = pose(sc, (span * i) / n); pts.push(J[sc.trace]); }
  sc._trace = `<polyline points="${pts.map((q) => q.map((x) => x.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="${C.trace}" stroke-width="1.4" stroke-dasharray="3 3" opacity=".7"/>`;
  return sc._trace;
}
function ghostOf(sc) {
  if (sc._ghost !== undefined) return sc._ghost;
  sc._ghost = '';
  if (sc.ghost == null || sc.dyn) return '';
  const k = sc.keys[sc.ghost];
  const J = joints(k.p, sc.view);
  place(J, { ...sc.anchor, at: k.at || sc.anchor.at, lift: k.lift || 0 });
  solveIK(J, { ...(sc.ik || {}), ...(k.ik || {}) }, k.p);
  const g = C.ghost;
  const L = (a, b, w) => seg(J[a], J[b], g, w);
  let s = '';
  for (const x of ['N', 'F']) s += L('hip' + x, 'knee' + x, 10) + L('knee' + x, 'ankle' + x, 8) + L('sh' + x, 'elbow' + x, 7) + L('elbow' + x, 'hand' + x, 6);
  s += seg(J.pelvis, sc.view === 'front' ? mid(J.shN, J.shF) : J.shN, g, 17) + dot(J.head, LEN.head, g);
  sc._ghost = `<g opacity=".28">${s}</g>`;
  return sc._ghost;
}

function render(key, time) {
  const sc = scenes[key];
  const { J, f } = pose(sc, time);
  let s = '';
  if (sc.floor !== false) s += seg([6, F + 1], [W - 6, F + 1], C.floor, 2);
  s += props(sc, J, 'back', time);
  s += ghostOf(sc) + traceOf(sc);
  s += figure(sc, J, { curve: f.p.curve, time });
  s += props(sc, J, 'front', time);
  if (f.mirrored) s = `<g transform="translate(${W} 0) scale(-1 1)">${s}</g>`;
  if (sc.zoom) { const [z, cx, cy] = sc.zoom; s = `<g transform="translate(${cx} ${cy}) scale(${z}) translate(${-cx} ${-cy})">${s}</g>`; }
  if (sc.rotate) s = `<g transform="rotate(${sc.rotate} ${W / 2} ${H / 2})">${s}</g>`;
  return { svg: s, label: f.label, remaining: f.remaining, side: f.side };
}

// ------------------------------------------------------------ 3D renderer --
// The same poses, lifted to 3D (left/right limbs get their own depth) and
// drawn from a three-quarter view with shaded, volumetric body parts and
// equipment. Painter's algorithm: everything is sorted by depth.
const CAM = { yaw: 32 * D2R, pitch: 13 * D2R, cx: 120 };
const BODY = {
  skin: '#e2b593', skinDark: '#b98761', skinLight: '#f3d3b8',
  shirt: '#3b4652', shirtDark: '#262e37', shirtLight: '#5d6b79',
  shorts: '#20262d', shortsDark: '#14181d', shortsLight: '#3a434d',
  shoe: '#eef1f3', sole: '#3a3f45', hair: '#3b2c24',
  metal: '#9aa6af', metalDark: '#66727c', pad: '#2f3a44', padLight: '#4c5a66', floor: '#e9edeb', floorEdge: '#d5dcd9',
};
// A scene may look from its own angle ({ cam: { yaw, pitch } } in degrees), e.g. from higher up for floor work.
const CUR = { yaw: CAM.yaw, front: 75 * D2R, pitch: CAM.pitch };
function useCam(sc) {
  CUR.yaw = sc.cam?.yaw != null ? sc.cam.yaw * D2R : CAM.yaw;
  CUR.front = sc.cam?.yaw != null ? sc.cam.yaw * D2R : 75 * D2R;
  CUR.pitch = sc.cam?.pitch != null ? sc.cam.pitch * D2R : CAM.pitch;
}
function proj(p, view) {
  const X = p[0] - CAM.cx, Y = p[1], Z = p[2];
  const yaw = view === 'front' ? CUR.front : CUR.yaw;
  const sx = CAM.cx + X * Math.cos(yaw) - Z * Math.sin(yaw);
  const depth = X * Math.sin(yaw) + Z * Math.cos(yaw);
  const sy = F + (Y - F) * Math.cos(CUR.pitch) + depth * Math.sin(CUR.pitch) * 0.55;
  return { x: sx, y: sy, d: depth };
}
function lift(J, sc, p) {
  const P3 = {};
  const front = sc.view === 'front';
  const zs = { sh: 15, elbow: sc.elbowsZ ?? 16, hand: sc.handsZ ?? 14, hip: 9, knee: sc.kneesZ ?? 10, ankle: sc.feetZ ?? 9, toe: sc.feetZ ?? 9, heel: sc.feetZ ?? 9 };
  for (const k of POINTS) {
    const q = J[k];
    if (!q) continue;
    if (front) { P3[k] = [CAM.cx, q[1], -(q[0] - CAM.cx)]; continue; }
    const m = k.match(/^(sh|elbow|hand|hip|knee|ankle|toe|heel)([NF])$/);
    const z = m ? zs[m[1]] * (m[2] === 'N' ? 1 : -1) : 0;
    P3[k] = [q[0], q[1], z];
  }
  if (!front && p) {
    // Out-of-plane turns around the trunk axis: legs fall to one side (twists), arms open into a "T".
    const ax = norm3([P3.neck[0] - P3.pelvis[0], P3.neck[1] - P3.pelvis[1], 0]);
    const turn = (keys, centre, deg) => { if (!deg) return; for (const k of keys) P3[k] = rotAbout(P3[k], centre, ax, deg * D2R); };
    turn(['hipN', 'hipF', 'kneeN', 'kneeF', 'ankleN', 'ankleF', 'toeN', 'toeF', 'heelN', 'heelF'], P3.pelvis, p.roll);
    turn(['elbowN', 'handN'], P3.shN, p.aroll);
    turn(['elbowF', 'handF'], P3.shF, -(p.aroll || 0));
    if (p.roll || p.aroll) { P3.hands = toward(P3.handN, P3.handF, 0.5); P3.feet = toward(P3.ankleN, P3.ankleF, 0.5); }
  }
  return P3;
}
const norm3 = (v) => { const n = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };
/** Rodrigues rotation of point q around the axis u through c. Positive angles bring points toward the camera (+z). */
function rotAbout(q, c, u, a) {
  const v = [q[0] - c[0], q[1] - c[1], q[2] - c[2]];
  const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const dt = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const sgn = u[0] >= 0 ? -1 : 1; // keep "positive = toward the viewer" whichever way the body lies
  const ca = Math.cos(a * sgn), sa = Math.sin(a * sgn);
  return [0, 1, 2].map((i) => c[i] + v[i] * ca + cr[i] * sa + u[i] * dt * (1 - ca));
}
const toward = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
function capsule(a, b, w, base, dark, light) {
  const n = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = -(b.y - a.y) / n, ny = (b.x - a.x) / n;
  const s = nx * -0.7 + ny * -0.7 > 0 ? 1 : -1; // side facing the light (upper left)
  const o = (k) => ({ x: nx * s * k, y: ny * s * k });
  const L = (p, q, c, wd, off = { x: 0, y: 0 }) => `<line x1="${(p.x + off.x).toFixed(1)}" y1="${(p.y + off.y).toFixed(1)}" x2="${(q.x + off.x).toFixed(1)}" y2="${(q.y + off.y).toFixed(1)}" stroke="${c}" stroke-width="${wd.toFixed(1)}" stroke-linecap="round"/>`;
  return L(a, b, dark, w) + L(a, b, base, w * 0.8, o(w * 0.08)) + L(a, b, light, w * 0.3, o(w * 0.22));
}
function sphere(c, r, base, dark, light) {
  return `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${dark}"/><circle cx="${(c.x - r * 0.08).toFixed(1)}" cy="${(c.y - r * 0.08).toFixed(1)}" r="${(r * 0.86).toFixed(1)}" fill="${base}"/><circle cx="${(c.x - r * 0.32).toFixed(1)}" cy="${(c.y - r * 0.34).toFixed(1)}" r="${(r * 0.34).toFixed(1)}" fill="${light}" opacity=".55"/>`;
}
function poly3(pts, view, fill, extra = '') {
  const q = pts.map((p) => proj(p, view));
  return { d: q.reduce((a, b) => a + b.d, 0) / q.length, svg: `<path d="M${q.map((v) => `${v.x.toFixed(1)} ${v.y.toFixed(1)}`).join('L')}Z" fill="${fill}"${extra}/>` };
}
function box3(x1, x2, y1, y2, z1, z2, view, top, side, front) {
  // Visible faces for a camera on the +Z, +X side: top, near (z2) and front (x2).
  const items = [];
  items.push(poly3([[x1, y1, z2], [x2, y1, z2], [x2, y2, z2], [x1, y2, z2]], view, side));
  items.push(poly3([[x2, y1, z1], [x2, y1, z2], [x2, y2, z2], [x2, y2, z1]], view, front));
  items.push(poly3([[x1, y1, z1], [x2, y1, z1], [x2, y1, z2], [x1, y1, z2]], view, top));
  return { d: Math.max(...items.map((i) => i.d)), svg: items.map((i) => i.svg).join('') };
}
function rod3(a, b, w, view, c1 = BODY.metal, c2 = BODY.metalDark) {
  const p = proj(a, view), q = proj(b, view);
  return { d: (p.d + q.d) / 2, svg: capsule(p, q, w, c1, c2, '#d9e0e5') };
}
function props3(sc, J, P3, time) {
  const v = sc.view, out = [];
  const at = (q) => (typeof q === 'string' ? P3[q] : [q[0], q[1], 0]);
  for (const pr of sc.props || []) {
    switch (pr.type) {
      case 'bench': {
        out.push(box3(pr.x1, pr.x2, pr.y - 4, pr.y + 4, -17, 17, v, BODY.padLight, BODY.pad, BODY.pad));
        for (const x of [pr.x1 + 7, pr.x2 - 7]) for (const z of [-12, 12]) out.push(rod3([x, pr.y + 4, z], [x, F, z], 3.5, v));
        break;
      }
      case 'box': out.push(box3(pr.x1, pr.x2, pr.y, F, -pr.z, pr.z, v, '#7d8f9c', '#5a6b78', '#4a5965')); break;
      case 'bar':
        if (pr.axis === 'z') {
          out.push(rod3([pr.x, pr.y, -62], [pr.x, pr.y, 62], 4, v));
          out.push(rod3([pr.x, pr.y, -62], [pr.x, pr.y - 16, -62], 4, v), rod3([pr.x, pr.y, 62], [pr.x, pr.y - 16, 62], 4, v));
        } else {
          for (const z of [-24, 24]) {
            out.push(rod3([pr.x1, pr.y, z], [pr.x2, pr.y, z], 4.5, v));
            if (pr.posts !== false) out.push(rod3([pr.x1 + 4, pr.y, z], [pr.x1 + 4, F, z], 4, v), rod3([pr.x2 - 4, pr.y, z], [pr.x2 - 4, F, z], 4, v));
          }
        }
        break;
      case 'line': {
        const a = at(pr.a), b = at(pr.b), w = (pr.w || 8) / 2;
        const dx = b[0] - a[0], dy = b[1] - a[1], n = Math.hypot(dx, dy) || 1, nx = -dy / n * w, ny = dx / n * w;
        out.push(box3Seg(a, b, nx, ny, v, pr.color === C.steel ? BODY.metalDark : BODY.pad, pr.z));
        break;
      }
      case 'post': out.push(rod3(at(pr.a), at(pr.b), pr.w || 4, v)); break;
      case 'roller': { const c = at(pr.at); out.push(rod3([c[0], c[1], -17], [c[0], c[1], 17], (pr.r || 5.5) * 2, v, BODY.pad, '#1d252c')); break; }
      case 'wall': out.push(poly3([[pr.x, 0, -70], [pr.x, 0, 70], [pr.x, F, 70], [pr.x, F, -70]], v, '#e4e9e7')); out[out.length - 1].d = -999; break;
      case 'backwall': out.push(poly3([[CAM.cx - 40, 8, -(pr.x1 - CAM.cx)], [CAM.cx - 40, 8, -(pr.x2 - CAM.cx)], [CAM.cx - 40, F, -(pr.x2 - CAM.cx)], [CAM.cx - 40, F, -(pr.x1 - CAM.cx)]], v, '#e4e9e7')); out[out.length - 1].d = -999; break;
      case 'mat': out.push(poly3([[pr.x1, F - 0.5, -26], [pr.x2, F - 0.5, -26], [pr.x2, F - 0.5, 26], [pr.x1, F - 0.5, 26]], v, '#a9c4bc')); out[out.length - 1].d = -900; break;
      case 'column': out.push(box3(pr.x - 4, pr.x + 4, 0, F, -5, 5, v, BODY.metal, BODY.metalDark, '#7b8790')); { const c = proj([pr.x, pr.y, 0], v); out.push({ d: c.d + 6, svg: `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="4.5" fill="${BODY.metal}" stroke="${BODY.metalDark}"/>` }); } break;
      case 'cable': {
        const a = proj(at(pr.from), v), hand = P3[pr.to] || at(pr.to);
        const mid = sc.view === 'front' ? hand : [hand[0], hand[1], 0];
        const b = proj(mid, v);
        out.push({ d: Math.max(a.d, b.d) + 1, svg: `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="#5d6a73" stroke-width="1.4"/>` + (pr.grip ? rod3([hand[0], hand[1], -16], [hand[0], hand[1], 16], 3, v).svg : '') });
        break;
      }
      case 'dumbbell': {
        const h = P3[pr.at] || at(pr.at);
        if (pr.vertical) out.push(dumbbell3([h[0], h[1] - 7, 0], [h[0], h[1] + 7, 0], v));
        else out.push(dumbbell3([h[0], h[1], h[2] - 7], [h[0], h[1], h[2] + 7], v));
        break;
      }
      case 'barbell': case 'ezbar': {
        const h = P3.hands ? [ (P3.handN[0] + P3.handF[0]) / 2, (P3.handN[1] + P3.handF[1]) / 2, 0] : at(pr.at);
        const half = pr.type === 'barbell' ? 58 : 34, r = pr.type === 'barbell' ? 12 : 8;
        out.push(rod3([h[0], h[1], -half], [h[0], h[1], half], 2.6, v));
        for (const z of [-(half - 8), half - 8]) { const c = proj([h[0], h[1], z], v); out.push({ d: c.d, svg: `<ellipse cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" rx="${(r * Math.cos(CAM.yaw)).toFixed(1)}" ry="${r}" fill="#2b3138" stroke="#14181d"/>` }); }
        break;
      }
      case 'cone': { const c = proj([pr.x, F, 0], v); out.push({ d: c.d, svg: `<path d="M${c.x - 6} ${c.y}L${c.x} ${c.y - 13}L${c.x + 6} ${c.y}Z" fill="#e07a2e"/><ellipse cx="${c.x}" cy="${c.y}" rx="7" ry="2.5" fill="#b85f1f"/>` }); break; }
      case 'rope': {
        const a = proj(P3.handN, v), b = proj(P3.handF, v), ph = Math.cos((time / (pr.period || 0.45)) * 2 * Math.PI);
        const top = Math.min(a.y, b.y) - 62, bottom = F + 2, cy = lerp(bottom, top, (ph + 1) / 2);
        out.push({ d: ph > 0 ? -50 : 50, svg: `<path d="M${a.x.toFixed(1)} ${a.y.toFixed(1)}Q${((a.x + b.x) / 2).toFixed(1)} ${cy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}" fill="none" stroke="#6a4c93" stroke-width="1.8"/>` });
        break;
      }
      case 'elliptical': {
        // Rear flywheel, base frame, pedal rails under the feet, moving handles and the console post.
        const fw = [50, F - 34], R = 19;
        out.push(box3(36, 204, F - 6, F, -22, 22, v, BODY.metal, BODY.metalDark, '#7b8790'));
        for (const z of [-24, 24]) {
          const c = proj([fw[0], fw[1], z], v);
          out.push({ d: c.d - (z < 0 ? 40 : -2), svg: `<ellipse cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" rx="${(R * Math.cos(CAM.yaw) * 0.55).toFixed(1)}" ry="${R}" fill="${z < 0 ? '#3a434c' : '#4d5862'}" stroke="#262e37" stroke-width="1"/>` });
        }
        out.push(box3(fw[0] - 10, fw[0] + 10, fw[1] - R + 4, F - 6, -22, 22, v, '#5d6974', '#46525c', '#3a444d'));
        out.push(rod3([190, F - 6, 0], [176, 30, 0], 7, v));
        out.push(box3(166, 184, 18, 32, -11, 11, v, '#4d5862', '#3a434c', '#2e363e'));
        for (const sd of ['N', 'F']) {
          const z = sd === 'N' ? 13 : -13, heel = P3['heel' + sd], toe = P3['toe' + sd], hand = P3['hand' + sd];
          const sole = (q, k) => [q[0], q[1] + 4.5, z + k];
          const pedal = poly3([sole(heel, -5), sole(toe, -5), sole(toe, 5), sole(heel, 5)], v, '#2b3138');
          pedal.d -= 3;
          const arm = rod3([fw[0] + 8, fw[1] + 4, z], [heel[0], heel[1] + 6, z], 4.5, v, BODY.metal, BODY.metalDark);
          arm.d -= 4;
          const link = rod3([toe[0], toe[1] + 6, z], [176, 112, z * 1.3], 4, v, BODY.metal, BODY.metalDark);
          link.d -= 4;
          const handle = rod3([176, 112, z * 1.3], [hand[0] + 2, hand[1] - 10, z * 1.3], 4.5, v, BODY.metal, BODY.metalDark);
          if (sd === 'F') { handle.d -= 30; link.d -= 30; arm.d -= 30; pedal.d -= 30; }
          out.push(pedal, arm, link, handle);
        }
        break;
      }
      case 'pedal': break;
      case 'poly': out.push(poly3(pr.pts.map((q) => [q[0], q[1], 0]), v, pr.color || BODY.pad)); break;
      default: break;
    }
  }
  return out;
}
function box3Seg(a, b, nx, ny, v, color, zz) {
  const z = zz ?? 17;
  const p = [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]];
  const near = poly3(p.map((q) => [q[0], q[1], z]), v, color);
  const top = poly3([[p[0][0], p[0][1], -z], [p[1][0], p[1][1], -z], [p[1][0], p[1][1], z], [p[0][0], p[0][1], z]], v, BODY.padLight);
  return { d: near.d, svg: top.svg + near.svg };
}
function dumbbell3(a, b, v) {
  const pa = proj(a, v), pb = proj(b, v);
  const plate = (c) => `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="5.2" fill="#2b3138" stroke="#14181d" stroke-width="1"/>`;
  return { d: (pa.d + pb.d) / 2 + 2, svg: `<line x1="${pa.x.toFixed(1)}" y1="${pa.y.toFixed(1)}" x2="${pb.x.toFixed(1)}" y2="${pb.y.toFixed(1)}" stroke="${BODY.metal}" stroke-width="2.6"/>${plate(pa)}${plate(pb)}` };
}
function body3(sc, J, P3, f) {
  const v = sc.view, out = [];
  const pr = (k) => proj(P3[k], v);
  const limb = (a, b, w, c, d, l, bias = 0) => { const p = pr(a), q = pr(b); out.push({ d: (p.d + q.d) / 2 + bias, svg: capsule(p, q, w, c, d, l) }); };
  for (const s of ['N', 'F']) {
    limb('hip' + s, 'knee' + s, 12, BODY.shorts, BODY.shortsDark, BODY.shortsLight, 0.5);
    { const a = P3['hip' + s], b = P3['knee' + s], m = toward(a, b, 0.45); const p = proj(m, v), q = proj(b, v); out.push({ d: (p.d + q.d) / 2 + 0.6, svg: capsule(p, q, 11, BODY.skin, BODY.skinDark, BODY.skinLight) }); }
    limb('knee' + s, 'ankle' + s, 9.5, BODY.skin, BODY.skinDark, BODY.skinLight);
    { const p = pr('heel' + s), q = pr('toe' + s); out.push({ d: (p.d + q.d) / 2 + 0.2, svg: capsule(p, q, 7, BODY.shoe, BODY.sole, '#ffffff') }); }
    limb('sh' + s, 'elbow' + s, 8.5, BODY.skin, BODY.skinDark, BODY.skinLight, 0.4);
    { const a = P3['sh' + s], b = P3['elbow' + s], m = toward(a, b, 0.5); const p = proj(a, v), q = proj(m, v); out.push({ d: (p.d + q.d) / 2 + 0.5, svg: capsule(p, q, 10.5, BODY.shirt, BODY.shirtDark, BODY.shirtLight) }); }
    limb('elbow' + s, 'hand' + s, 7.5, BODY.skin, BODY.skinDark, BODY.skinLight, 0.3);
    { const p = pr('hand' + s); out.push({ d: p.d + 0.4, svg: sphere(p, 4, BODY.skin, BODY.skinDark, BODY.skinLight) }); }
  }
  // Torso: a shaded volume around the spine, slightly curved for cat/cow.
  const pel = P3.pelvis, sh = sc.view === 'front' ? toward(P3.shN, P3.shF, 0.5) : [P3.shN[0], P3.shN[1], 0];
  const p = proj(pel, v), q = proj(sh, v);
  const m = proj(toward(pel, sh, 0.55), v);
  const fd = J.faceDir, cv = (f.p.curve || 0) * 2;
  const mc = { x: m.x - fd[0] * cv * Math.cos(CAM.yaw), y: m.y - fd[1] * cv, d: m.d };
  const torso = `<path d="M${p.x.toFixed(1)} ${p.y.toFixed(1)}Q${mc.x.toFixed(1)} ${mc.y.toFixed(1)} ${q.x.toFixed(1)} ${q.y.toFixed(1)}" fill="none" stroke="${BODY.shirtDark}" stroke-width="27" stroke-linecap="round"/>`
    + `<path d="M${p.x.toFixed(1)} ${p.y.toFixed(1)}Q${mc.x.toFixed(1)} ${mc.y.toFixed(1)} ${q.x.toFixed(1)} ${q.y.toFixed(1)}" fill="none" stroke="${BODY.shirt}" stroke-width="22.5" stroke-linecap="round" transform="translate(-1.2 -1.2)"/>`
    + `<path d="M${p.x.toFixed(1)} ${p.y.toFixed(1)}Q${mc.x.toFixed(1)} ${mc.y.toFixed(1)} ${q.x.toFixed(1)} ${q.y.toFixed(1)}" fill="none" stroke="${BODY.shirtLight}" stroke-width="6" stroke-linecap="round" opacity=".6" transform="translate(-4.5 -4)"/>`
    + capsule(p, proj(toward(pel, sh, 0.12), v), 23, BODY.shorts, BODY.shortsDark, BODY.shortsLight);
  out.push({ d: (p.d + q.d) / 2, svg: torso });
  // Neck and head
  const neck = proj(P3.neck, v), head = proj(P3.head, v);
  const hd = { x: head.x, y: head.y, d: head.d };
  const fx = sc.view === 'front' ? 0 : fd[0] * Math.cos(CAM.yaw), fy = sc.view === 'front' ? 0 : fd[1];
  out.push({ d: head.d + 0.2, svg: capsule(neck, { x: lerp(neck.x, head.x, 0.5), y: lerp(neck.y, head.y, 0.5) }, 7.5, BODY.skin, BODY.skinDark, BODY.skinLight)
    + `<circle cx="${(hd.x - fx * 2).toFixed(1)}" cy="${(hd.y - fy * 2 - 1).toFixed(1)}" r="${LEN.head + 0.8}" fill="${BODY.hair}"/>`
    + sphere({ x: hd.x + fx * 1.6, y: hd.y + fy * 1.6 + 0.6 }, LEN.head - 0.4, BODY.skin, BODY.skinDark, BODY.skinLight)
    + (sc.view === 'front' ? '' : `<circle cx="${(hd.x + fx * 8.2).toFixed(1)}" cy="${(hd.y + fy * 8.2 - 1.5).toFixed(1)}" r="1.1" fill="#2b2118"/>`) });
  return out;
}
function render3d(key, time) {
  const sc = scenes[key];
  useCam(sc);
  const { J, f } = pose(sc, time);
  const P3 = lift(J, sc, f.p);
  const v = sc.view;
  let s = '';
  if (sc.floor !== false) {
    const fl = poly3([[0, F + 2, -70], [W, F + 2, -70], [W, F + 2, 70], [0, F + 2, 70]], v, BODY.floor).svg;
    s += fl;
    // Soft contact shadow under the body.
    const c = proj([P3.pelvis[0], F + 2, 0], v);
    s += `<ellipse cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" rx="34" ry="6" fill="#000" opacity=".08"/>`;
  }
  const items = [...props3(sc, J, P3, time), ...body3(sc, J, P3, f)];
  items.sort((a, b) => a.d - b.d);
  // Everything but the floor sits in .fig, so lists can crop a still frame to the figure.
  s += `<g class="fig">${sc.trace && !sc.dyn ? trace3(sc) : ''}${items.map((i) => i.svg).join('')}</g>`;
  if (f.mirrored) s = `<g transform="translate(${W} 0) scale(-1 1)">${s}</g>`;
  if (sc.zoom) { const [z, cx, cy] = sc.zoom; s = `<g transform="translate(${cx} ${cy}) scale(${z}) translate(${-cx} ${-cy})">${s}</g>`; }
  return { svg: s, label: f.label, remaining: f.remaining, side: f.side };
}
function trace3(sc) {
  if (sc._trace3 !== undefined) return sc._trace3;
  useCam(sc);
  const tl = sc._tl || (sc._tl = timeline(sc));
  const n = 48, span = sc.mirror === 'x' ? tl.half : tl.total, pts = [];
  for (let i = 0; i <= n; i += 1) { const { J, f } = pose(sc, (span * i) / n); const p = proj(lift(J, sc, f.p)[sc.trace], sc.view); pts.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`); }
  sc._trace3 = `<polyline points="${pts.join(' ')}" fill="none" stroke="${C.trace}" stroke-width="1.3" stroke-dasharray="3 3" opacity=".6"/>`;
  return sc._trace3;
}

// ------------------------------------------------------------- base poses --
const STAND = P();
const HANG = { an: 0, fn: 0, af: 0, ff: 0 };
const ON = (x) => ({ j: 'ankleN', at: [x, F - 4] });
const quadAnchor = { j: 'pelvis', at: [100, F - 46] };
const QUAD = P({ t: 98, n: 105, an: 0, fn: 0, af: 0, ff: 0, ln: 0, sn: -90, lf: 0, sf: -90, pn: -96, pf: -96 });
const SUPINE = P({ t: -90, n: -90, an: 92, fn: 92, af: 92, ff: 92, ln: 90, sn: 90, lf: 90, sf: 90, pn: 180, pf: 180 });
const PRONE = P({ t: 90, n: 92, an: 96, fn: 94, af: 96, ff: 94, ln: -90, sn: -90, lf: -90, sf: -90, pn: -100, pf: -100 });
const SEATED = P({ ln: 82, sn: 0, lf: 82, sf: 0 });
const LONGSIT = P({ ln: 90, sn: 90, lf: 90, sf: 90, pn: 175, pf: 175 });
const HOLD = (label = 'Тримай · дихай рівно', d = 3) => ({ d, label });

// ---- squats, hinges, lunges
S('air_squat', { view: 'side', anchor: ON(112), trace: 'pelvis', ghost: 1, feetZ: 13, kneesZ: 14, cue: 'Таз униз і назад, коліна в напрямку носків, п’яти на підлозі.', keys: [
  { p: P({ an: 5, fn: 12 }), d: 0.7, label: 'Стійка' },
  { p: P({ t: 146, n: 152, ln: 88, sn: -32, lf: 86, sf: -32, an: 90, fn: 92, af: 86, ff: 90 }), d: 2, label: 'Присідання · 2 с' },
  { p: P({ t: 146, n: 152, ln: 88, sn: -32, lf: 86, sf: -32, an: 90, fn: 92, af: 86, ff: 90 }), d: 0.3, label: 'Нижня точка' },
], back: 1, backLabel: 'Підйом через усю стопу' });
S('goblet', { view: 'side', anchor: ON(112), trace: 'pelvis', ghost: 1, handsZ: 3, elbowsZ: 12, feetZ: 13, kneesZ: 14, cue: 'Гантель вертикально біля грудей. Таз опускається між стопами, груди вгору.',
  props: [{ type: 'dumbbell', at: 'handN', vertical: true, layer: 'front' }], keys: [
  { p: P({ an: 24, fn: 166, af: 20, ff: 166 }), d: 0.7, label: 'Стійка, гантель біля грудей' },
  { p: P({ t: 152, n: 160, ln: 88, sn: -30, lf: 86, sf: -30, an: 46, fn: 172, af: 42, ff: 172 }), d: 2, label: 'Присідання · 2 с' },
  { p: P({ t: 152, n: 160, ln: 88, sn: -30, lf: 86, sf: -30, an: 46, fn: 172, af: 42, ff: 172 }), d: 0.3, label: 'Нижня точка' },
], back: 1, backLabel: 'Підйом через усю стопу' });
const rdlTop = P({ ...HANG, an: -3, af: -3, ln: 0, sn: 0, lf: 0, sf: 0 });
const rdlLow = P({ t: 100, n: 118, ln: 16, sn: -4, lf: 16, sf: -4, ...HANG });
S('deadlift', { view: 'side', anchor: ON(112), trace: 'handN', ghost: 1, cue: 'Таз назад, спина рівна, гантелі ковзають уздовж ніг до середини гомілки.',
  props: [{ type: 'dumbbell', at: 'handF', layer: 'mid' }, { type: 'dumbbell', at: 'handN', layer: 'front' }], keys: [
  { p: rdlTop, d: 0.6, label: 'Стійка, гантелі біля стегон' },
  { p: rdlLow, d: 2.5, label: 'Таз назад · 2–3 с' },
  { p: rdlLow, d: 0.4, label: 'Натяг задньої поверхні стегна' },
], back: 1.2, backLabel: 'Підйом: сідниці вперед' });
const slTop = P({ ...HANG, lf: -4, sf: -8 });
const slLow = P({ t: 95, n: 108, ln: 10, sn: -3, lf: -85, sf: -87, pf: 0, ...HANG });
S('sl_rdl', { view: 'side', anchor: ON(108), trace: 'toeF', ghost: 1, cue: 'Нахил від таза на одній нозі, вільна нога назад в одну лінію з корпусом.',
  props: [{ type: 'dumbbell', at: 'handF', layer: 'mid' }], keys: [
  { p: slTop, d: 0.6, label: 'Стійка на одній нозі' },
  { p: slLow, d: 2.5, label: 'Нахил від таза · 2–3 с' },
  { p: slLow, d: 0.4, label: 'Тіло — літера «Т»' },
], back: 1.3, backLabel: 'Повернення, сідниця опорної ноги' });
const lungeStep = P({ ...HANG, ln: 18, sn: -8, lf: -36, sf: -36, pf: 30 });
const lungeLow = P({ ...HANG, t: 179, ln: 82, sn: -8, lf: -22, sf: -100, pf: 22 });
S('reverse', { thumb: 2, view: 'side', anchor: ON(132), trace: 'kneeF', ghost: 2, cue: 'Крок назад, заднє коліно майже до підлоги, корпус рівно.',
  props: [{ type: 'dumbbell', at: 'handF', layer: 'mid' }], keys: [
  { p: P(HANG), d: 0.5, label: 'Стійка' },
  { p: lungeStep, d: 0.9, label: 'Крок назад' },
  { p: lungeLow, d: 1.4, label: 'Опускання' },
  { p: lungeStep, d: 1, label: 'Підйом передньою п’ятою' },
], back: 0.7, backLabel: 'Стопи разом' });
S('split_squat', { view: 'side', anchor: ON(140), trace: 'pelvis', ghost: 1, cue: 'Задня стопа на лаві, таз опускається вертикально, переднє коліно над стопою.',
  props: [{ type: 'bench', x1: 40, x2: 90, y: F - 44 }, { type: 'dumbbell', at: 'handN', layer: 'front' }],
  ik: { legF: { at: [74, F - 50], bend: 'face' } }, keys: [
  { p: P({ ...HANG, ln: 22, sn: -8, pf: 10 }), d: 0.6, label: 'Стійка, задня стопа на лаві' },
  { p: P({ ...HANG, t: 178, ln: 80, sn: -10, pf: 10 }), d: 2, label: 'Опускання · 2 с' },
], back: 1.2, backLabel: 'Підйом передньою п’ятою' });
const sideW = P({ ...HANG, an: 22, fn: -70, af: -22, ff: 70, lf: -24, sf: -24 });
const stepBench = [{ type: 'bench', x1: 120, x2: 200, y: F - 40 }];
S('step_up', { view: 'side', anchor: { j: 'pelvis', at: [100, F - 84] }, zoom: [0.8, 120, F], trace: 'pelvis', cue: 'Уся стопа на лаві, підйом ногою на лаві; спуск так само по черзі. Розмовний темп.',
  props: stepBench, closed: true, keys: [
  { p: P({ pn: 90, pf: 90 }), d: 0.4, at: [100, F - 82], label: 'Стійка перед лавою', ik: { legN: { at: [104, F - 4] }, legF: { at: [100, F - 4] } } },
  { p: P({ t: 170, pn: 90, pf: 90, an: -20, af: 30, ff: 60 }), d: 0.6, at: [112, F - 92], label: 'Ведуча нога на лаву', ik: { legN: { at: [136, F - 47] }, legF: { at: [100, F - 4] } } },
  { p: P({ t: 178, pn: 90, pf: 90 }), d: 0.7, at: [132, F - 124], label: 'Підйом на лаву', ik: { legN: { at: [138, F - 47] }, legF: { at: [128, F - 47] } } },
  { p: P({ t: 176, pn: 90, pf: 90 }), d: 0.6, at: [112, F - 92], label: 'Крок униз', ik: { legN: { at: [136, F - 47] }, legF: { at: [100, F - 4] } } },
  { p: P({ pn: 90, pf: 90 }), d: 0.5, at: [100, F - 82], label: 'Друга нога вниз', ik: { legN: { at: [104, F - 4] }, legF: { at: [100, F - 4] } } },
] });
const BOX = F - 48;
const boxProps = [{ type: 'box', x1: 146, x2: 206, y: BOX, z: 24 }];
const onFloor = { legN: { at: [102, F - 4] }, legF: { at: [98, F - 4] } };
const onBox = { legN: { at: [176, BOX - 4] }, legF: { at: [172, BOX - 4] } };
S('box_jump', { view: 'side', anchor: { j: 'pelvis', at: [100, F - 82] }, zoom: [0.76, 120, F], trace: 'pelvis', closed: true,
  cue: 'Замах руками, вибуховий стрибок, м’яке приземлення в напівприсід. Униз — кроком.', props: boxProps, keys: [
  { p: P({ pn: 90, pf: 90 }), d: 0.6, at: [100, F - 82], label: 'Стійка перед кубом', ik: onFloor },
  { p: P({ t: 146, n: 156, an: -55, fn: -40, af: -55, ff: -40, pn: 90, pf: 90 }), d: 0.5, at: [94, F - 66], label: 'Чверть присіду, руки назад', ik: onFloor },
  { p: P({ t: 172, an: 150, fn: 160, af: 150, ff: 160, pn: 60, pf: 60 }), d: 0.35, at: [134, F - 120], label: 'Вибуховий стрибок', ik: { legN: { at: [150, F - 62] }, legF: { at: [146, F - 60] } } },
  { p: P({ t: 150, n: 158, an: 70, fn: 80, af: 70, ff: 80, pn: 90, pf: 90 }), d: 0.3, at: [164, BOX - 64], label: 'М’яке приземлення', ik: onBox },
  { p: P({ pn: 90, pf: 90 }), d: 0.7, at: [172, BOX - 82], label: 'Випрямись на кубі', ik: onBox },
  { p: P({ t: 176, pn: 90, pf: 90 }), d: 0.8, at: [150, F - 96], label: 'Униз кроком', ik: { legN: { at: [176, BOX - 4] }, legF: { at: [128, F - 4] } } },
  { p: P({ pn: 90, pf: 90 }), d: 1, at: [100, F - 82], label: 'Повернись на старт', ik: onFloor },
] });
S('native_wide_side_lunge', { view: 'front', anchor: { j: 'ankleF', at: [70, F - 4] }, ik: { legN: { at: [172, F - 4], bend: [1, 0] } }, trace: 'pelvis', ghost: 1, mirror: 'x',
  cue: 'Широка стійка. Таз назад і вбік, одне коліно згинається, друга нога пряма.', keys: [
  { p: sideW, d: 0.6, label: 'Широка стійка' },
  { p: P({ ...sideW, t: 176, lf: -52, sf: -52 }), d: 1.8, label: 'Бічний випад · 2 с' },
  { p: P({ ...sideW, t: 176, lf: -52, sf: -52 }), d: 0.6, label: 'Пряма нога розтягується' },
], back: 1.2, backLabel: 'Повернення в центр' });
const calfBase = P({ an: 48, fn: 84, af: 40, ff: 80, lf: -12, sf: -88, pf: -40 });
S('calf_sl', { view: 'side', anchor: { j: 'toeN', at: [130, F - 4] }, trace: 'ankleN', cue: 'На одній нозі підніми п’яту якомога вище, опускай 2 с.',
  props: [{ type: 'wall', x: 190 }], keys: [
  { p: calfBase, d: 0.6, label: 'Стійка на одній нозі' },
  { p: P({ ...calfBase, pn: 42 }), d: 1, label: 'Підйом · 1 с' },
  { p: P({ ...calfBase, pn: 42 }), d: 0.6, label: 'Пауза вгорі' },
], back: 2, backLabel: 'Опускання · 2 с' });

// ---- presses, pushups, dips
const plank = P({ t: 98, n: 104, ...HANG, ln: -82, sn: -82, lf: -82, sf: -82, pn: 24, pf: 24 });
const plankLow = P({ t: 94, n: 100, an: -52, fn: 38, af: -52, ff: 38, ln: -86, sn: -86, lf: -86, sf: -86, pn: 24, pf: 24 });
S('pushup', { view: 'side', anchor: { j: 'handN', at: [176, F - 2], j2: 'toeN', y2: F - 1 }, trace: 'neck', ghost: 1, cue: 'Тіло — пряма лінія. Лікті 30–60° до тулуба, груди майже до підлоги.', keys: [
  { p: plank, d: 0.6, label: 'Упор на прямих руках' },
  { p: plankLow, d: 1.6, label: 'Опускання · 1–2 с' },
  { p: plankLow, d: 0.2, label: 'Груди біля підлоги' },
], back: 1, backLabel: 'Відштовхнись' });
S('pushup_decline', { view: 'side', anchor: { j: 'handN', at: [182, F - 2], j2: 'toeN', y2: F - 42 }, trace: 'neck', ghost: 1, cue: 'Стопи на лаві. Опускайся єдиною лінією, поперек не прогинається.',
  props: [{ type: 'bench', x1: 18, x2: 70, y: F - 38 }], keys: [
  { p: plank, d: 0.6, label: 'Стопи на лаві' },
  { p: plankLow, d: 1.6, label: 'Опускання' },
], back: 1, backLabel: 'Відштовхнись' });
const incl = P({ t: 120, n: 124, an: 30, fn: 30, af: 30, ff: 30, ln: -60, sn: -60, lf: -60, sf: -60, pn: 40, pf: 40 });
S('incline', { view: 'side', anchor: { j: 'handN', at: [184, F - 44], j2: 'toeN', y2: F - 1 }, trace: 'neck', ghost: 1, cue: 'Долоні на краю лави, тіло — одна лінія. Груди до краю лави.',
  props: [{ type: 'bench', x1: 170, x2: 230, y: F - 40 }], keys: [
  { p: incl, d: 0.6, label: 'Упор на лаву' },
  { p: P({ ...incl, t: 114, an: -40, fn: 60, af: -40, ff: 60 }), d: 1.5, label: 'Опускання' },
], back: 1, backLabel: 'Відштовхнись' });
const pike = P({ t: 32, n: 20, an: 28, fn: 28, af: 28, ff: 28, ln: -34, sn: -34, lf: -34, sf: -34, pn: 40, pf: 40 });
S('plank_reach', { view: 'side', anchor: { j: 'handF', at: [174, F - 2], j2: 'toeN', y2: F - 1 }, trace: 'handN', cue: 'Упор на прямих руках. Почергово витягни руку вперед на 2 с — таз не повертається.', keys: [
  { p: plank, d: 0.6, label: 'Упор на прямих руках' },
  { p: P({ ...plank, an: 96, fn: 96 }), d: 0.8, label: 'Рука вперед' },
  { p: P({ ...plank, an: 96, fn: 96 }), d: 2, label: 'Утримай 2 с — таз рівно' },
], back: 0.8, backLabel: 'Рука на підлогу' });
S('pike_pushup', { view: 'side', anchor: { j: 'handN', at: [168, F - 2], j2: 'toeN', y2: F - 1 }, trace: 'head', ghost: 1, cue: 'Таз високо. Зігни лікті й опусти верх голови перед долонями.', keys: [
  { p: pike, d: 0.6, label: 'Перевернута «V»' },
  { p: P({ ...pike, t: 22, n: 10, an: -30, fn: 62, af: -30, ff: 62 }), d: 1.6, label: 'Голова до підлоги' },
], back: 1, backLabel: 'Відштовхнись' });
const dipTop = P({ t: 178, n: 180, an: 2, fn: 0, af: 2, ff: 0, ln: -8, sn: -78, lf: -8, sf: -78, pn: 10, pf: 10 });
const dipLow = P({ ...dipTop, t: 162, n: 166, an: -64, fn: 10, af: -64, ff: 10 });
const barsProps = [{ type: 'bar', x1: 80, x2: 176, y: 80 }];
S('dip', { view: 'side', anchor: { j: 'handN', at: [124, 80] }, props: barsProps, trace: 'shN', ghost: 1, cue: 'Опускайся до комфортної глибини, лікті назад, потім вичави вгору.', keys: [
  { p: dipTop, d: 0.6, label: 'Упор на прямих руках' },
  { p: dipLow, d: 2, label: 'Опускання · 2 с' },
  { p: dipLow, d: 0.3, label: 'Плече ≈ паралельно підлозі' },
], back: 1.2, backLabel: 'Вичави вгору' });
S('dip_neg', { view: 'side', anchor: { j: 'handN', at: [124, 80] }, props: barsProps, trace: 'shN', ghost: 1, cue: 'Вийди в упор, опускайся 4 с, далі стань на лаву й повтори.', keys: [
  { p: dipTop, d: 0.8, label: 'Упор на прямих руках' },
  { p: dipLow, d: 4, label: 'Опускання · 4 с' },
  { p: dipLow, d: 0.4, label: 'Нижня точка — стань на лаву' },
], back: 1, backLabel: 'Знову в упор (стрибком або з лави)' });
const benchUp = P({ ...SUPINE, an: 180, fn: 180, af: 180, ff: 180, ln: 75, sn: 0, lf: 75, sf: 0, pn: 90, pf: 90 });
const benchLow = P({ ...benchUp, an: 18, fn: 178, af: 18, ff: 178 });
S('bench', { view: 'side', anchor: { j: 'pelvis', at: [132, F - 53] }, trace: 'handN', ghost: 1, cue: 'Лопатки зведені, гриф до нижньої частини грудей за 2 с, потім жим угору.',
  props: [{ type: 'bench', x1: 60, x2: 150, y: F - 46 }, { type: 'barbell', at: 'hands', layer: 'front' }], keys: [
  { p: benchUp, d: 0.6, label: 'Гриф над плечима' },
  { p: benchLow, d: 2, label: 'Опускання · 2 с' },
  { p: benchLow, d: 0.2, label: 'Торкнись грудей м’яко' },
], back: 1, backLabel: 'Жим угору' });

// ---- pulls
const hang = P({ t: 180, n: 182, an: 178, fn: 180, af: 178, ff: 180, ln: 8, sn: -62, lf: 4, sf: -70, pn: 30, pf: 30 });
const chinUp = P({ ...hang, an: 14, fn: 172, af: 14, ff: 172, n: 186 });
const barTop = [{ type: 'bar', axis: 'z', x: 124, x1: 70, x2: 178, y: 30, posts: false }];
const hangView = { anchor: { j: 'handN', at: [124, 30] }, zoom: [0.8, 120, 30], floor: false };
S('pullup_neg', { view: 'side', ...hangView, props: barTop, trace: 'head', ghost: 0, cue: 'Стрибком у верхню точку, далі опускайся 5 с до прямих рук.', closed: true, keys: [
  { p: chinUp, d: 1, label: 'Верхня точка: підборіддя над перекладиною' },
  { p: hang, d: 5, label: 'Повільне опускання · 5 с' },
  { p: hang, d: 0.6, label: 'Прямі руки — стань на підлогу' },
  { p: chinUp, d: 0.8, label: 'Стрибок угору' },
] });
S('pullup', { view: 'side', ...hangView, props: barTop, trace: 'head', ghost: 1, cue: 'З повного вису тягни лікті до ребер, підборіддя над перекладиною.', keys: [
  { p: hang, d: 0.6, label: 'Повний вис, лопатки вниз' },
  { p: chinUp, d: 1.3, label: 'Лікті до ребер' },
  { p: chinUp, d: 0.4, label: 'Підборіддя над перекладиною' },
], back: 2.5, backLabel: 'Опускання · 2–3 с' });
const hangStraight = P({ ...hang, ln: 3, sn: -14, lf: 1, sf: -18, pn: 60, pf: 60 });
S('hanging_knee_raise', { view: 'side', ...hangView, props: barTop, trace: 'kneeN', ghost: 1, cue: 'Із вису підніми коліна до рівня таза, трохи підкрути таз.', keys: [
  { p: hangStraight, d: 0.6, label: 'Вис, плечі опущені' },
  { p: P({ ...hangStraight, t: 186, ln: 98, sn: 8, lf: 96, sf: 6, pn: 80, pf: 80 }), d: 1.2, label: 'Коліна до таза' },
  { p: P({ ...hangStraight, t: 186, ln: 98, sn: 8, lf: 96, sf: 6, pn: 80, pf: 80 }), d: 0.4, label: 'Пауза' },
], back: 2, backLabel: 'Опускання · 2 с без розгойдування' });
const latSeat = P({ t: 188, n: 186, ln: 82, sn: 0, lf: 82, sf: 0, an: 172, fn: 178, af: 170, ff: 178 });
S('latpulldown', { view: 'side', anchor: { j: 'pelvis', at: [112, 118] }, trace: 'handN', ghost: 1, cue: 'Тягни рукоятку перед обличчям до верхньої частини грудей, лікті вниз.',
  props: [{ type: 'column', x: 74, y: 4 }, { type: 'line', a: [74, 4], b: [118, 4], color: C.steel, w: 4 }, { type: 'bench', x1: 90, x2: 136, y: 124 }, { type: 'roller', at: [146, 106], r: 6, layer: 'front' }, { type: 'cable', from: [118, 4], to: 'handN', grip: true, layer: 'front' }], keys: [
  { p: latSeat, d: 0.6, label: 'Прямі руки, стегна під валиком' },
  { p: P({ ...latSeat, an: -8, fn: 160, af: -10, ff: 160 }), d: 1.2, label: 'Тяга до грудей' },
  { p: P({ ...latSeat, an: -8, fn: 160, af: -10, ff: 160 }), d: 0.4, label: 'Лопатки вниз' },
], back: 2, backLabel: 'Повільно вгору · 2 с' });
const rowSeat = P({ t: 172, n: 176, ln: 100, sn: 80, lf: 100, sf: 80, pn: 168, pf: 168, an: 88, fn: 90, af: 88, ff: 90 });
S('cable_row', { view: 'side', anchor: { j: 'pelvis', at: [70, 134] }, trace: 'handN', ghost: 1, cue: 'Тягни рукоять до низу живота, лікті вздовж тулуба, корпус нерухомий.',
  props: [{ type: 'bench', x1: 36, x2: 112, y: 141 }, { type: 'line', a: [152, 120], b: [152, 150], color: C.steel, w: 5 }, { type: 'column', x: 214, y: 136 }, { type: 'cable', from: [214, 136], to: 'handN', grip: true, layer: 'front' }], keys: [
  { p: rowSeat, d: 0.6, label: 'Руки прямі, спина рівна' },
  { p: P({ ...rowSeat, t: 182, n: 182, an: -58, fn: 84, af: -58, ff: 84 }), d: 1.2, label: 'Тяга до живота' },
  { p: P({ ...rowSeat, t: 182, n: 182, an: -58, fn: 84, af: -58, ff: 84 }), d: 1, label: 'Пауза 1 с, лопатки разом' },
], back: 2, backLabel: 'Повільно вперед · 2 с' });
const facePull0 = P({ an: 100, fn: 102, af: 100, ff: 102 });
S('face_pull', { view: 'side', anchor: ON(100), trace: 'handN', ghost: 1, cue: 'Тягни канат до обличчя: лікті високо й назад, кінці каната біля вух.',
  props: [{ type: 'column', x: 220, y: 30 }, { type: 'cable', from: [220, 30], to: 'handN', layer: 'front' }], keys: [
  { p: facePull0, d: 0.6, label: 'Руки прямі до блока' },
  { p: P({ an: -100, fn: 130, af: -100, ff: 130 }), d: 1.2, label: 'Лікті високо назад' },
  { p: P({ an: -100, fn: 130, af: -100, ff: 130 }), d: 1, label: 'Пауза 1 с біля обличчя' },
], back: 2, backLabel: 'Повільно вперед · 2 с' });
const rowBase = P({ t: 96, n: 104, af: 0, ff: 0, an: 0, fn: 0, lf: 0, sf: -90, pf: -92 });
S('row1', { view: 'side', anchor: { j: 'handF', at: [170, F - 46], j2: 'kneeF', y2: F - 49 }, ik: { legN: { at: [100, F - 4], bend: 'face' } }, trace: 'handN', ghost: 1,
  cue: 'Коліно й долоня на лаві. Лікоть веди вздовж тулуба до таза.',
  props: [{ type: 'bench', x1: 70, x2: 182, y: F - 42 }, { type: 'dumbbell', at: 'handN', layer: 'front' }], keys: [
  { p: rowBase, d: 0.6, label: 'Рука пряма' },
  { p: P({ ...rowBase, an: -104, fn: 4 }), d: 1, label: 'Лікоть до таза' },
  { p: P({ ...rowBase, an: -104, fn: 4 }), d: 0.4, label: 'Пауза' },
], back: 2, backLabel: 'Опускання · 2 с' });
const pallofIn = P({ an: -22, fn: 150, af: -22, ff: 150 });
S('pallof', { view: 'side', anchor: ON(116), trace: 'handN', ghost: 1, cue: 'Боком до блока. Вижми рукоятку від грудей і не дай корпусу повернутися.',
  props: [{ type: 'column', x: 40, y: 72 }, { type: 'cable', from: [40, 72], to: 'handN' }], keys: [
  { p: pallofIn, d: 0.6, label: 'Рукоять біля грудей' },
  { p: P({ an: 92, fn: 90, af: 92, ff: 90 }), d: 1, label: 'Вижми вперед' },
  { p: P({ an: 92, fn: 90, af: 92, ff: 90 }), d: 2, label: 'Утримай 2 с — корпус не крутиться' },
], back: 1.2, backLabel: 'До грудей' });
const prSeat = P({ t: 162, n: 166, ln: 84, sn: 0, lf: 84, sf: 0, an: 48, fn: 70, af: 46, ff: 70 });
S('preacher', { view: 'side', anchor: { j: 'pelvis', at: [84, 124] }, trace: 'handN', ghost: 1, cue: 'Плечі на подушці. Згинай руки до підборіддя, опускай 3 с до майже прямих.',
  props: [{ type: 'bench', x1: 60, x2: 104, y: 130 }, { type: 'line', a: [100, 95], b: [128, 118], color: C.pad, w: 7, z: 12, layer: 'mid' }, { type: 'post', a: [114, 104], b: [108, F] }, { type: 'ezbar', at: 'handN', layer: 'front' }], keys: [
  { p: prSeat, d: 0.6, label: 'Руки майже прямі' },
  { p: P({ ...prSeat, fn: 172, ff: 172 }), d: 1.2, label: 'Згинання' },
  { p: P({ ...prSeat, fn: 172, ff: 172 }), d: 0.4, label: 'Вгорі' },
], back: 3, backLabel: 'Опускання · 3 с' });

// ---- hinge on the bench, core
const hyper = (t, an, fn) => P({ t, n: t + 6, ln: -45, sn: -45, lf: -45, sf: -45, pn: 40, pf: 40, an, fn, af: an + 6, ff: fn });
S('back_ext', { view: 'side', anchor: { j: 'ankleN', at: [54, F - 24] }, trace: 'head', ghost: 0, cue: 'Нахил униз від таза з рівною спиною, підйом до прямої лінії — не вище.',
  props: [{ type: 'line', a: [75, 132], b: [115, 96], color: C.pad, w: 7, z: 13, layer: 'front' }, { type: 'post', a: [86, 116], b: [80, F] }, { type: 'post', a: [48, F - 18], b: [42, F] }, { type: 'roller', at: [48, F - 20], layer: 'front' }], keys: [
  { p: hyper(135, -40, 110), d: 0.8, label: 'Вгорі: пряма лінія від п’ят до голови' },
  { p: hyper(18, -150, 40), d: 2, label: 'Нахил униз · 2 с' },
  { p: hyper(18, -150, 40), d: 0.3, label: 'Натяг задньої поверхні стегна' },
  { p: hyper(135, -40, 110), d: 1.3, label: 'Підйом, сідниці стиснуті' },
], closed: true });
S('deadbug', { view: 'side', anchor: { j: 'pelvis', at: [128, F - 10] }, mirror: 'limbs', trace: 'handN', cue: 'Поперек притиснутий. Повільно опусти протилежні руку й ногу.',
  props: [{ type: 'mat', x1: 40, x2: 210 }], keys: [
  { p: P({ ...SUPINE, an: 178, fn: 178, af: 178, ff: 178, ln: 180, sn: 90, lf: 180, sf: 90, pn: 170, pf: 170 }), d: 0.6, label: 'Руки вгору, коліна над тазом' },
  { p: P({ ...SUPINE, an: -98, fn: -98, af: 178, ff: 178, ln: 180, sn: 90, lf: 96, sf: 96, pn: 170, pf: 170 }), d: 2, label: 'Рука й протилежна нога вниз' },
  { p: P({ ...SUPINE, an: -98, fn: -98, af: 178, ff: 178, ln: 180, sn: 90, lf: 96, sf: 96, pn: 170, pf: 170 }), d: 0.4, label: 'Поперек на підлозі' },
], back: 1.5 });
const bridgeLow = P({ ...SUPINE, t: -90, ln: 148, sn: 24, lf: 148, sf: 24, pn: 90, pf: 90 });
const bridgeHigh = P({ ...SUPINE, t: -64, n: -80, ln: 118, sn: 20, lf: 118, sf: 20, pn: 90, pf: 90 });
S('bridge', { view: 'side', anchor: { j: 'ankleN', at: [160, F - 4], j2: 'shN', y2: F - 9 }, trace: 'pelvis', ghost: 1, cue: 'Стопи на підлозі. Підніми таз до лінії «коліна — плечі».',
  props: [{ type: 'mat', x1: 30, x2: 200 }], keys: [
  { p: bridgeLow, d: 0.6, label: 'Лежачи, стопи на підлозі' },
  { p: bridgeHigh, d: 1.2, label: 'Таз угору' },
  { p: bridgeHigh, d: 1, label: 'Пауза, сідниці стиснуті' },
], back: 2, backLabel: 'Повільно вниз' });
S('sl_bridge', { view: 'side', anchor: { j: 'ankleN', at: [160, F - 4], j2: 'shN', y2: F - 9 }, trace: 'pelvis', ghost: 1, cue: 'Одна нога пряма. Таз угору п’ятою опорної ноги, без перекосу.',
  props: [{ type: 'mat', x1: 30, x2: 200 }], keys: [
  { p: P({ ...bridgeLow, lf: 132, sf: 132, pf: 210 }), d: 0.6, label: 'Одна нога пряма' },
  { p: P({ ...bridgeHigh, lf: 106, sf: 106, pf: 196 }), d: 1.2, label: 'Таз угору' },
  { p: P({ ...bridgeHigh, lf: 106, sf: 106, pf: 196 }), d: 1, label: 'Пауза 1 с' },
], back: 2, backLabel: 'Повільно вниз' });
S('sideplank', { view: 'side', anchor: { j: 'elbowN', at: [164, F - 5], j2: 'ankleN', y2: F - 5 }, trace: 'pelvis', ghost: 1, cue: 'Лікоть під плечем. Підніми таз — тіло в одну лінію, тримай.',
  props: [{ type: 'mat', x1: 30, x2: 210 }], keys: [
  { p: P({ t: 122, n: 120, an: 2, fn: 90, af: 150, ff: 60, ln: -64, sn: -64, lf: -64, sf: -64, pn: 26, pf: 26 }), d: 0.6, label: 'Бічна опора на лікоть' },
  { p: P({ t: 104, n: 104, an: 2, fn: 90, af: 150, ff: 60, ln: -76, sn: -76, lf: -76, sf: -76, pn: 14, pf: 14 }), d: 1, label: 'Таз угору' },
  { p: P({ t: 104, n: 104, an: 2, fn: 90, af: 150, ff: 60, ln: -76, sn: -76, lf: -76, sf: -76, pn: 14, pf: 14 }), ...HOLD('Тримай лінію · дихай') },
], back: 1, backLabel: 'Опусти таз' });
S('birddog', { view: 'side', anchor: quadAnchor, mirror: 'limbs', trace: 'handN', cue: 'Витягни протилежні руку й ногу в одну лінію, таз не повертається.',
  props: [{ type: 'mat', x1: 40, x2: 200 }], keys: [
  { p: QUAD, d: 0.6, label: 'Упор на долонях і колінах' },
  { p: P({ ...QUAD, an: 94, fn: 94, lf: -88, sf: -88, pf: -100 }), d: 1.4, label: 'Рука й протилежна нога' },
  { p: P({ ...QUAD, an: 94, fn: 94, lf: -88, sf: -88, pf: -100 }), d: 2, label: 'Утримай 2 с' },
], back: 1.2 });
S('cat', { view: 'side', anchor: quadAnchor, cue: 'Округли спину, потім м’яко прогнись — разом із диханням.',
  props: [{ type: 'mat', x1: 40, x2: 200 }], keys: [
  { p: QUAD, d: 0.6, label: 'Нейтральна спина' },
  { p: P({ ...QUAD, curve: 9, n: 30 }), d: 2, label: 'Кішка: видих, спина вгору' },
  { p: P({ ...QUAD, curve: 9, n: 30 }), d: 0.5, label: 'Пауза' },
  { p: P({ ...QUAD, curve: -7, n: 130 }), d: 2.5, label: 'Корова: вдих, м’який прогин' },
  { p: P({ ...QUAD, curve: -7, n: 130 }), d: 0.5, label: 'Пауза' },
], back: 1.2, backLabel: 'Нейтраль' });
S('thoracic', { view: 'side', anchor: quadAnchor, cue: 'Рука біля скроні. Розверни груди, ведучи лікоть угору.',
  props: [{ type: 'mat', x1: 40, x2: 200 }], keys: [
  { p: P({ ...QUAD, an: 30, fn: 150 }), d: 0.6, label: 'Лікоть униз' },
  { p: P({ ...QUAD, an: 172, fn: 20, shx: -3 }), d: 2, label: 'Лікоть угору, погляд за ним' },
  { p: P({ ...QUAD, an: 172, fn: 20, shx: -3 }), d: 0.6, label: 'Пауза' },
], back: 1.6, backLabel: 'Повільно вниз' });
S('bear_crawl', { view: 'side', anchor: { j: 'pelvis', at: [96, F - 44] }, closed: true, cue: 'Коліна низько над підлогою. Крок протилежними рукою й ногою.',
  ik: { armN: { at: [146, F - 2], bend: 'back' }, armF: { at: [146, F - 2], bend: 'back' }, legN: { at: [70, F - 10] }, legF: { at: [70, F - 10] } },
  props: [{ type: 'mat', x1: 40, x2: 200 }], keys: [
  { p: P({ ...QUAD, t: 94, n: 108, pn: 20, pf: 20 }), d: 0.4, label: 'Упор, коліна над підлогою' },
  { p: P({ ...QUAD, t: 94, n: 108, pn: 20, pf: 20 }), d: 0.5, label: 'Права рука + ліва нога', ik: { armN: { at: [160, F - 4], bend: 'back' }, legF: { at: [84, F - 10] } } },
  { p: P({ ...QUAD, t: 94, n: 108, pn: 20, pf: 20 }), d: 0.5, label: 'Упор' },
  { p: P({ ...QUAD, t: 94, n: 108, pn: 20, pf: 20 }), d: 0.5, label: 'Ліва рука + права нога', ik: { armF: { at: [160, F - 4], bend: 'back' }, legN: { at: [84, F - 10] } } },
  { p: P({ ...QUAD, t: 94, n: 108, pn: 20, pf: 20 }), d: 0.5, label: 'Упор' },
] });
S('y_raise', { view: 'side', anchor: { j: 'pelvis', at: [84, F - 9] }, trace: 'handN', ghost: 1, cue: 'Лежачи на животі, руки буквою «Y». Лопатки вниз, руки на 3–5 см угору.',
  props: [{ type: 'mat', x1: 20, x2: 230 }], keys: [
  { p: PRONE, d: 0.6, label: 'Лоб на рушнику, руки «Y»' },
  { p: P({ ...PRONE, an: 104, fn: 104, af: 104, ff: 104 }), d: 1, label: 'Лопатки вниз, руки вгору' },
  { p: P({ ...PRONE, an: 104, fn: 104, af: 104, ff: 104 }), d: 2, label: 'Утримай 2 с' },
], back: 1.5, backLabel: 'Повільно вниз' });

// ---- locomotion, plyo, cardio
const stride = (k) => P({ t: 168, n: 170, ln: 50 * k, sn: k > 0 ? -10 : -70, lf: -30 * k, sf: k > 0 ? -70 : -10, pn: 80, pf: 80, an: -40 * k, fn: 40 - 30 * k, af: 40 * k, ff: 40 + 30 * k });
S('shuttle', { view: 'side', anchor: { j: 'pelvis', at: [40, 0], ground: true }, mirror: 'x', cue: 'Розгін, коротке гальмування, торкнись лінії рукою й розвернись.',
  props: [{ type: 'cone', x: 24 }, { type: 'cone', x: 216 }], keys: [
  { p: P({ t: 160, n: 168, ln: 40, sn: -20, lf: 20, sf: -30, an: -20, fn: 60, af: 30, ff: 100 }), d: 0.4, at: [40, 0], label: 'Низька стійка' },
  { p: stride(1), d: 0.3, at: [80, 0], label: 'Розгін' },
  { p: stride(-1), d: 0.3, at: [118, 0], label: 'Розгін' },
  { p: stride(1), d: 0.3, at: [156, 0], label: 'Біг ≈80 %' },
  { p: P({ t: 186, n: 180, ln: 60, sn: 40, lf: -20, sf: -40, an: 30, fn: 80, af: -30, ff: 20 }), d: 0.35, at: [184, 0], label: 'Гальмування короткими кроками' },
  { p: P({ t: 120, n: 130, ln: 92, sn: -30, lf: -10, sf: -90, pf: 20, an: 30, fn: 20, af: -40, ff: 0 }), d: 0.35, at: [196, 0], label: 'Торкнись лінії рукою' },
  { p: P({ t: 120, n: 130, ln: 92, sn: -30, lf: -10, sf: -90, pf: 20, an: 30, fn: 20, af: -40, ff: 0 }), d: 0.15, at: [196, 0], label: 'Розворот' },
], closed: true });
S('rope', { view: 'front', anchor: { j: 'pelvis', at: [120, 0], ground: true }, closed: true, cue: 'Лікті біля тулуба, кисті обертають скакалку. Низькі м’які підскоки.',
  props: [{ type: 'rope', period: 0.5, layer: 'front' }], keys: [
  { p: P({ an: 14, fn: 55, af: -14, ff: -55, ln: 3, sn: 0, lf: -3, sf: 0 }), d: 0.25, label: 'Підскок на передній частині стопи' },
  { p: P({ an: 14, fn: 55, af: -14, ff: -55, ln: 3, sn: 0, lf: -3, sf: 0 }), d: 0.25, lift: 7, label: 'Скакалка під стопами' },
] });
S('lateral_hop', { view: 'front', anchor: { j: 'pelvis', at: [160, F - 84] }, mirror: 'x', trace: 'pelvis', cue: 'Відштовхнись убік, м’яко приземлись на іншу ногу й утримай 2 с.', closed: true, keys: [
  { p: P({ t: 186, an: 30, fn: 20, af: -50, ff: -30, ln: 4, sn: 2, lf: -10, sf: 50 }), at: [160, F - 84], d: 0.5, label: 'Стійка на одній нозі' },
  { p: P({ t: 186, an: 40, fn: 30, af: -40, ff: -20, ln: 30, sn: -10, lf: -10, sf: 50 }), at: [156, F - 72], d: 0.4, label: 'Присядь і відштовхнись' },
  { p: P({ t: 170, an: -30, fn: -20, af: -60, ff: -40, ln: 30, sn: -20, lf: -30, sf: 10 }), at: [118, F - 96], d: 0.35, label: 'Політ убік' },
  { p: P({ t: 172, an: -50, fn: -30, af: 40, ff: 20, ln: 10, sn: -50, lf: -22, sf: 8 }), at: [82, F - 74], d: 0.3, label: 'М’яке приземлення' },
  { p: P({ t: 174, an: -50, fn: -30, af: 40, ff: 20, ln: 10, sn: -50, lf: -22, sf: 8 }), at: [82, F - 74], d: 2, label: 'Утримай рівновагу 2 с' },
] });
const kneeUp = (k) => P({ ln: k > 0 ? 92 : 0, sn: k > 0 ? 0 : -2, lf: k < 0 ? 92 : -2, sf: k < 0 ? 0 : -2, pn: k > 0 ? 70 : 90, pf: k < 0 ? 70 : 90, an: k > 0 ? -35 : 40, fn: k > 0 ? -5 : 110, af: k > 0 ? 40 : -35, ff: k > 0 ? 110 : -5 });
S('native_walking_high_knees', { view: 'side', anchor: { j: 'pelvis', at: [116, 0], ground: true }, closed: true, cue: 'Почергово піднімай коліна до рівня таза, руки працюють.', keys: [
  { p: P(), d: 0.3, label: 'Стійка' },
  { p: kneeUp(1), d: 0.4, label: 'Коліно до рівня таза' },
  { p: P(), d: 0.3, label: 'Крок' },
  { p: kneeUp(-1), d: 0.4, label: 'Інше коліно' },
  { p: P(), d: 0.3, label: 'Крок' },
] });
S('native_walking_knee_hugs', { view: 'side', anchor: { j: 'pelvis', at: [116, 0], ground: true }, mirror: 'limbs', cue: 'Підтягни коліно руками до грудей на 1 с, зміни ногу.',
  ik: {}, keys: [
  { p: P(), d: 0.4, label: 'Стійка' },
  { p: P({ ln: 140, sn: 14, pn: 70 }), d: 0.6, label: 'Коліно до грудей', ik: { armN: { to: 'kneeN', off: [6, 12], bend: 'back' }, armF: { to: 'kneeN', off: [4, 14], bend: 'back' } } },
  { p: P({ ln: 140, sn: 14, pn: 70 }), d: 1, label: 'Утримай 1 с', ik: { armN: { to: 'kneeN', off: [6, 12], bend: 'back' }, armF: { to: 'kneeN', off: [4, 14], bend: 'back' } } },
], back: 0.6, backLabel: 'Зміна ноги' });
S('native_ankle_circles', { view: 'side', anchor: { j: 'pelvis', at: [82, 120] }, trace: 'toeN', closed: true, cue: 'Повільні кола стопою в обидва боки.',
  props: [{ type: 'bench', x1: 56, x2: 104, y: 126 }], keys: [
  { p: P({ ...SEATED, ln: 88, sn: 60, pn: 70 }), d: 0.5, label: 'Нога вперед' },
  { p: P({ ...SEATED, ln: 88, sn: 60, pn: 130 }), d: 0.7, label: 'Носок до себе' },
  { p: P({ ...SEATED, ln: 88, sn: 60, pn: 170 }), d: 0.7, label: 'Коло' },
  { p: P({ ...SEATED, ln: 88, sn: 60, pn: 110 }), d: 0.7, label: 'Коло' },
  { p: P({ ...SEATED, ln: 88, sn: 60, pn: 70 }), d: 0.7, label: 'Носок від себе' },
] });
S('shoulder_circles', { view: 'side', anchor: ON(116), closed: true, cue: 'Плечі вгору, назад і вниз. Руки вільні.', keys: [
  { p: P({ ...HANG }), d: 0.5, label: 'Руки вільно' },
  { p: P({ ...HANG, sh: 5 }), d: 0.8, label: 'Плечі вгору' },
  { p: P({ ...HANG, sh: 3, shx: -5 }), d: 0.8, label: 'Назад' },
  { p: P({ ...HANG, sh: -2, shx: -1 }), d: 0.8, label: 'Униз' },
  { p: P({ ...HANG, sh: 0, shx: 2 }), d: 0.8, label: 'Уперед' },
] });
S('elliptical', { view: 'side', anchor: { j: 'pelvis', at: [110, 62] }, zoom: [0.8, 120, F], thumbT: 0.55, cue: 'Стопи повністю на педалях, корпус рівно, руки легко штовхають і тягнуть ручки.',
  props: [{ type: 'elliptical' }],
  dyn(time) {
    const ph = (time / 1.6) * 2 * Math.PI;
    const ped = (o) => [110 + 26 * Math.cos(ph + o), F - 34 + 8 * Math.sin(ph + o)];
    const grip = (o) => [150 + 12 * Math.cos(ph + o + Math.PI), 50 + 2 * Math.sin(ph + o)];
    return { p: P({ t: 178, n: 182, pn: 92, pf: 92 }), anchor: this.anchor, label: 'Плавне коло ногами · руки працюють', remaining: 0,
      ik: { legN: { at: ped(0) }, legF: { at: ped(Math.PI) }, armN: { at: grip(0), bend: 'back' }, armF: { at: grip(Math.PI), bend: 'back' } } };
  } });

// ---- stretches and yoga
S('hipflex', { view: 'side', anchor: { j: 'kneeF', at: [82, F - 5] }, ik: { legN: { at: [140, F - 4] } }, trace: 'pelvis', ghost: 1, cue: 'Коліно на м’якій опорі. Підкрути таз і перемісти його трохи вперед.',
  props: [{ type: 'mat', x1: 40, x2: 190 }], keys: [
  { p: P({ t: 180, lf: -10, sf: -92, pf: -94, an: 30, fn: 90, af: 20, ff: 80, pn: 90 }), d: 0.8, label: 'Коліно на опорі' },
  { p: P({ t: 184, lf: -34, sf: -92, pf: -94, an: 40, fn: 100, af: 30, ff: 90, pn: 90 }), d: 2, label: 'Таз уперед і підкручений' },
  { p: P({ t: 184, lf: -34, sf: -92, pf: -94, an: 40, fn: 100, af: 30, ff: 90, pn: 90 }), ...HOLD('Тримай натяг 5–6/10', 3) },
], back: 1.5 });
S('lat', { view: 'side', anchor: ON(82), ik: { armN: { at: [152, F - 44], bend: 'back' }, armF: { at: [152, F - 44], bend: 'back' } }, cue: 'Долоні на лаві. Таз назад, груди опускаються між руками.',
  props: [{ type: 'bench', x1: 140, x2: 210, y: F - 40 }], keys: [
  { p: P({ t: 112, n: 118, ln: 12, sn: -4, lf: 12, sf: -4 }), d: 0.8, label: 'Долоні на лаві' },
  { p: P({ t: 96, n: 92, ln: 24, sn: -6, lf: 24, sf: -6 }), d: 2, label: 'Таз назад, груди вниз' },
  { p: P({ t: 96, n: 92, ln: 24, sn: -6, lf: 24, sf: -6 }), ...HOLD() },
], back: 1.5 });
S('calf_stretch', { view: 'side', anchor: { j: 'ankleF', at: [70, F - 4] }, ik: { legN: { at: [128, F - 4] }, armN: { at: [176, 70], bend: 'back' }, armF: { at: [176, 74], bend: 'back' } }, cue: 'Долоні на стіні, задня нога пряма. Змісти вагу до стіни, п’ята на підлозі.',
  props: [{ type: 'wall', x: 178 }], keys: [
  { p: P({ t: 168, lf: -24, sf: -24 }), d: 0.8, label: 'Долоні на стіні' },
  { p: P({ t: 156, lf: -38, sf: -38 }), d: 2, label: 'Вага до стіни' },
  { p: P({ t: 156, lf: -38, sf: -38 }), ...HOLD('Тримай · задня п’ята на підлозі') },
], back: 1.5 });
S('chest', { view: 'side', anchor: ON(116), ik: { armN: { at: [96, 52], bend: [0, 1] } }, cue: 'Передпліччя на одвірку. Злегка розверни груди вперед від опори.',
  props: [{ type: 'wall', x: 92, w: 7 }], keys: [
  { p: P({ t: 180 }), d: 0.8, label: 'Передпліччя на одвірку' },
  { p: P({ t: 170, n: 172, ln: 10, sn: -8 }), d: 2, label: 'Груди вперед' },
  { p: P({ t: 170, n: 172, ln: 10, sn: -8 }), ...HOLD() },
], back: 1.5 });
S('hamstring', { view: 'side', anchor: { j: 'pelvis', at: [120, F - 10] }, ik: { armN: { to: 'kneeN', off: [-3, 8], bend: 'back' }, armF: { to: 'kneeN', off: [-5, 10], bend: 'back' } }, trace: 'toeN', ghost: 1,
  cue: 'Лежачи, руки під стегном. Поступово випрямляй коліно до легкого натягу.', props: [{ type: 'mat', x1: 30, x2: 210 }], keys: [
  { p: P({ ...SUPINE, ln: 176, sn: 96, pn: 180 }), d: 0.8, label: 'Стегно вертикально' },
  { p: P({ ...SUPINE, ln: 172, sn: 168, pn: 250 }), d: 2.5, label: 'Випрямляй коліно' },
  { p: P({ ...SUPINE, ln: 172, sn: 168, pn: 250 }), ...HOLD('Тримай натяг 5–6/10') },
], back: 1.5 });
S('glute_stretch', { view: 'side', anchor: { j: 'pelvis', at: [120, F - 10] }, ik: { legN: { to: 'kneeF', off: [4, -6], bend: [0, 1] }, armN: { to: 'kneeF', off: [-2, 10], bend: 'back' }, armF: { to: 'kneeF', off: [-4, 12], bend: 'back' } },
  cue: 'Щиколотку на протилежне стегно, підтягни опорну ногу до грудей.', props: [{ type: 'mat', x1: 30, x2: 210 }], keys: [
  { p: P({ ...SUPINE, lf: 150, sf: 60, pf: 150, pn: 120 }), d: 0.8, label: '«Четвірка»' },
  { p: P({ ...SUPINE, lf: 170, sf: 80, pf: 160, pn: 120 }), d: 2, label: 'Опорну ногу до грудей' },
  { p: P({ ...SUPINE, lf: 170, sf: 80, pf: 160, pn: 120 }), ...HOLD() },
], back: 1.5 });
S('butterfly', { view: 'front', anchor: { j: 'pelvis', at: [120, F - 18] }, ik: { armN: { to: 'ankleN', off: [3, -4], bend: [1, 0] }, armF: { to: 'ankleF', off: [-3, -4], bend: [-1, 0] } }, cue: 'Сидячи, підошви разом. Коліна м’яко опускаються в сторони.',
  props: [{ type: 'mat', x1: 40, x2: 200 }], keys: [
  { p: P({ ln: 72, sn: -78, lf: -72, sf: 78, pn: 0, pf: 0 }), d: 0.8, label: 'Підошви разом' },
  { p: P({ ln: 84, sn: -86, lf: -84, sf: 86, pn: 0, pf: 0 }), d: 2, label: 'Коліна вниз' },
  { p: P({ ln: 84, sn: -86, lf: -84, sf: 86, pn: 0, pf: 0 }), ...HOLD() },
], back: 1.5 });
const childQuad = P({ ...QUAD, pn: -92, pf: -92 });
S('native_childs_pose', { view: 'side', anchor: { j: 'kneeN', at: [104, F - 5] }, trace: 'pelvis', ghost: 1, cue: 'З колін відведи таз до п’ят, руки тягнуться вперед по підлозі.',
  props: [{ type: 'mat', x1: 30, x2: 210 }], keys: [
  { p: childQuad, d: 0.8, label: 'Упор на колінах' },
  { p: P({ ...childQuad, t: 80, n: 70, ln: 60, lf: 60, an: 98, fn: 92, af: 98, ff: 92 }), d: 2.2, label: 'Таз до п’ят' },
  { p: P({ ...childQuad, t: 80, n: 70, ln: 60, lf: 60, an: 98, fn: 92, af: 98, ff: 92 }), ...HOLD('Повільне дихання', 3) },
], back: 1.5 });
const treeArms = { an: 22, fn: -60, af: -22, ff: 60 };
S('native_tree_pose', { view: 'front', anchor: { j: 'ankleF', at: [112, F - 4] }, zoom: [0.86, 120, F], cue: 'Стопа другої ноги на гомілці або стегні (не на коліні). Погляд у точку.', keys: [
  { p: P({ ...treeArms, lf: 0, sf: 0, ln: 2, sn: 2 }), d: 0.8, label: 'Стійка' },
  { p: P({ ...treeArms, lf: 0, sf: 0, ln: 58, sn: -44, pn: -20 }), d: 1.2, label: 'Стопа на гомілку' },
  { p: P({ an: 168, fn: -168, af: -168, ff: 168, lf: 0, sf: 0, ln: 58, sn: -44, pn: -20 }), d: 1.2, label: 'Руки вгору' },
  { p: P({ an: 168, fn: -168, af: -168, ff: 168, lf: 0, sf: 0, ln: 58, sn: -44, pn: -20 }), ...HOLD('Тримай · погляд у точку', 3) },
], back: 1.5 });
S('warrior3', { view: 'side', anchor: ON(116), trace: 'toeF', ghost: 1, cue: 'На одній нозі нахили корпус і витягни вільну ногу назад — тіло як літера «Т».', keys: [
  { p: P({ an: 2, fn: 4 }), d: 0.8, label: 'Стійка' },
  { p: P({ t: 94, n: 98, ln: 6, sn: -3, lf: -84, sf: -86, pf: 0, an: 94, fn: 92, af: 94, ff: 92 }), d: 2, label: 'Нахил — «Т»' },
  { p: P({ t: 94, n: 98, ln: 6, sn: -3, lf: -84, sf: -86, pf: 0, an: 94, fn: 92, af: 94, ff: 92 }), ...HOLD('Тримай таз рівно') },
], back: 1.6 });
S('side_stretch', { view: 'front', anchor: { j: 'ankleN', at: [130, F - 4] }, zoom: [0.88, 120, F], mirror: 'x', cue: 'Руки вгору. Тягнись угору й нахиляйся вбік, не провалюючись уперед.', keys: [
  { p: P({ an: 176, fn: 180, af: -176, ff: 180, ln: 4, sn: 4, lf: -4, sf: -4, pn: 90, pf: -90 }), d: 0.8, label: 'Руки вгору' },
  { p: P({ t: 160, n: 156, an: 146, fn: 132, af: 170, ff: 148, ln: 4, sn: 4, lf: -4, sf: -4, pn: 90, pf: -90 }), d: 2, label: 'Нахил убік' },
  { p: P({ t: 160, n: 156, an: 146, fn: 132, af: 170, ff: 148, ln: 4, sn: 4, lf: -4, sf: -4, pn: 90, pf: -90 }), ...HOLD() },
], back: 1.5 });
const supKnees = P({ ...SUPINE, an: 180 - 90, fn: 90, af: 90, ff: 90, ln: 140, sn: 30, lf: 140, sf: 30, pn: 90, pf: 90 });
const twistBase = { ...supKnees, an: 180, fn: 180, af: 180, ff: 180, aroll: 86 };
S('spinal_twist', { view: 'side', cam: { yaw: 24, pitch: 40 }, anchor: { j: 'pelvis', at: [116, F - 10] }, zoom: [1.08, 120, F - 30], ik: { legN: { at: [158, F - 4] }, legF: { at: [154, F - 5] } }, thumb: 2,
  cue: 'Лежачи, руки в сторони. Обидва коліна повільно нахиляються вбік, плечі лишаються на підлозі. По черзі в обидва боки.',
  props: [{ type: 'mat', x1: 30, x2: 210 }], keys: [
  { p: P(twistBase), d: 0.8, label: 'Коліна зігнуті, руки в сторони' },
  { p: P({ ...twistBase, roll: 68 }), d: 2.2, label: 'Коліна вбік' },
  { p: P({ ...twistBase, roll: 68 }), ...HOLD('Плечі на підлозі · дихай', 3) },
  { p: P(twistBase), d: 1.6, label: 'Через центр' },
  { p: P({ ...twistBase, roll: -68 }), d: 2.2, label: 'В інший бік' },
  { p: P({ ...twistBase, roll: -68 }), ...HOLD('Плечі на підлозі · дихай', 3) },
], back: 1.6, backLabel: 'Через центр' });
S('wallslide', { view: 'front', anchor: { j: 'ankleN', at: [134, F - 4] }, zoom: [0.88, 120, F], trace: 'handN', ghost: 1, cue: 'Спиною до стіни, передпліччя на стіні. Ковзай руками вгору й униз по 3 с.',
  props: [{ type: 'backwall', x1: 52, x2: 188 }], keys: [
  { p: P({ an: 96, fn: 180, af: -96, ff: 180, ln: 3, sn: 3, lf: -3, sf: -3, pn: 90, pf: -90 }), d: 0.6, label: 'Лікті 90°, «W»' },
  { p: P({ an: 150, fn: 166, af: -150, ff: -166, ln: 3, sn: 3, lf: -3, sf: -3, pn: 90, pf: -90 }), d: 3, label: 'Угору · 3 с' },
  { p: P({ an: 150, fn: 166, af: -150, ff: -166, ln: 3, sn: 3, lf: -3, sf: -3, pn: 90, pf: -90 }), d: 0.3, label: '«Y»' },
], back: 3, backLabel: 'Униз · 3 с' });

// ------------------------------------------------------------------ player --
function svg(key) {
  const sc = scenes[key];
  if (!sc) return '';
  const first = render3d(key, 0);
  return `<figure class="anim" data-scene="${esc(key)}"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(sc.cue)}"><g class="stage">${first.svg}</g></svg>
<div class="anim-bar"><button type="button" class="anim-play" aria-label="Пауза">❚❚</button><div class="anim-phase"><b>${esc(first.label)}</b> <span class="anim-left"></span></div><button type="button" class="anim-speed" aria-label="Швидкість">1×</button></div>
<input class="anim-scrub" type="range" min="0" max="1000" value="0" aria-label="Перемотати рух"><figcaption class="anim-cue">${esc(sc.cue)}</figcaption></figure>`;
}
/** A still frame for lists: the pose at the end of key `thumb` (default: the second key), or `thumbT` for live scenes. */
function thumbTime(sc) {
  if (sc.dyn) return sc.thumbT ?? 0.4;
  const tl = sc._tl || (sc._tl = timeline(sc));
  const idx = Math.min(sc.thumb ?? 1, tl.keys.length - 1);
  let t = 0;
  for (let i = 0; i <= idx; i += 1) t += tl.keys[i].d;
  return Math.max(0, t - 0.001);
}
function thumb(key) {
  const sc = scenes[key];
  if (!sc) return '';
  const r = render3d(key, thumbTime(sc));
  return `<svg class="thumb" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(sc.cue)}">${r.svg}</svg>`;
}
/** Crop still frames to the figure and its equipment (keeps the 240:176 shape; at most 1.7× closer). */
function fitThumbs(scope = document) {
  for (const svg of scope.querySelectorAll('svg.thumb:not([data-fit])')) {
    const fig = svg.querySelector('.fig');
    if (!fig || typeof fig.getBBox !== 'function') continue;
    let b, m;
    try { b = fig.getBBox(); m = svg.getScreenCTM()?.inverse().multiply(fig.getScreenCTM()); } catch { continue; }
    if (!b || !b.width || !m) continue;
    const pts = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]
      .map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
    const x1 = Math.min(...pts.map((p) => p.x)), x2 = Math.max(...pts.map((p) => p.x));
    const y1 = Math.min(...pts.map((p) => p.y)), y2 = Math.max(...pts.map((p) => p.y));
    const pad = 7, ar = W / H;
    let w = x2 - x1 + pad * 2, h = y2 - y1 + pad * 2;
    if (w / h > ar) h = w / ar; else w = h * ar;
    if (w > W) { w = W; h = H; }
    if (w < W / 1.7) { w = W / 1.7; h = H / 1.7; }
    const x0 = Math.max(0, Math.min(W - w, (x1 + x2) / 2 - w / 2));
    const y0 = Math.max(0, Math.min(H - h, y2 + pad - h + 4));
    svg.setAttribute('viewBox', `${x0.toFixed(1)} ${y0.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`);
    svg.dataset.fit = '1';
  }
}
function totalOf(sc) { return sc.dyn ? 1.6 : (sc._tl || (sc._tl = timeline(sc))).total; }
function mount(scope = document) {
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (const fig of scope.querySelectorAll('figure.anim:not([data-ready])')) {
    fig.dataset.ready = '1';
    const key = fig.dataset.scene, sc = scenes[key];
    if (!sc) continue;
    const stage = fig.querySelector('.stage'), phase = fig.querySelector('.anim-phase b'), left = fig.querySelector('.anim-left');
    const play = fig.querySelector('.anim-play'), speedBtn = fig.querySelector('.anim-speed'), scrub = fig.querySelector('.anim-scrub');
    const total = totalOf(sc);
    const st = { t: 0, playing: !reduce, speed: 1, last: null, visible: true, raf: 0 };
    const draw = () => {
      const r = render3d(key, st.t);
      stage.innerHTML = r.svg;
      phase.textContent = r.label + (sc.mirror === 'limbs' && r.side ? ' · інший бік' : '');
      left.textContent = r.remaining >= 1 ? `${Math.ceil(r.remaining)} с` : '';
      scrub.value = String(Math.round(((st.t % total) / total) * 1000));
    };
    const tick = (now) => {
      st.raf = 0;
      if (!st.playing || !st.visible || !fig.isConnected) { st.last = null; return; }
      if (st.last != null) st.t = (st.t + ((now - st.last) / 1000) * st.speed) % total;
      st.last = now;
      draw();
      st.raf = requestAnimationFrame(tick);
    };
    const run = () => { if (!st.raf && st.playing && st.visible) st.raf = requestAnimationFrame(tick); };
    const setPlay = (v) => { st.playing = v; play.textContent = v ? '❚❚' : '▶'; play.setAttribute('aria-label', v ? 'Пауза' : 'Відтворити'); run(); };
    play.addEventListener('click', () => setPlay(!st.playing));
    speedBtn.addEventListener('click', () => { st.speed = st.speed === 1 ? 0.5 : st.speed === 0.5 ? 0.25 : 1; speedBtn.textContent = `${st.speed}×`.replace('0.', '0,'); });
    scrub.addEventListener('input', () => { setPlay(false); st.t = (Number(scrub.value) / 1000) * total; draw(); });
    if ('IntersectionObserver' in root) new IntersectionObserver((es) => { st.visible = es.some((e) => e.isIntersecting); run(); }).observe(fig);
    setPlay(st.playing);
    draw();
  }
}
root.MyGarminDiagrams = Object.freeze({
  svg, mount, render, render3d, thumb, fitThumbs, keys: Object.keys(scenes),
  thumbTime: (key) => (scenes[key] ? thumbTime(scenes[key]) : 0),
  joints: (key, time) => pose(scenes[key], time).J,
  has: (key) => Object.prototype.hasOwnProperty.call(scenes, key),
  duration: (key) => (scenes[key] ? totalOf(scenes[key]) : 0),
});
})(typeof window !== 'undefined' ? window : globalThis);
