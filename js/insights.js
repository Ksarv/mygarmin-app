// Pure computations behind the infographics: what the watch recorded for each
// planned session, minutes per day, movement balance and working weights.
// No DOM here, so every number on screen is covered by node tests.

import { addDays, weekStart, sessionMinutes } from './engine.js';

/** Garmin activity types that count as each planned sport. */
export const SPORT_KEYS = {
  strength: ['strength_training'],
  cardio: ['elliptical', 'indoor_cardio', 'cardio_training', 'cardio', 'stair_climbing'],
  yoga: ['yoga', 'mobility', 'flexibility'],
  mobility: ['mobility', 'yoga', 'flexibility'],
  pilates: ['pilates'],
};
const TRAINING = new Set([...Object.values(SPORT_KEYS).flat(), 'hiit', 'indoor_rowing']);
const SLOT_ORDER = { AM: 0, MID: 1, PM: 2 };
/** Local start-time windows of the three daily slots. */
const SLOT_WINDOW = { AM: ['00:00', '11:00'], MID: ['11:00', '15:00'], PM: ['15:00', '24:00'] };

export const MOVEMENT_GROUPS = [
  { id: 'pull', name: 'Тяга', patterns: ['pull_v', 'pull_h'] },
  { id: 'push', name: 'Жим', patterns: ['push_h', 'push_v', 'push_dip'] },
  { id: 'legs', name: 'Присід і випади', patterns: ['squat', 'lunge', 'lunge_lateral', 'calf'] },
  { id: 'hinge', name: 'Таз і задня поверхня', patterns: ['hinge'] },
  { id: 'core', name: 'Корпус', patterns: ['core_anti_ext', 'core_flex', 'core_lat', 'core_anti_rot'] },
  { id: 'shoulder', name: 'Плечі й лопатки', patterns: ['shoulder_health'] },
  { id: 'power', name: 'Потужність, спритність, баланс', patterns: ['plyo', 'agility', 'balance', 'coordination'] },
  { id: 'arms', name: 'Руки', patterns: ['arm_flex', 'arm_ext'] },
];

function ordered(activities) {
  // Garmin lists newest first; with start times we sort explicitly.
  const list = [...(activities ?? [])];
  return list.some((a) => a.time) ? list.sort((a, b) => `${a.date} ${a.time ?? ''}`.localeCompare(`${b.date} ${b.time ?? ''}`)) : list.reverse();
}

/**
 * Pair planned sessions with watch activities of the same day and sport.
 * A start time decides the slot; without one, only sessions logged as done or
 * partial may take an activity, in slot order.
 */
export function matchWatch(sessions, metrics, log) {
  const out = {};
  const acts = ordered(metrics?.activities);
  const used = new Set();
  const byDay = {};
  for (const s of sessions) (byDay[s.date] ??= []).push(s);
  for (const list of Object.values(byDay)) {
    list.sort((a, b) => (SLOT_ORDER[a.slot] ?? 3) - (SLOT_ORDER[b.slot] ?? 3));
    for (const s of list) {
      const keys = SPORT_KEYS[s.sport] ?? [];
      const cand = acts.filter((a, i) => !used.has(i) && a.date === s.date && keys.includes(a.type));
      const win = SLOT_WINDOW[s.slot];
      let hit = cand.find((a) => a.time && win && a.time >= win[0] && a.time < win[1]);
      const r = log?.sessions?.[s.id];
      if (!hit && r && r.status !== 'skipped') hit = cand.find((a) => !a.time) ?? cand[0];
      if (hit) { used.add(acts.indexOf(hit)); out[s.id] = hit; }
    }
  }
  return out;
}

/** Minutes the journal gives a session (a partial without minutes counts half). */
export function loggedMinutes(s, r, lib) {
  if (!r || r.status === 'skipped') return 0;
  return r.minutes ?? (r.status === 'partial' ? Math.round(sessionMinutes(s, lib) / 2) : sessionMinutes(s, lib));
}

/**
 * Minutes per day from the journal and the watch. The day's value is the larger
 * of the two, so a session done without the watch, or watch time without a
 * journal entry, both count once.
 */
export function dayMinutes(weeks, lib) {
  const days = {};
  for (const { plan, log, metrics } of weeks) {
    const start = plan?.start ?? metrics?.start;
    for (let i = 0; i < 7; i += 1) days[addDays(start, i)] ??= { log: 0, watch: 0, sessions: [], other: [] };
    for (const s of plan?.sessions ?? []) {
      const r = log?.sessions?.[s.id];
      const d = days[s.date];
      if (!d) continue;
      d.log += loggedMinutes(s, r, lib);
      d.sessions.push({ title: s.title, status: r?.status ?? null, optional: !!s.optional, type: s.type });
    }
    for (const a of metrics?.activities ?? []) {
      const d = days[a.date];
      if (!d) continue;
      if (TRAINING.has(a.type)) d.watch += a.minutes || 0;
      else d.other.push(a);
    }
  }
  for (const d of Object.values(days)) {
    d.watch = Math.round(d.watch);
    d.minutes = Math.max(d.log, d.watch);
  }
  return days;
}

const FAMILY_OF_TYPE = { strength: 'strength', cardio: 'cardio', flex: 'flex', native: 'flex' };
const FAMILY_OF_ACTIVITY = (type) => (SPORT_KEYS.strength.includes(type) || type === 'hiit' ? 'strength' : SPORT_KEYS.cardio.includes(type) || type === 'indoor_rowing' ? 'cardio' : 'flex');

/**
 * Minutes of one week per session family. Plan = required sessions. Fact per
 * session = the larger of journal and watch; watch training that matches no
 * planned session is added to its family, so nothing done is lost.
 */
export function weekMinutes(plan, log, metrics, lib) {
  const out = { strength: { planned: 0, actual: 0 }, cardio: { planned: 0, actual: 0 }, flex: { planned: 0, actual: 0 } };
  const watch = matchWatch(plan?.sessions ?? [], metrics, log);
  const matched = new Set(Object.values(watch));
  for (const s of plan?.sessions ?? []) {
    const f = out[FAMILY_OF_TYPE[s.type] ?? 'flex'];
    if (!s.optional) f.planned += sessionMinutes(s, lib);
    const r = log?.sessions?.[s.id];
    f.actual += Math.max(loggedMinutes(s, r, lib), Math.round(watch[s.id]?.minutes ?? 0));
  }
  for (const a of metrics?.activities ?? []) {
    if (matched.has(a) || !TRAINING.has(a.type)) continue;
    out[FAMILY_OF_ACTIVITY(a.type)].actual += Math.round(a.minutes || 0);
  }
  return out;
}

/** Sets per movement group in a week: planned (required sessions) and done. */
export function movementBalance(plan, log, lib) {
  const groups = MOVEMENT_GROUPS.map((g) => ({ ...g, planned: 0, done: 0 }));
  const groupOf = (exId) => {
    const p = lib.exercises[exId]?.pattern;
    return groups.find((g) => g.patterns.includes(p));
  };
  for (const s of plan?.sessions ?? []) {
    const r = log?.sessions?.[s.id];
    const share = !r ? 0 : r.status === 'done' ? 1 : r.status === 'partial' ? 0.5 : 0;
    for (const b of s.blocks ?? []) {
      if (b.kind !== 'main') continue;
      for (const it of b.items ?? []) {
        const g = groupOf(it.ex);
        if (!g) continue;
        const sets = it.sets ?? b.rounds ?? 1;
        if (!s.optional) g.planned += sets;
        g.done += sets * share;
      }
    }
  }
  return groups.filter((g) => g.planned || g.done).map((g) => ({ ...g, done: Math.round(g.done) }));
}

function watchKey(ex) { return ex?.garmin ? `${ex.garmin.category}/${ex.garmin.exercise}` : null; }

/**
 * Working weights per exercise and week: the planned kg (heaviest prescription
 * that week) and the fact — the journal's kg, or else the watch's heaviest set.
 */
export function weightTable(weeks, lib) {
  const rows = {};
  weeks.forEach(({ plan, log, metrics }, wi) => {
    for (const s of plan?.sessions ?? []) {
      for (const b of s.blocks ?? []) {
        if (b.kind !== 'main') continue;
        for (const it of b.items ?? []) {
          const ex = lib.exercises[it.ex];
          if (!ex || ex.load === 'bodyweight' || it.kg == null) continue;
          const row = rows[it.ex] ??= { ex: it.ex, name: ex.name, plan: Array(weeks.length).fill(null), fact: Array(weeks.length).fill(null), source: Array(weeks.length).fill(null) };
          row.plan[wi] = Math.max(row.plan[wi] ?? 0, it.kg);
        }
      }
    }
    for (const r of Object.values(log?.sessions ?? {})) {
      for (const [exId, ir] of Object.entries(r.items ?? {})) {
        if (ir.kg == null || !rows[exId]) continue;
        rows[exId].fact[wi] = Math.max(rows[exId].fact[wi] ?? 0, ir.kg);
        rows[exId].source[wi] = 'журнал';
      }
    }
    for (const a of metrics?.activities ?? []) {
      for (const e of a.exercises ?? []) {
        if (e.kg == null) continue;
        for (const row of Object.values(rows)) {
          if (watchKey(lib.exercises[row.ex]) !== e.garmin || row.source[wi] === 'журнал') continue;
          row.fact[wi] = Math.max(row.fact[wi] ?? 0, e.kg);
          row.source[wi] = 'годинник';
        }
      }
    }
  });
  return Object.values(rows).map((row) => {
    const lastPlan = row.plan.map((v, i) => [v, i]).filter(([v]) => v != null).at(-1);
    const firstPlan = row.plan.find((v) => v != null);
    const lastFact = row.fact.map((v, i) => [v, i]).filter(([v]) => v != null).at(-1);
    return {
      ...row,
      now: lastPlan?.[0] ?? null,
      nowWeek: lastPlan?.[1] ?? -1,
      delta: lastPlan ? lastPlan[0] - firstPlan : 0,
      lastFact: lastFact ? { kg: lastFact[0], week: lastFact[1], source: row.source[lastFact[1]] } : null,
    };
  }).sort((a, b) => b.nowWeek - a.nowWeek || a.name.localeCompare(b.name, 'uk'));
}

/** Daily Garmin health numbers across all fetched weeks, oldest first. */
export function dailyHealth(metricsList) {
  const days = {};
  for (const m of metricsList) for (const [d, v] of Object.entries(m?.days ?? {})) days[d] = { ...days[d], ...v };
  return Object.keys(days).sort().map((date) => ({ date, ...days[date] }));
}

/** Headline numbers for the progress screen. */
export function kpis(weeks, summaries, days, today) {
  let sessions = 0;
  for (const { log } of weeks) for (const r of Object.values(log?.sessions ?? {})) if (r.status === 'done' || r.status === 'partial') sessions += 1;
  const minutes = Object.entries(days).filter(([d]) => d <= today).reduce((a, [, v]) => a + v.minutes, 0);
  const current = weekStart(today);
  const past = weeks.map((w, i) => ({ w, s: summaries[i] })).filter(({ w }) => w.plan && w.plan.block !== 'legacy' && w.plan.start < current);
  const ok = past.filter(({ s }) => s.completion >= 60).length;
  const now = weeks.findIndex((w) => w.plan?.start === current);
  const cur = now >= 0 ? summaries[now] : null;
  const pastDays = Object.entries(days).filter(([d]) => d <= today);
  const activeDays = pastDays.filter(([, v]) => v.minutes > 0).length;
  return { sessions, hours: Math.round(minutes / 6) / 10, weeksOk: ok, weeksPast: past.length, activeDays, days: pastDays.length, thisDone: cur ? cur.done + cur.partial : null, thisRequired: cur?.required ?? null };
}

// ------------------------------------------------- conclusions from the watch --
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const vals = (days, key) => days.map((d) => d[key]).filter((v) => v != null);
const r1 = (v) => Math.round(v * 10) / 10;
const num = (v) => String(r1(v)).replace('.', ',');
const ddmm = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
export const LEVEL = { good: '✓', caution: '!', low: '‼', info: 'i' };

/**
 * Readiness for one day from the watch, against the personal baseline (median
 * of up to 28 earlier days). Thresholds:
 *   resting HR  +3 bpm → caution, +5 → low;
 *   HRV (night) −8 % → caution, −15 % → low;
 *   sleep       < 6.5 h → caution, < 5 h → low.
 * Two "low" signals, or one low with two cautions → low; one low or two
 * cautions → caution.
 */
export function readiness(health, date) {
  const upto = health.filter((d) => d.date <= date);
  const day = [...upto].reverse().find((d) => d.resting_hr != null || d.hrv_night_ms != null || d.sleep_hours != null);
  if (!day) return { level: 'unknown', signals: [], date: null };
  const base = upto.filter((d) => d.date < day.date).slice(-28);
  const signals = [];
  const rhr = vals(base, 'resting_hr');
  if (day.resting_hr != null && rhr.length >= 5) {
    const b = median(rhr), d = day.resting_hr - b;
    signals.push({ key: 'resting_hr', label: 'Пульс спокою', value: day.resting_hr, unit: 'уд/хв', base: b,
      level: d >= 5 ? 'low' : d >= 3 ? 'caution' : 'good',
      text: `${day.resting_hr} уд/хв (твоя норма ${num(b)}${d ? `, ${d > 0 ? '+' : '−'}${num(Math.abs(d))}` : ''})` });
  }
  const hrv = vals(base, 'hrv_night_ms');
  if (day.hrv_night_ms != null && hrv.length >= 5) {
    const b = median(hrv), ratio = day.hrv_night_ms / b;
    const pct = Math.round((ratio - 1) * 100);
    signals.push({ key: 'hrv_night_ms', label: 'HRV уночі', value: day.hrv_night_ms, unit: 'мс', base: b,
      level: ratio <= 0.85 ? 'low' : ratio <= 0.92 ? 'caution' : 'good',
      text: `${day.hrv_night_ms} мс (норма ${num(b)}${pct ? `, ${pct > 0 ? '+' : '−'}${Math.abs(pct)} %` : ''})` });
  }
  if (day.sleep_hours != null) {
    signals.push({ key: 'sleep_hours', label: 'Сон', value: day.sleep_hours, unit: 'год',
      level: day.sleep_hours < 5 ? 'low' : day.sleep_hours < 6.5 ? 'caution' : 'good',
      text: `${num(day.sleep_hours)} год` });
  }
  const lows = signals.filter((s) => s.level === 'low').length;
  const cautions = signals.filter((s) => s.level === 'caution').length;
  const level = !signals.length ? 'unknown' : lows >= 2 || (lows === 1 && cautions >= 2) ? 'low' : lows === 1 || cautions >= 2 ? 'caution' : 'good';
  const advice = {
    good: 'Готовий: тренуйся за планом.',
    caution: 'Обережно: заняття за планом, але без рекордів — тримай вагу, оцінюй чесно, інтервали заміни рівним темпом.',
    low: 'Відновлення: заміни важке заняття легким (рухливість або орбітрек 20–30 хв у розмовному темпі) чи відпочинь.',
    unknown: 'Даних годинника для оцінки поки замало.',
  }[level];
  return { level, signals, date: day.date, advice };
}

/** Recovery over one week: holds progression when the body did not keep up. */
export function recoveryWeek(health, start) {
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const date = addDays(start, i);
    if (!health.some((d) => d.date === date)) continue;
    const r = readiness(health, date);
    if (r.date === date) days.push({ date, level: r.level });
  }
  const low = days.filter((d) => d.level === 'low').length;
  const caution = days.filter((d) => d.level === 'caution').length;
  const hold = low >= 2 || low + caution >= 4;
  return {
    days, low, caution, hold,
    reason: hold ? `За годинником ${low + caution} з ${days.length} днів відновлення нижче твоєї норми (пульс спокою, HRV, сон) — дозування не підвищуємо.` : null,
  };
}

/** Plain conclusions with the numbers behind them. */
export function watchConclusions({ health, weeks = [], today }) {
  const out = [];
  const past = health.filter((d) => d.date <= today);
  const acts = weeks.flatMap((w) => w.metrics?.activities ?? []).filter((a) => TRAINING.has(a.type) && a.date <= today);
  // 1. Sleep: the most common limiter.
  const last14 = past.slice(-14);
  const sleep = vals(last14, 'sleep_hours');
  if (sleep.length >= 5) {
    const short = sleep.filter((h) => h < 6).length;
    const avg = mean(sleep);
    out.push({
      key: 'sleep', level: short >= 3 || avg < 6.5 ? 'caution' : 'good', title: 'Сон',
      text: short >= 3
        ? `${short} з ${sleep.length} останніх ночей коротші за 6 год, у середньому ${String(r1(avg)).replace('.', ',')} год. Сон зараз обмежує відновлення більше, ніж тренування: ціль — 7–8 год.`
        : `У середньому ${String(r1(avg)).replace('.', ',')} год за ${sleep.length} ночей — достатньо для прогресу.`,
    });
  }
  // 2. Late sessions and the following night.
  const sleepOf = Object.fromEntries(past.filter((d) => d.sleep_hours != null).map((d) => [d.date, d.sleep_hours]));
  const lateNights = acts.filter((a) => a.time && a.time >= '21:00' && a.minutes >= 10).map((a) => addDays(a.date, 1)).filter((d) => sleepOf[d] != null);
  const lateSet = new Set(lateNights);
  const otherNights = Object.keys(sleepOf).filter((d) => !lateSet.has(d));
  if (lateSet.size >= 3 && otherNights.length >= 3) {
    const a = mean([...lateSet].map((d) => sleepOf[d])), b = mean(otherNights.map((d) => sleepOf[d]));
    if (b - a >= 0.7) {
      out.push({ key: 'late', level: 'caution', title: 'Пізні тренування',
        text: `Після тренувань, що почались після 21:00, ти спиш у середньому ${String(r1(a)).replace('.', ',')} год, в інші ночі — ${String(r1(b)).replace('.', ',')} год (${lateSet.size} і ${otherNights.length} ночей). Важкі заняття краще закінчувати за 2–3 год до сну або переносити на ранок; увечері — рухливість і розтяжка.` });
    }
  }
  // 3. Resting HR and HRV trend: last 7 days against the 21 before.
  for (const [key, label, unit, better] of [['resting_hr', 'Пульс спокою', 'уд/хв', -1], ['hrv_night_ms', 'HRV уночі', 'мс', 1]]) {
    const recent = vals(past.slice(-7), key), before = vals(past.slice(-28, -7), key);
    if (recent.length < 4 || before.length < 5) continue;
    const a = mean(recent), b = mean(before);
    const rel = key === 'hrv_night_ms' ? (a / b - 1) * 100 : a - b;
    const good = better * rel > (key === 'hrv_night_ms' ? 4 : 1.5);
    const bad = better * rel < (key === 'hrv_night_ms' ? -6 : -2.5);
    const delta = key === 'hrv_night_ms' ? `${rel > 0 ? '+' : '−'}${Math.abs(Math.round(rel))} %` : `${rel > 0 ? '+' : '−'}${num(Math.abs(rel))} ${unit}`;
    out.push({ key, level: bad ? 'caution' : good ? 'good' : 'info', title: label,
      text: `Останні 7 днів ${num(a)} ${unit} проти ${num(b)} ${unit} раніше (${delta}). ${good ? 'Тіло адаптується до навантаження.' : bad ? 'Відновлення гірше за твою норму — подбай про сон і не підвищуй навантаження цього тижня.' : 'Стабільно.'}` });
  }
  // 4. Recovery dips and what preceded them.
  const dips = past.filter((d) => readiness(past, d.date).level === 'low' && readiness(past, d.date).date === d.date).slice(-3);
  for (const d of dips) {
    const before = acts.filter((a) => a.date >= addDays(d.date, -2) && a.date < d.date && a.minutes >= 20);
    const r = readiness(past, d.date);
    const back = past.find((x) => x.date > d.date && readiness(past, x.date).date === x.date && readiness(past, x.date).level === 'good')?.date;
    out.push({ key: `dip-${d.date}`, level: 'info', title: `Просідання ${ddmm(d.date)}`,
      text: `${r.signals.filter((s) => s.level !== 'good').map((s) => `${s.key === 'hrv_night_ms' ? s.label : s.label.toLowerCase()} ${s.text}`).join('; ')}.${before.length ? ` Перед цим ${before.length} ${before.length < 5 ? 'тренування' : 'тренувань'} за 2 дні (${before.map((a) => `${ddmm(a.date)} ${Math.round(a.minutes)} хв${a.avg_hr ? `, пульс ${a.avg_hr}` : ''}`).join('; ')}).` : ''} ${back ? `Повернення до норми — ${ddmm(back)}: нормальна реакція на навантаження${before.length >= 2 ? ', але два важкі дні поспіль із коротким сном її підсилюють' : ''}.` : 'До норми ще не повернувся — наступне важке заняття роби лише після «зеленого» дня.'}` });
  }
  // 5. Recording gap.
  const lastAct = acts.map((a) => a.date).sort().at(-1);
  if (lastAct) {
    const gap = Math.round((new Date(today) - new Date(lastAct)) / 86400000);
    if (gap >= 4) out.push({ key: 'record', level: 'info', title: 'Запис тренувань',
      text: `Останнє тренування на годиннику — ${ddmm(lastAct)} (${gap} дн. тому). Запускай заняття з годинника (Тренування → Календар або Мої тренування): тоді пульс, підходи й хвилини самі потраплять у журнал і висновки.` });
  }
  return out;
}

// ----------------------------------------- load, heart-rate zones, recovery detail --
/** Garmin wording → Ukrainian. */
export const TE_LABEL = {
  RECOVERY: 'відновлення', AEROBIC_BASE: 'аеробна база', TEMPO: 'темп', LACTATE_THRESHOLD: 'поріг',
  VO2MAX: 'VO2 max', ANAEROBIC_CAPACITY: 'анаеробна ємність', SPEED: 'швидкість',
};
const ACT_NAME = {
  cycling: 'на велосипеді', road_biking: 'на шосейному велосипеді', mountain_biking: 'на гірському велосипеді', gravel_cycling: 'на гравелі',
  indoor_cycling: 'на велотренажері', virtual_ride: 'на велотренажері', running: 'на бігу', trail_running: 'на трейлі', treadmill_running: 'на біговій доріжці',
  strength_training: 'у силовому', elliptical: 'на орбітреку', indoor_cardio: 'у кардіо', resort_skiing_snowboarding_ws: 'на сноуборді', resort_snowboarding: 'на сноуборді', hiking: 'у поході',
};
export const TR_LEVEL = { POOR: 'погана', LOW: 'низька', MODERATE: 'помірна', HIGH: 'висока', PRIME: 'максимальна' };
export function statusName(phrase) {
  const p = String(phrase ?? '');
  const map = [['PRODUCTIVE', 'продуктивно'], ['UNPRODUCTIVE', 'непродуктивно'], ['MAINTAINING', 'підтримка форми'], ['RECOVERY', 'відновлення'],
    ['DETRAINING', 'втрата форми'], ['PEAKING', 'пік форми'], ['OVERREACHING', 'перевантаження'], ['STRAINED', 'напруга'], ['NO_STATUS', 'немає статусу']];
  return (map.find(([k]) => p.startsWith(k)) ?? [null, null])[1];
}
const sum = (a) => a.reduce((x, y) => x + (y || 0), 0);
const hm = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/**
 * Heart-rate zones as Garmin uses them, plus a check of the maximum they are
 * built on against the highest pulse the watch has actually recorded.
 */
export function zoneSetup(metricsList) {
  const weeks = metricsList.filter(Boolean);
  const cfg = [...weeks].reverse().map((m) => m.week?.hr_zones).find(Boolean)
    ?? (() => { const a = weeks.flatMap((m) => m.activities ?? []).reverse().find((x) => x.zone_floors); return a ? { floors: a.zone_floors } : null; })();
  if (!cfg?.floors?.length) return null;
  const f = cfg.floors;
  const range = (i) => [f[i], f[i + 1] != null ? f[i + 1] - 1 : cfg.max_hr ?? null];
  const seen = Math.max(0, ...weeks.flatMap((m) => m.activities ?? []).map((a) => a.max_hr ?? 0)) || null;
  const record = [...weeks].reverse().map((m) => m.week?.max_hr_record).find(Boolean) ?? null;
  return { floors: f, maxHr: cfg.max_hr ?? null, method: cfg.method ?? null, seenMax: seen, record, z2: range(1), z3: range(2), z4: range(3) };
}

/** Latest acute:chronic load from the watch. 0.8–1.3 is the safe band; above 1.5 load grows too fast. */
export function loadState(health, date) {
  const day = [...health].reverse().find((d) => d.date <= date && d.load_ratio != null);
  if (!day) return null;
  const r = day.load_ratio;
  const level = r > 1.5 ? 'low' : r > 1.3 ? 'caution' : r < 0.8 ? 'info' : 'good';
  return { date: day.date, ratio: r, acute: day.load_acute ?? null, chronic: day.load_chronic ?? null, level, status: statusName(day.training_status) };
}

const FOCUS = [
  { key: 'aerobic_low', name: 'Низька аеробна', short: 'спокійне кардіо в зоні 1–2', more: 'додай хвилин рівного кардіо в розмовному темпі (зона 2)' },
  { key: 'aerobic_high', name: 'Висока аеробна', short: 'темп і інтервали в зоні 3–4', more: 'одне кардіо на тиждень роби інтервальним: 4–6 × 3 хв у зоні 4 через 2 хв легко' },
  { key: 'anaerobic', name: 'Анаеробна', short: 'короткі вибухові відрізки', more: 'короткі вибухові відрізки: 6–8 × 20–30 с (човниковий біг, стрибки на куб) з повним відпочинком' },
];
/** Four-week load focus against Garmin's target bands, with what to change. */
export function loadFocus(metricsList) {
  const lf = [...metricsList.filter(Boolean)].reverse().map((m) => m.week?.load_focus).find(Boolean);
  if (!lf) return null;
  const rows = FOCUS.map((f) => {
    const v = lf[f.key] ?? {};
    const state = v.load == null ? 'none' : v.min != null && v.load < v.min ? 'short' : v.max != null && v.load > v.max ? 'over' : 'ok';
    const rd = (x) => (x == null ? null : Math.round(x));
    return { ...f, load: rd(v.load), min: rd(v.min), max: rd(v.max), state };
  });
  return { date: lf.date ?? null, rows };
}

/** How one recorded activity fits what the session asked for. */
export function sessionZones(session, act, setup) {
  const z = act?.zones;
  const total = z ? sum(z) : 0;
  if (!z || total < 300) return null;
  const pct = z.map((s) => Math.round((s / total) * 100));
  const min = (s) => Math.round(s / 60);
  const z3up = z[2] + z[3] + z[4], z4up = z[3] + z[4];
  const kind = session.type === 'cardio' ? (session.phases?.some((p) => p.repeat) ? 'intervals' : 'steady') : session.type === 'strength' ? 'strength' : 'other';
  const z2 = setup?.z2 ? ` (${setup.z2[0]}–${setup.z2[1]} уд/хв)` : '';
  let level = 'info', text;
  if (kind === 'steady') {
    if (z3up / total > 0.35) { level = 'caution'; text = `Рівний темп вийшов інтенсивнішим: ${Math.round((z3up / total) * 100)} % часу в зоні 3 і вище. Зменш опір або темп — ціль зона 2${z2}.`; }
    else if (z[1] / total >= 0.5) { level = 'good'; text = `${pct[1]} % часу в зоні 2 — саме те, що треба для аеробної бази.`; }
    else if (z[0] / total > 0.5) { text = `Більше половини часу в зоні 1 — можна трохи додати опору, щоб триматися в зоні 2${z2}.`; }
    else text = `Зона 2 — ${pct[1]} % часу.`;
  } else if (kind === 'intervals') {
    const on = sum((session.phases ?? []).filter((p) => p.repeat).map((p) => p.repeat * (p.on ?? 0) * 60));
    const hit = on ? z3up / on : 0;
    if (on && hit >= 0.5) { level = 'good'; text = `Швидкі відрізки дотягнули: ${min(z3up)} хв у зоні 3 і вище з ${min(on)} хв роботи${z4up >= 60 ? `, з них ${min(z4up)} хв у зоні 4–5` : ''}.`; }
    else { level = 'caution'; text = `У зоні 3 і вище лише ${min(z3up)} хв з ${min(on)} хв швидких відрізків — роби їх інтенсивніше (говориш лише кількома словами).`; }
  } else if (kind === 'strength') {
    text = z3up / total >= 0.25 ? `Кола дали й кардіо: ${min(z3up)} хв (${Math.round((z3up / total) * 100)} %) у зоні 3 і вище.` : `Переважно зони 1–2 (${Math.round(((z[0] + z[1]) / total) * 100)} % часу): силова без великого кардіо-навантаження — це нормально.`;
  } else text = `Зони 1–2: ${pct[0] + pct[1]} % часу.`;
  const te = act.aerobic_te != null ? `Аеробний ефект ${num(act.aerobic_te)} з 5${act.anaerobic_te >= 0.1 ? `, анаеробний ${num(act.anaerobic_te)}` : ''}${act.te_label && TE_LABEL[act.te_label] ? ` (${TE_LABEL[act.te_label]})` : ''}.` : '';
  return { pct, minutes: z.map(min), level, text, te, load: act.load ?? null };
}

/** Respiration at night against the personal baseline (two weeks). */
function respSignal(base, day) {
  const r = vals(base.slice(-14), 'resp_night');
  if (day.resp_night == null || r.length < 5) return null;
  const b = median(r), d = r1(day.resp_night - b);
  return { key: 'resp_night', label: 'Дихання вночі', value: day.resp_night, unit: 'вд/хв', base: b,
    level: d >= 2 ? 'low' : d >= 1 ? 'caution' : 'good',
    text: `${num(day.resp_night)} вд/хв (норма ${num(b)}${d ? `, ${d > 0 ? '+' : '−'}${num(Math.abs(d))}` : ''})` };
}

/** Extra readiness rows: night respiration (counts) and Garmin's own score (shown, counts only when poor). */
export function readinessPlus(health, date) {
  const rd = readiness(health, date);
  if (rd.level === 'unknown') return rd;
  const upto = health.filter((d) => d.date <= date);
  const day = upto.find((d) => d.date === rd.date) ?? {};
  const base = upto.filter((d) => d.date < rd.date);
  const signals = [...rd.signals];
  const resp = respSignal(base, day);
  if (resp) signals.push(resp);
  const tr = [...upto].reverse().find((d) => d.date >= rd.date && d.tr_score != null) ?? (day.tr_score != null ? day : null);
  if (tr) {
    signals.push({ key: 'tr', label: 'Garmin Training Readiness', value: tr.tr_score,
      level: tr.tr_level === 'POOR' ? 'caution' : 'info',
      text: `${tr.tr_score} — ${TR_LEVEL[tr.tr_level] ?? String(tr.tr_level ?? '').toLowerCase()}${tr.tr_recovery_h ? `, відновлення ще ${num(tr.tr_recovery_h)} год` : ''}` });
  }
  const scored = signals.filter((s) => s.level !== 'info');
  const lows = scored.filter((s) => s.level === 'low').length, cautions = scored.filter((s) => s.level === 'caution').length;
  const level = lows >= 2 || (lows === 1 && cautions >= 2) ? 'low' : lows === 1 || cautions >= 2 ? 'caution' : 'good';
  const respNote = resp && resp.level !== 'good' && signals.some((s) => s.key === 'resting_hr' && s.level !== 'good')
    ? ' Дихання й пульс спокою вище норми одночасно — так часто починається застуда: сьогодні легкий день.' : '';
  return { ...rd, level, signals, advice: ADVICE[level] + respNote };
}
const ADVICE = {
  good: 'Готовий: тренуйся за планом.',
  caution: 'Обережно: заняття за планом, але без рекордів — тримай вагу, оцінюй чесно, інтервали заміни рівним темпом.',
  low: 'Відновлення: заміни важке заняття легким (рухливість або 20–30 хв кардіо в розмовному темпі) чи відпочинь.',
};

/** Weekly hold: recovery below the norm, or load growing too fast. */
export function recoveryWeekPlus(health, start) {
  const rw = recoveryWeek(health, start);
  const ls = loadState(health, addDays(start, 6));
  if (ls && ls.date >= start && ls.ratio > 1.5 && !rw.hold) {
    return { ...rw, hold: true, reason: `Навантаження за 7 днів у ${num(ls.ratio)} раза вище за звичне за 4 тижні (норма 0,8–1,3) — наступного тижня дозування не підвищуємо.` };
  }
  return rw;
}

/** More conclusions: load, zones setup, bedtime, deep sleep, intensity minutes. */
export function watchConclusionsPlus({ health, weeks = [], today, unrecorded = 0 }) {
  const out = watchConclusions({ health, weeks, today });
  const past = health.filter((d) => d.date <= today);
  const metricsList = weeks.map((w) => w.metrics).filter(Boolean);
  const ls = loadState(past, today);
  if (ls) {
    const why = ls.ratio < 0.8 && unrecorded > 0
      ? ` Але цього тижня ${unrecorded} ${unrecorded === 1 ? 'заняття відмічене' : 'заняття відмічені'} в журналі без запису на годиннику — Garmin ${unrecorded === 1 ? 'його' : 'їх'} не бачить, тож низьке навантаження${ls.status ? ` і статус «${ls.status}»` : ''} тут хибні. Запускай заняття з годинника.`
      : ls.ratio < 0.8 ? ' Навантаження нижче звичного — є запас, щоб додавати.' : ls.ratio > 1.5 ? ' Росте занадто швидко: цього тижня без підвищень, більше сну.' : ls.ratio > 1.3 ? ' Верхня межа норми — не додавай одразу всього.' : ' Безпечний темп росту.';
    out.unshift({ key: 'load', level: ls.ratio < 0.8 && unrecorded > 0 ? 'info' : ls.level, title: 'Навантаження проти звичного',
      text: `Гостре навантаження (7 днів) ${ls.acute ?? '—'}, звичне (4 тижні) ${ls.chronic ?? '—'}: співвідношення ${num(ls.ratio)}, норма 0,8–1,3.${ls.status && !(ls.ratio < 0.8 && unrecorded > 0) ? ` Статус Garmin: ${ls.status}.` : ''}${why}` });
  }
  const lf = loadFocus(metricsList);
  if (lf) {
    const short = lf.rows.filter((r) => r.state === 'short'), over = lf.rows.filter((r) => r.state === 'over');
    if (short.length || over.length) {
      out.push({ key: 'focus', level: 'caution', title: 'Фокус навантаження за 4 тижні',
        text: [...short.map((r) => `Бракує: ${r.name.toLowerCase()} (${r.load} при нормі ${r.min}–${r.max}) — ${r.more}.`), ...over.map((r) => `Забагато: ${r.name.toLowerCase()} (${r.load} при нормі ${r.min}–${r.max}).`)].join(' ') });
    } else out.push({ key: 'focus', level: 'good', title: 'Фокус навантаження за 4 тижні', text: 'Усі три види навантаження в межах норми Garmin.' });
  }
  const zs = zoneSetup(metricsList);
  const rec = zs?.record;
  if (zs?.maxHr && rec?.bpm && rec.bpm >= zs.maxHr - 3) {
    out.push({ key: 'zones', level: 'good', title: 'Пульсові зони',
      text: `Максимум ${zs.maxHr}, від якого Garmin рахує зони, підтверджений: ${rec.bpm} уд/хв ${ACT_NAME[rec.type] ?? 'у занятті'} ${ddmm(rec.date)}.${String(rec.type).includes('cycl') || String(rec.type).includes('biking') ? ' На велосипеді пульс зазвичай нижчий, ніж у бігу, тож цей максимум не завищений.' : ''} Зони коректні: зона 2 — ${zs.z2[0]}–${zs.z2[1]} уд/хв. У залі до нього просто не доходиш — найвище за цикл ${zs.seenMax ?? '—'}.` });
  } else if (zs?.maxHr && zs.seenMax && zs.maxHr - Math.max(zs.seenMax, rec?.bpm ?? 0) >= 15) {
    out.push({ key: 'zones', level: 'info', title: 'Пульсові зони',
      text: `Зони в Garmin рахуються від максимального пульсу ${zs.maxHr}, а найвищий пульс ${rec ? `за останні ${rec.activities} тренувань — ${rec.bpm}` : `у записаних заняттях циклу — ${zs.seenMax}`}. Якщо ${zs.maxHr} не виміряний, а взятий за віком, зони можуть бути зміщені. Зараз зона 2 — ${zs.z2[0]}–${zs.z2[1]} уд/хв.` });
  }
  const nights = past.slice(-14).filter((d) => d.bed_time);
  if (nights.length >= 5) {
    const mins = nights.map((d) => { const m = hm(d.bed_time); return m < 12 * 60 ? m + 24 * 60 : m; });
    const avg = mean(mins), sd = Math.sqrt(mean(mins.map((m) => (m - avg) ** 2)));
    const clock = (m) => { const x = Math.round(m) % (24 * 60); return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };
    const late = mins.filter((m) => m >= 24 * 60 + 30).length;
    if (sd >= 45 || late >= 3) {
      out.push({ key: 'bed', level: 'caution', title: 'Час засинання',
        text: `Засинаєш у середньому о ${clock(avg)}, розкид ±${Math.round(sd)} хв${late ? `, ${late} з ${nights.length} ночей після 00:30` : ''}. Сталий час відходу до сну дає більше глибокого сну, ніж додаткова година в ліжку.` });
    }
  }
  const deep = past.slice(-14).filter((d) => d.deep_min != null && d.sleep_hours);
  if (deep.length >= 5) {
    const share = mean(deep.map((d) => d.deep_min / (d.sleep_hours * 60))) * 100;
    if (share < 13) out.push({ key: 'deep', level: 'caution', title: 'Глибокий сон', text: `Глибокий сон — ${Math.round(share)} % ночі (норма для дорослих 13–23 %). Його зменшують пізні важкі тренування, алкоголь і пізня їжа.` });
  }
  const last7 = past.slice(-7).filter((d) => d.moderate_min != null);
  if (last7.length >= 6) {
    const im = sum(last7.map((d) => d.moderate_min + 2 * (d.vigorous_min ?? 0)));
    const goal = last7.at(-1).intensity_goal ?? 150;
    out.push({ key: 'im', level: im >= goal ? 'good' : 'info', title: 'Хвилини інтенсивності',
      text: `За 7 днів ${im} з ${goal} (інтенсивні хвилини рахуються вдвічі)${im >= goal ? '.' : ` — бракує ${goal - im}. Найпростіше: швидка ходьба 20–30 хв у дні без тренувань.`}` });
  }
  return out;
}
