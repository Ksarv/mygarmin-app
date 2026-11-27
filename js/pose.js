// Technique analysis from pose landmarks (MediaPipe BlazePose, 33 points per
// frame, image coordinates 0–1). The model only finds the joints; everything
// here — angles, repetitions, tempo and the verdicts — is plain rules with
// the thresholds in THRESH, so every remark can be traced and tuned.
// No DOM: node tests feed it landmarks built from the app's own animations.

export const LM = {
  nose: 0, earL: 7, earR: 8, shL: 11, shR: 12, elL: 13, elR: 14, wrL: 15, wrR: 16,
  hipL: 23, hipR: 24, knL: 25, knR: 26, anL: 27, anR: 28, heL: 29, heR: 30, ftL: 31, ftR: 32,
};
/** The points the analysis uses (kept in exports and the journal). */
export const KEEP = [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];

/** Rule thresholds (degrees unless noted). Shown in the app, tuned from real videos. */
export const THRESH = {
  minVisibility: 0.5,
  squat: { depthGood: 95, depthOk: 115, trunkGood: 45, trunkMax: 60, heelLift: 0.04, slowDown: 1.0 },
  hinge: { kneeMin: 135, kneeLocked: 176, hipGood: 110, hipShallow: 130, slowDown: 1.5 },
  lunge: { kneeGood: 100, kneeOk: 115, trunkGood: 20, trunkMax: 35 },
  pushup: { elbowGood: 90, elbowOk: 110, lockout: 155, lineGood: 165, lineMin: 155 },
  pull: { hang: 150, slowNegative: 3, minNegative: 2 },
  dip: { elbowGood: 95, elbowOk: 115, lockout: 155, slowNegative: 3, minNegative: 2 },
  hold: { lineGood: 165, lineMin: 155 },
  sideView: 0.4,
};

const PATTERN_FAMILY = { squat: 'squat', hinge: 'hinge', lunge: 'lunge', push_dip: 'dip', pull_v: 'pull' };
/** Which analysis fits an exercise of the library. */
export function familyOf(exId, lib) {
  const ex = lib.exercises[exId];
  if (!ex) return 'generic';
  if (['pushup', 'incline', 'pushup_decline'].includes(ex.scene)) return 'pushup';
  if (ex.pattern === 'hinge') return ['deadlift', 'sl_rdl'].includes(ex.scene) ? 'hinge' : 'generic';
  if (ex.pattern === 'lunge') return ex.scene === 'step_up' ? 'generic' : 'lunge';
  if (ex.unit === 'seconds' && ['core_lat', 'core_anti_ext'].includes(ex.pattern)) return 'hold';
  return PATTERN_FAMILY[ex.pattern] ?? 'generic';
}
export const FAMILY_NAME = {
  squat: 'присідання', hinge: 'нахил (тяга)', lunge: 'випад', pushup: 'віджимання', pull: 'підтягування', dip: 'бруси', hold: 'утримання', generic: 'загальний розбір',
};
/** Signal that drives the repetitions, and whether the working phase lowers it. */
const PRIMARY = {
  squat: { key: 'knee', label: 'Кут у коліні' }, lunge: { key: 'kneeMin', label: 'Кут у передньому коліні' },
  hinge: { key: 'hip', label: 'Кут у кульшовому суглобі' }, pushup: { key: 'elbow', label: 'Кут у лікті' },
  pull: { key: 'elbow', label: 'Кут у лікті', concentricFirst: true }, dip: { key: 'elbow', label: 'Кут у лікті' },
};

// ------------------------------------------------------------- geometry --
const DEG = 180 / Math.PI;
function angle(a, b, c) {
  if (!a || !b || !c) return null;
  const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
  const n = Math.hypot(...v1) * Math.hypot(...v2);
  if (!n) return null;
  return Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / n))) * DEG;
}
/** Angle of the segment bottom→top from straight up (0 = vertical). */
function fromVertical(top, bottom) {
  if (!top || !bottom) return null;
  return Math.atan2(Math.abs(top[0] - bottom[0]), bottom[1] - top[1]) * DEG;
}
const dist = (a, b) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : null);
export function quantile(values, q) {
  const s = values.filter((v) => v != null && Number.isFinite(v)).sort((x, y) => x - y);
  if (!s.length) return null;
  const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
const r0 = (v) => (v == null ? null : Math.round(v));
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const num = (v) => String(r1(v)).replace('.', ',');

/** Moving median then mean over a small window; nulls stay null, short gaps are bridged. */
export function smooth(values, w = 2) {
  const filled = [...values];
  for (let i = 0; i < filled.length; i += 1) {
    if (filled[i] != null) continue;
    let a = i - 1, b = i + 1;
    while (b < filled.length && filled[b] == null) b += 1;
    if (a >= 0 && b < filled.length && b - a <= 4 && filled[a] != null) {
      for (let k = i; k < b; k += 1) filled[k] = filled[a] + ((filled[b] - filled[a]) * (k - a)) / (b - a);
      i = b - 1;
    }
  }
  const med = filled.map((v, i) => {
    if (v == null) return null;
    const win = filled.slice(Math.max(0, i - w), i + w + 1).filter((x) => x != null).sort((x, y) => x - y);
    return win[win.length >> 1];
  });
  return med.map((v, i) => {
    if (v == null) return null;
    const win = med.slice(Math.max(0, i - 1), i + 2).filter((x) => x != null);
    return win.reduce((x, y) => x + y, 0) / win.length;
  });
}

// --------------------------------------------------------------- signals --
/**
 * frames: [{ t: seconds, lm: [[x, y, z, visibility] × 33] | null }]
 * aspect: video width / height (angles need square pixels).
 */
export function signals(frames, { aspect = 1 } = {}) {
  const P = (f, i) => {
    const p = f.lm?.[i];
    return p && (p[3] ?? 1) >= THRESH.minVisibility ? [p[0] * aspect, p[1], p[3] ?? 1] : null;
  };
  // Each limb chain comes from the side the model sees better over the whole
  // video: in a side view the far arm or leg is often guessed wrong (e.g. folded
  // under the body), and the camera side does not change during a set.
  // Visibility alone is not enough: a leg guessed under the chest can still score
  // well, so a leg also has to be shaped like a leg (thigh and shin 0.45–1.5 torso).
  const V = (f, i) => f.lm?.[i]?.[3] ?? 0;
  const raw = (f, i) => (f.lm?.[i] ? [f.lm[i][0] * aspect, f.lm[i][1]] : null);
  const legOk = (f, sd) => {
    const sh = raw(f, LM['sh' + sd]), hp = raw(f, LM['hip' + sd]), kn = raw(f, LM['kn' + sd]), an = raw(f, LM['an' + sd]);
    const torso = dist(sh, hp);
    if (!torso || !kn || !an) return false;
    const th = dist(hp, kn) / torso, sn = dist(kn, an) / torso;
    return th >= 0.45 && th <= 1.5 && sn >= 0.45 && sn <= 1.5;
  };
  const score = (names, sd, check) => frames.reduce((a, f) => a + (f.lm && (!check || check(f, sd)) ? names.reduce((b, n) => b + V(f, LM[n + sd]), 0) : 0), 0);
  const LEG = score(['hip', 'kn', 'an'], 'L', legOk) >= score(['hip', 'kn', 'an'], 'R', legOk) ? 'L' : 'R';
  const ARM = score(['sh', 'el', 'wr'], 'L') >= score(['sh', 'el', 'wr'], 'R') ? 'L' : 'R';
  const chainSide = (f, names) => {
    if (names[0] !== 'hip') return ARM;
    const other = LEG === 'L' ? 'R' : 'L';
    return !legOk(f, LEG) && legOk(f, other) ? other : LEG;
  };
  const out = { side: 'L', armSide: 'L', t: [], knee: [], kneeOther: [], kneeMin: [], hip: [], elbow: [], trunk: [], body: [], bodySag: [], shin: [], hipBelow: [], heel: [], noseOverWrist: [], shoulderSpread: [], detected: 0, vis: [] };
  const votes = { leg: { L: 0, R: 0 }, arm: { L: 0, R: 0 } };
  for (const f of frames) {
    out.t.push(f.t);
    const legS = f.lm ? chainSide(f, ['hip', 'kn', 'an']) : 'L', armS = f.lm ? chainSide(f, ['sh', 'el', 'wr']) : 'L';
    const legO = legS === 'L' ? 'R' : 'L';
    if (f.lm) { votes.leg[legS] += 1; votes.arm[armS] += 1; }
    const sh = f.lm && P(f, LM['sh' + armS]), el = f.lm && P(f, LM['el' + armS]), wr = f.lm && P(f, LM['wr' + armS]);
    const hp = f.lm && P(f, LM['hip' + legS]), kn = f.lm && P(f, LM['kn' + legS]), an = f.lm && P(f, LM['an' + legS]);
    const he = f.lm && P(f, LM['he' + legS]), nose = f.lm && P(f, LM.nose);
    const kn2 = f.lm && P(f, LM['kn' + legO]), hp2 = f.lm && P(f, LM['hip' + legO]), an2 = f.lm && P(f, LM['an' + legO]);
    const id = (name) => LM[name + legS];
    if (f.lm) out.detected += 1;
    out.vis.push(f.lm ? [id('sh'), id('hip'), id('kn'), id('an')].reduce((a, i) => a + (f.lm[i]?.[3] ?? 0), 0) / 4 : 0);
    const knee = angle(hp, kn, an), knee2 = angle(hp2, kn2, an2);
    out.knee.push(knee);
    out.kneeOther.push(knee2);
    out.kneeMin.push(knee != null && knee2 != null ? Math.min(knee, knee2) : knee ?? knee2);
    out.hip.push(angle(sh, hp, kn));
    out.elbow.push(angle(sh, el, wr));
    out.trunk.push(fromVertical(sh, hp));
    out.body.push(angle(sh, hp, an));
    // + hip below the shoulder–ankle line (sag), − above it (pike); in torso lengths
    if (sh && hp && an) {
      const dx = an[0] - sh[0], dy = an[1] - sh[1], len = Math.hypot(dx, dy) || 1;
      const cross = (dx * (hp[1] - sh[1]) - dy * (hp[0] - sh[0])) / len;
      out.bodySag.push((Math.sign(dx) || 1) * cross / (dist(sh, hp) || 1));
    } else out.bodySag.push(null);
    out.shin.push(fromVertical(kn, an));
    const thigh = dist(hp, kn);
    out.hipBelow.push(hp && kn && thigh ? (hp[1] - kn[1]) / thigh : null);
    const leg = thigh && dist(kn, an) ? thigh + dist(kn, an) : null;
    out.heel.push(he && leg ? -he[1] / leg : null); // higher heel → larger value
    out.noseOverWrist.push(nose && wr && dist(sh, hp) ? (wr[1] - nose[1]) / dist(sh, hp) : null);
    const shA = f.lm && P(f, LM.shL), shB = f.lm && P(f, LM.shR);
    out.shoulderSpread.push(shA && shB && dist(sh, hp) ? Math.abs(shA[0] - shB[0]) / dist(sh, hp) : null);
  }
  out.side = votes.leg.L >= votes.leg.R ? 'L' : 'R';
  out.armSide = votes.arm.L >= votes.arm.R ? 'L' : 'R';
  for (const k of ['knee', 'kneeOther', 'kneeMin', 'hip', 'elbow', 'trunk', 'body', 'bodySag', 'shin', 'hipBelow', 'heel', 'noseOverWrist']) out[k] = smooth(out[k]);
  return out;
}

/**
 * Repetitions as top → bottom → top cycles of one signal, with hysteresis at
 * 35 % of its range from each end. Returns frame indices.
 */
export function findReps(s, { minRange = 25 } = {}) {
  const lo5 = quantile(s, 0.05), hi95 = quantile(s, 0.95);
  if (lo5 == null || hi95 - lo5 < minRange) return [];
  const range = hi95 - lo5, hi = hi95 - 0.35 * range, lo = lo5 + 0.35 * range;
  const reps = [];
  let state = null, start = null, minI = null, reached = false;
  s.forEach((v, i) => {
    if (v == null) return;
    if (state === null || state === 'top') {
      if (v >= hi) { state = 'top'; start = i; return; }
      if (state === 'top') { state = 'down'; minI = i; reached = v <= lo; }
      return;
    }
    if (v < s[minI]) minI = i;
    if (v <= lo) reached = true;
    if (v >= hi) {
      if (reached) reps.push({ start, bottom: minI, end: i });
      state = 'top'; start = i; reached = false;
    }
  });
  // Tempo needs the whole movement, not just the middle: widen each rep to where
  // the signal is back within 10 % of its top, without crossing the neighbours.
  const plateau = hi95 - 0.1 * range;
  reps.forEach((r, k) => {
    const lo = k ? reps[k - 1].bottom : 0, hiI = k < reps.length - 1 ? reps[k + 1].bottom : s.length - 1;
    let a = r.bottom;
    while (a > lo && !(s[a] != null && s[a] >= plateau)) a -= 1;
    let b = r.bottom;
    while (b < hiI && !(s[b] != null && s[b] >= plateau)) b += 1;
    if (s[a] != null && s[a] >= plateau) r.start = a;
    if (s[b] != null && s[b] >= plateau) r.end = b;
  });
  return reps;
}

// --------------------------------------------------------------- verdicts --
const check = (key, level, title, text) => ({ key, level, title, text });
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const at = (arr, i) => (i == null ? null : arr[i]);
const minIn = (arr, a, b) => quantile(arr.slice(a, b + 1), 0);
const maxIn = (arr, a, b) => quantile(arr.slice(a, b + 1), 1);

/**
 * Full analysis of one set.
 * @returns {{ family, side, quality, reps, checks, series, hold }}
 */
export function analyze(frames, exId, lib, { aspect = 1 } = {}) {
  const family = familyOf(exId, lib);
  const ex = lib.exercises[exId];
  const S = signals(frames, { aspect });
  const side = ['pushup', 'pull', 'dip'].includes(family) ? S.armSide : S.side;
  const n = frames.length;
  const quality = { frames: n, detected: S.detected, detectedPct: n ? Math.round((S.detected / n) * 100) : 0, side: side === 'L' ? 'ліва' : 'права', warnings: [] };
  const checks = [];
  if (quality.detectedPct < 70) quality.warnings.push(`Тіло знайдено лише в ${quality.detectedPct} % кадрів — зніми так, щоб усе тіло було в кадрі з запасом, при доброму світлі.`);
  const spread = quantile(S.shoulderSpread, 0.5);
  quality.view = spread == null ? 'unknown' : spread <= THRESH.sideView ? 'side' : 'front';
  if (quality.view === 'front' && family !== 'generic') quality.warnings.push('Камера стоїть не строго збоку (видно обидва плечі). Кути глибини й корпусу найточніші, коли телефон перпендикулярно до тебе.');

  if (family === 'hold') {
    const body = S.body.filter((v) => v != null), sag = S.bodySag.filter((v) => v != null);
    const dt = quantile(S.t.slice(1).map((t, i) => t - S.t[i]), 0.5) ?? 0;
    const seconds = S.body.filter((v) => v != null).length * dt;
    const m = mean(body), sg = mean(sag);
    if (m != null) {
      const L = THRESH.hold;
      checks.push(check('line', m >= L.lineGood ? 'good' : m >= L.lineMin ? 'caution' : 'low', 'Пряма лінія тіла',
        m >= L.lineGood ? `Плечі, таз і стопи на одній лінії (у середньому ${r0(m)}°).`
          : `Лінія тіла ${r0(m)}° (ціль ≥ ${L.lineGood}°): ${sg > 0 ? 'таз провисає — підкрути таз і стисни сідниці' : 'таз задертий — опусти його до лінії плечей і стоп'}.`));
    }
    return { family, side, quality, reps: [], checks, series: series(S, 'body', 'Лінія тіла'), hold: { seconds: r1(seconds), line: r0(m) } };
  }

  // Generic: the joint that moves most drives the reps.
  let prim = PRIMARY[family];
  if (!prim) {
    const best = ['knee', 'hip', 'elbow'].map((k) => ({ k, r: (quantile(S[k], 0.95) ?? 0) - (quantile(S[k], 0.05) ?? 0) })).sort((a, b) => b.r - a.r)[0];
    prim = { key: best.k, label: { knee: 'Кут у коліні', hip: 'Кут у кульшовому суглобі', elbow: 'Кут у лікті' }[best.k] };
  }
  const sig = S[prim.key];
  const idx = findReps(sig, { minRange: family === 'hinge' ? 20 : 25 });
  const reps = idx.map((r, k) => {
    const t0 = S.t[r.start], tb = S.t[r.bottom], t1 = S.t[r.end];
    const first = tb - t0, second = t1 - tb;
    return {
      n: k + 1, start: r1(t0), bottom: r1(tb), end: r1(t1), i: r,
      depth: r0(sig[r.bottom]), top: r0(maxIn(sig, r.start, r.end)),
      down: r1(prim.concentricFirst ? second : first), up: r1(prim.concentricFirst ? first : second),
      trunk: r0(at(S.trunk, r.bottom)), hipBelow: r1(at(S.hipBelow, r.bottom)), knee: r0(at(S.knee, r.bottom)),
      kneeMinRep: r0(minIn(S.knee, r.start, r.end)), kneeMaxRep: r0(maxIn(S.knee, r.start, r.end)),
      hip: r0(at(S.hip, r.bottom)), elbow: r0(at(S.elbow, r.bottom)),
      // robust ends: one bad frame from the model must not decide the verdict
      bodyMin: r0(quantile(S.body.slice(r.start, r.end + 1), 0.15)), sagMax: r1(quantile(S.bodySag.slice(r.start, r.end + 1), 0.85)), sagMin: r1(quantile(S.bodySag.slice(r.start, r.end + 1), 0.15)),
      noseOver: r1(maxIn(S.noseOverWrist, r.start, r.end)),
      heelLift: (() => { const base = quantile(S.heel.slice(Math.max(0, r.start - 3), r.start + 1), 0.5); const top = maxIn(S.heel, r.start, r.end); return base != null && top != null ? r1((top - base) * 100) / 100 : null; })(),
      notes: [],
    };
  });
  if (!reps.length) {
    checks.push(check('reps', 'caution', 'Повторення не знайдено',
      `Рух «${prim.label.toLowerCase()}» змінюється менше ніж на 25°. Перевір, що в кадрі весь підхід і тіло видно збоку.`));
    return { family, side, quality, reps, checks, series: series(S, prim.key, prim.label) };
  }
  const depths = reps.map((r) => r.depth);
  const downs = reps.map((r) => r.down), ups = reps.map((r) => r.up);
  checks.push(check('reps', 'info', 'Повторення', `${reps.length}: униз у середньому ${num(mean(downs))} с, угору ${num(mean(ups))} с.`));
  FAMILY_RULES[family]?.(reps, checks, { ex, S });
  if (reps.length >= 3 && Math.max(...depths) - Math.min(...depths) > 20) {
    checks.push(check('consistency', 'info', 'Рівномірність', `Амплітуда від повторення до повторення змінюється на ${Math.max(...depths) - Math.min(...depths)}° — найглибше ${reps[depths.indexOf(Math.min(...depths))].n}-е, найменше ${reps[depths.indexOf(Math.max(...depths))].n}-е.`));
  }
  const s = series(S, prim.key, prim.label);
  s.bottoms = reps.map((r) => ({ t: r.bottom, v: r.depth, n: r.n }));
  return { family, side, quality, reps, checks, series: s };
}

function series(S, key, label) {
  const step = Math.max(1, Math.ceil(S.t.length / 240));
  const t = [], v = [];
  for (let i = 0; i < S.t.length; i += step) { t.push(r1(S.t[i])); v.push(r0(S[key][i])); }
  return { key, label, t, v, bottoms: [] };
}

const share = (reps, ok) => reps.filter(ok).length;
const FAMILY_RULES = {
  squat(reps, checks, { ex }) {
    const T = THRESH.squat;
    const deep = share(reps, (r) => r.depth <= T.depthGood || r.hipBelow >= -0.05);
    const ok = share(reps, (r) => r.depth <= T.depthOk);
    checks.push(check('depth', deep === reps.length ? 'good' : ok === reps.length ? 'caution' : 'low', 'Глибина',
      deep === reps.length ? `Усі ${reps.length} до паралелі або нижче (кут у коліні ${Math.min(...reps.map((r) => r.depth))}–${Math.max(...reps.map((r) => r.depth))}°).`
        : `До паралелі ${deep} з ${reps.length}; найменший присід — ${Math.max(...reps.map((r) => r.depth))}° у коліні (ціль ≤ ${T.depthGood}°). Опускай таз, доки стегна не стануть паралельно підлозі, п’яти на підлозі.`));
    const lean = Math.max(...reps.map((r) => r.trunk ?? 0));
    const limit = ex?.scene === 'goblet' ? T.trunkGood : T.trunkGood + 5;
    checks.push(check('trunk', lean <= limit ? 'good' : lean <= T.trunkMax ? 'caution' : 'low', 'Корпус',
      lean <= limit ? `Нахил корпусу внизу до ${lean}° — груди відкриті.` : `Корпус нахиляється вперед до ${lean}° (ціль ≤ ${limit}°). ${ex?.scene === 'goblet' ? 'Гантель щільно біля грудей, лікті між колінами, груди вгору.' : 'Руки вперед для балансу, груди вгору, таз між п’ятами.'}`));
    const heel = reps.filter((r) => r.heelLift != null && r.heelLift > T.heelLift).length;
    if (heel) checks.push(check('heels', 'caution', 'П’яти', `У ${heel} з ${reps.length} повторень п’ята відривається від підлоги. Тисни всією стопою; якщо не виходить — рухливість гомілкостопу (розтяжка литок) або трохи ширша стійка.`));
    tempoCheck(reps, checks, T.slowDown, 'униз');
  },
  hinge(reps, checks) {
    const T = THRESH.hinge;
    const bent = share(reps, (r) => r.kneeMinRep < T.kneeMin);
    const locked = share(reps, (r) => r.kneeMinRep >= T.kneeLocked);
    checks.push(check('knees', bent ? 'caution' : locked ? 'caution' : 'good', 'Коліна',
      bent ? `У ${bent} з ${reps.length} повторень коліна згинаються до ${Math.min(...reps.map((r) => r.kneeMinRep))}° — це вже присід. Коліна м’які, але рух — тазом назад.`
        : locked ? 'Коліна повністю випрямлені — трохи зігни їх, щоб не навантажувати поперек.' : 'Коліна м’які й майже не рухаються — рух іде від таза.'));
    const shallow = share(reps, (r) => r.depth > T.hipShallow);
    checks.push(check('depth', shallow ? 'caution' : reps.every((r) => r.depth <= T.hipGood) ? 'good' : 'info', 'Нахил',
      shallow ? `У ${shallow} з ${reps.length} повторень нахил малий (кут у тазі ${Math.max(...reps.map((r) => r.depth))}°). Відводь таз далі назад, доки не відчуєш натяг задньої поверхні стегна.`
        : `Кут у тазі внизу ${Math.min(...reps.map((r) => r.depth))}–${Math.max(...reps.map((r) => r.depth))}° — достатній нахил.`));
    tempoCheck(reps, checks, T.slowDown, 'униз');
    checks.push(check('back', 'info', 'Спина', 'Округлення спини модель надійно не бачить. Перевір у кадрах нижньої точки: лінія від плеча до таза пряма, голова продовжує спину.'));
  },
  lunge(reps, checks) {
    const T = THRESH.lunge;
    const good = share(reps, (r) => r.depth <= T.kneeGood), ok = share(reps, (r) => r.depth <= T.kneeOk);
    checks.push(check('depth', good === reps.length ? 'good' : ok === reps.length ? 'caution' : 'low', 'Глибина',
      good === reps.length ? `Переднє коліно ${Math.min(...reps.map((r) => r.depth))}–${Math.max(...reps.map((r) => r.depth))}° — заднє коліно майже біля підлоги.`
        : `Глибоко ${good} з ${reps.length}; найменший кут ${Math.max(...reps.map((r) => r.depth))}° (ціль ≤ ${T.kneeGood}°). Опускай заднє коліно майже до підлоги.`));
    const lean = Math.max(...reps.map((r) => r.trunk ?? 0));
    checks.push(check('trunk', lean <= T.trunkGood ? 'good' : lean <= T.trunkMax ? 'caution' : 'low', 'Корпус',
      lean <= T.trunkGood ? `Корпус рівний (нахил до ${lean}°).` : `Корпус нахиляється до ${lean}° (ціль ≤ ${T.trunkGood}°): тримай груди вгору, таз під плечима.`));
  },
  pushup(reps, checks) {
    const T = THRESH.pushup;
    const deep = share(reps, (r) => r.depth <= T.elbowGood), ok = share(reps, (r) => r.depth <= T.elbowOk);
    checks.push(check('depth', deep === reps.length ? 'good' : ok === reps.length ? 'caution' : 'low', 'Глибина',
      deep === reps.length ? `Лікті до ${Math.max(...reps.map((r) => r.depth))}° — груди біля підлоги.` : `Глибоко ${deep} з ${reps.length}; найменше опускання — лікоть ${Math.max(...reps.map((r) => r.depth))}° (ціль ≤ ${T.elbowGood}°). Опускай груди на 1–2 пальці від підлоги.`));
    const soft = share(reps, (r) => r.top < T.lockout);
    if (soft) checks.push(check('lockout', 'caution', 'Верхня точка', `У ${soft} з ${reps.length} повторень руки вгорі не випрямляються (до ${Math.min(...reps.map((r) => r.top))}°). Повністю випрямляй руки й відштовхуй підлогу лопатками.`));
    lineCheck(reps, checks, T);
  },
  pull(reps, checks, { ex }) {
    const T = THRESH.pull;
    const chin = share(reps, (r) => r.noseOver != null && r.noseOver > 0);
    if (ex?.scene !== 'latpulldown') {
      checks.push(check('top', chin === reps.length ? 'good' : chin ? 'caution' : 'low', 'Верхня точка',
        chin === reps.length ? 'Підборіддя над рівнем рук у кожному повторенні.' : `Підборіддя над руками ${chin} з ${reps.length}. Тягни лікті вниз до ребер, груди до перекладини.`));
    }
    const half = share(reps, (r) => r.top < T.hang);
    checks.push(check('bottom', half ? 'caution' : 'good', 'Нижня точка',
      half ? `У ${half} з ${reps.length} руки внизу не розгинаються (до ${Math.min(...reps.map((r) => r.top))}°). Опускайся до прямих рук, плечі під контролем.` : 'Внизу руки повністю розгинаються.'));
    if (ex?.scene === 'pullup_neg') negativeCheck(reps, checks, T);
  },
  dip(reps, checks, { ex }) {
    const T = THRESH.dip;
    const deep = share(reps, (r) => r.depth <= T.elbowGood), ok = share(reps, (r) => r.depth <= T.elbowOk);
    checks.push(check('depth', deep === reps.length ? 'good' : ok === reps.length ? 'caution' : 'low', 'Глибина',
      deep === reps.length ? `Лікті до ${Math.max(...reps.map((r) => r.depth))}° — плечі на рівні ліктів.` : `Глибоко ${deep} з ${reps.length}; найменше — ${Math.max(...reps.map((r) => r.depth))}° (ціль ≤ ${T.elbowGood}°). Опускайся, доки плече не стане паралельно підлозі, якщо плечі не болять.`));
    if (ex?.scene === 'dip_neg') negativeCheck(reps, checks, T);
  },
};
function tempoCheck(reps, checks, min, word) {
  const fast = share(reps, (r) => r.down < min);
  if (fast) checks.push(check('tempo', 'info', 'Темп', `${fast} з ${reps.length} повторень ${word} швидше за ${num(min)} с. Повільне опускання (2 с) дає більше контролю і сили.`));
}
function negativeCheck(reps, checks, T) {
  const avg = mean(reps.map((r) => r.down));
  checks.push(check('negative', avg >= T.slowNegative ? 'good' : avg >= T.minNegative ? 'caution' : 'low', 'Опускання',
    avg >= T.slowNegative ? `Опускання в середньому ${num(avg)} с — саме те для сили.` : `Опускання в середньому ${num(avg)} с (ціль ${T.slowNegative}–5 с). Рахуй про себе «раз-два-три», гальмуй усю дорогу.`));
}
function lineCheck(reps, checks, T) {
  const bad = reps.filter((r) => r.bodyMin != null && r.bodyMin < T.lineGood);
  if (!bad.length) { checks.push(check('line', 'good', 'Лінія тіла', 'Тіло рівне від плечей до стоп в усіх повтореннях.')); return; }
  const sag = bad.filter((r) => (r.sagMax ?? 0) + (r.sagMin ?? 0) > 0).length;
  const worst = Math.min(...bad.map((r) => r.bodyMin));
  checks.push(check('line', worst < T.lineMin ? 'low' : 'caution', 'Лінія тіла',
    `${bad.length} з ${reps.length}: ${sag >= bad.length / 2 ? 'таз провисає' : 'таз задертий'} (лінія до ${worst}°, ціль ≥ ${T.lineGood}°). ${sag >= bad.length / 2 ? 'Стисни сідниці й прес, ніби планка.' : 'Опусти таз до лінії плечей і стоп.'}`));
}

/** Compact record for the journal and for tuning: results plus per-frame angles (no image, no landmarks). */
export function journalRecord(result, { exId, date, video }) {
  return {
    ex: exId, date, family: result.family, side: result.side, video, quality: result.quality,
    reps: result.reps.map(({ i, notes, ...r }) => r), checks: result.checks, hold: result.hold ?? null,
    series: result.series, thresholds: THRESH,
  };
}
