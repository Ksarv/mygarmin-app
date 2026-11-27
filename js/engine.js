// MyGarmin training engine: pure functions shared by the phone app and tests.
// No network, no storage, no DOM. Every change it proposes carries a reason.

export const RATINGS = { easy: 'Легко', right: 'Посильно', hard: 'Важко' };
export const STATUSES = { done: 'Виконано', partial: 'Частково', skipped: 'Пропущено' };

// ---------------------------------------------------------------- dates --
export function parseDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export function isoDate(date) {
  return date.toISOString().slice(0, 10);
}
export function addDays(iso, days) {
  const d = parseDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}
/** Monday of the week that contains `iso`. */
export function weekStart(iso) {
  const d = parseDate(iso);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return isoDate(d);
}
export function cycleWeek(meta, iso) {
  const diff = (parseDate(weekStart(iso)) - parseDate(meta.cycle_start)) / 86400000;
  return Math.floor(diff / 7) + 1;
}
export function weekStartForCycleWeek(meta, week) {
  return addDays(meta.cycle_start, 7 * (week - 1));
}

// ------------------------------------------------------------- formatting --
export function formatKg(kg) {
  return String(kg).replace('.', ',') + ' кг';
}
export function loadLabel(item) {
  if (item.load === 'bodyweight') return 'власна вага';
  if (item.kg == null) return 'вагу підбери в першому підході (2–3 повторення в запасі) і запиши';
  if (item.load === 'one_dumbbell') return formatKg(item.kg) + ' (одна гантель)';
  if (item.load === 'each_dumbbell') return formatKg(item.kg) + ' у кожній руці';
  if (item.load === 'machine') return formatKg(item.kg) + ' на блоці';
  return formatKg(item.kg);
}
/** "8 повторень на кожну сторону" / "30 с" */
export function amountLabel(item) {
  const side = item.sides ? ' на кожну сторону' : '';
  if (item.unit === 'seconds') return `${item.seconds} с${side}`;
  const words = item.words ?? ['повторення', 'повторення', 'повторень'];
  return `${item.reps} ${plural(item.reps, ...words)}${side}`;
}
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}
export function doseLine(item) {
  const parts = [amountLabel(item)];
  if (item.load !== 'bodyweight' || item.kg != null) parts.push(loadLabel(item));
  if (item.tempo) parts.push(item.tempo);
  return parts.join(' · ');
}
export function blockLine(block) {
  if (block.format === 'sequence') {
    return block.rounds > 1 ? `${block.rounds} кола підряд, без окремого відпочинку` : 'По черзі, без окремого відпочинку';
  }
  if (block.items?.length === 1) {
    return `${block.rounds} ${plural(block.rounds, 'підхід', 'підходи', 'підходів')} · відпочинок між підходами ${block.rest} с`;
  }
  const rounds = `${block.rounds} ${plural(block.rounds, 'коло', 'кола', 'кіл')}`;
  return `${rounds} · перехід між вправами ${block.transition} с · відпочинок між колами ${block.rest} с`;
}

// --------------------------------------------------------------- building --
/** A plan item carries everything needed to show it and send it to Garmin. */
export function buildItem(tpl, lib) {
  const ex = lib.exercises[tpl.ex];
  if (!ex) throw new Error(`Немає вправи у бібліотеці: ${tpl.ex}`);
  const item = {
    ex: tpl.ex,
    name: ex.name,
    garmin_name: ex.garmin_name,
    garmin: { ...ex.garmin },
    catalog: ex.catalog,
    unit: ex.unit,
    sides: ex.sides,
    load: ex.load,
    scene: ex.scene,
  };
  if (ex.unit === 'seconds') item.seconds = tpl.seconds;
  else item.reps = tpl.reps;
  if (ex.load !== 'bodyweight') item.kg = tpl.kg ?? null;
  if (ex.tempo) item.tempo = ex.tempo;
  if (ex.words) item.words = [...ex.words];
  if (tpl.note) item.note = tpl.note;
  return item;
}

export function sessionMinutes(session, lib) {
  if (session.type === 'cardio') {
    return session.phases.reduce((sum, p) => sum + (p.repeat ? p.repeat * (p.on + p.off) : p.minutes), 0);
  }
  if (session.type === 'native') return lib.native[session.native]?.minutes ?? 10;
  let seconds = 0;
  for (const block of session.blocks) {
    let round = 0;
    for (const item of block.items) {
      const sides = item.sides ? 2 : 1;
      const work = item.unit === 'seconds' ? item.seconds : item.reps * (item.tempo ? 6 : 3.5);
      round += work * sides + (block.format === 'circuit' ? block.transition : 8);
    }
    seconds += round * block.rounds + (block.format === 'circuit' ? block.rest * Math.max(0, block.rounds - 1) : 0);
  }
  return Math.round(seconds / 60);
}

// ----------------------------------------------------------- history view --
/** Every main-block prescription in the given plans, newest first. */
export function prescriptions(history) {
  const out = [];
  for (const { plan, log } of history) {
    for (const s of plan.sessions) {
      const result = log?.sessions?.[s.id] ?? null;
      if (s.type === 'cardio') {
        out.push({ kind: 'cardio', key: s.key, session: s, result, block: plan.block, date: s.date });
        continue;
      }
      if (!s.blocks) continue;
      for (const b of s.blocks) {
        if (b.kind !== 'main') continue;
        for (const item of b.items) {
          out.push({ kind: 'item', ex: item.ex, item, blockRounds: b.rounds, session: s, result, block: plan.block, date: s.date });
        }
      }
    }
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** The rating that applies to one exercise in one logged session. */
export function evidence(p) {
  const r = p.result;
  if (!r) return { status: null, rating: null };
  const own = r.items?.[p.ex ?? '']?.rating ?? null;
  return {
    status: r.status,
    rating: r.status === 'skipped' ? null : own ?? r.difficulty ?? null,
    kg: r.items?.[p.ex ?? '']?.kg ?? null,
    minutes: r.minutes ?? null,
    source: own ? 'вправа' : r.difficulty ? 'заняття' : null,
  };
}

export function summarizeWeek(plan, log, lib, today) {
  const sessions = plan.sessions.map((s) => {
    const r = log?.sessions?.[s.id] ?? null;
    const state = r?.status ?? (s.date > today ? 'upcoming' : 'unmarked');
    return { s, r, state, minutes: sessionMinutes(s, lib) };
  });
  const required = sessions.filter((x) => !x.s.optional);
  const count = (state) => required.filter((x) => x.state === state).length;
  const done = count('done'), partial = count('partial'), skipped = count('skipped');
  const unmarked = count('unmarked'), upcoming = count('upcoming');
  const marked = done + partial + skipped;
  const completion = required.length ? Math.round(((done + 0.5 * partial) / required.length) * 100) : 0;
  const hard = sessions.filter((x) => x.r && x.r.status !== 'skipped' && x.r.difficulty === 'hard').length;
  const byType = {};
  for (const x of sessions) {
    const t = x.s.type;
    byType[t] ??= { planned: 0, actual: 0 };
    if (!x.s.optional) byType[t].planned += x.minutes;
    if (x.r && x.r.status !== 'skipped') {
      const actual = x.r.minutes ?? (x.r.status === 'partial' ? Math.round(x.minutes / 2) : x.minutes);
      byType[t].actual += actual;
    }
  }
  const optionalDone = sessions.filter((x) => x.s.optional && x.r?.status === 'done').length;
  const notes = sessions.filter((x) => x.r?.note).map((x) => ({ date: x.s.date, title: x.s.title, note: x.r.note }));
  return { sessions, required: required.length, done, partial, skipped, unmarked, upcoming, marked, completion, hard, byType, optionalDone, notes };
}

/**
 * Whole-week guard. Progression needs evidence: at least 60 % completion and
 * not more than one session rated "hard". Otherwise doses are held.
 */
export function weekMode(summary) {
  if (!summary) return { mode: 'new', reason: 'Попереднього тижня в журналі немає.' };
  if (summary.marked === 0) return { mode: 'hold', reason: 'Попередній тиждень не відмічено — без даних дозування не змінюється.' };
  if (summary.completion < 60) return { mode: 'hold', reason: `Виконано ${summary.completion} % занять тижня (потрібно ≥ 60 %) — повторюємо дозування.` };
  if (summary.hard >= 2) return { mode: 'hold', reason: `${summary.hard} заняття з оцінкою «Важко» — даємо тілу адаптуватися.` };
  return { mode: 'progress', reason: `Виконано ${summary.completion} %, «Важко» — ${summary.hard}. Можна прогресувати.` };
}

// ------------------------------------------------------------ progression --
/** Dumbbells that exist in the gym, lightest first. */
export function dumbbellWeights(lib) {
  const d = lib.dumbbell ?? {};
  if (d.weights?.length) return [...d.weights].sort((a, b) => a - b);
  const out = [];
  for (let w = d.min_kg; w <= (d.max_kg ?? 40) + 1e-9; w += d.step_kg) out.push(Math.round(w * 100) / 100);
  return out;
}
/** The next heavier (dir > 0) or lighter dumbbell; stays put at either end of the rack. */
export function nextDumbbell(kg, lib, dir = 1) {
  const ws = dumbbellWeights(lib);
  if (dir > 0) return ws.find((w) => w > kg + 1e-9) ?? ws.at(-1);
  return [...ws].reverse().find((w) => w < kg - 1e-9) ?? ws[0];
}
const isDumbbell = (ex) => ex.load === 'one_dumbbell' || ex.load === 'each_dumbbell';
const kgText = (v) => String(Math.round(v * 100) / 100).replace('.', ',');

function clampKg(kg, ex, lib) {
  if (kg == null) return kg;
  if (ex.load === 'one_dumbbell' || ex.load === 'each_dumbbell') return Math.max(lib.dumbbell.min_kg, kg);
  return Math.max(0, kg);
}

/**
 * One exercise, one decision. Returns { dose, why, ex } where `dose` holds
 * reps/seconds/kg and `ex` may switch to the harder variation.
 * Rules (shown to the user in Settings → Rules):
 *   easy  → +2 steps; right → +1 step; hard → hold; hard twice → −1 step.
 *   Over the top of the range: +load step (weights) or the next variation.
 *   Partial/skipped/unknown → hold. Weekly guard can hold everything.
 */
export function progressExercise({ exId, dose, lib, ev, hardStreak, mode }) {
  const ex = lib.exercises[exId];
  const key = ex.unit === 'seconds' ? 'seconds' : 'reps';
  const unitWord = ex.unit === 'seconds' ? 'с' : 'повт.';
  const next = { ...dose };
  if (mode === 'hold') return { ex: exId, dose: next, why: null };
  if (!ev.rating || ev.status === 'skipped') {
    return { ex: exId, dose: next, why: ev.status === 'skipped' ? 'Пропущено — без змін.' : 'Немає оцінки — без змін.' };
  }
  if (ev.status === 'partial' && ev.rating !== 'easy') {
    return { ex: exId, dose: next, why: 'Заняття виконано частково — без змін.' };
  }
  if (ev.rating === 'hard') {
    if (hardStreak >= 2) {
      if (next[key] - ex.step >= ex.range[0]) {
        next[key] -= ex.step;
        return { ex: exId, dose: next, why: `Двічі поспіль «Важко» — −${ex.step} ${unitWord}.` };
      }
      if (next.kg != null && isDumbbell(ex) && next.kg > lib.dumbbell.min_kg) {
        const lighter = nextDumbbell(next.kg, lib, -1);
        const delta = next.kg - lighter;
        next.kg = lighter;
        return { ex: exId, dose: next, why: `Двічі поспіль «Важко» — легша гантель, −${kgText(delta)} кг.` };
      }
      if (next.kg != null && ex.load_step && !isDumbbell(ex) && next.kg - ex.load_step >= 0) {
        next.kg = next.kg - ex.load_step;
        return { ex: exId, dose: next, why: `Двічі поспіль «Важко» — вага −${String(ex.load_step).replace('.', ',')} кг.` };
      }
      return { ex: exId, dose: next, why: 'Двічі поспіль «Важко», але це вже мінімум — заміни вправу на легшу.' };
    }
    return { ex: exId, dose: next, why: '«Важко» — тримаємо те саме дозування.' };
  }
  const steps = ev.rating === 'easy' ? 2 : 1;
  const target = next[key] + steps * ex.step;
  const label = ev.rating === 'easy' ? '«Легко»' : '«Посильно»';
  if (target <= ex.range[1]) {
    next[key] = target;
    return { ex: exId, dose: next, why: `${label} — +${steps * ex.step} ${unitWord}.` };
  }
  if (next.kg != null && ex.load_step) {
    const before = next.kg;
    next.kg = isDumbbell(ex) ? nextDumbbell(before, lib, 1) : clampKg(before + ex.load_step, ex, lib);
    if (next.kg > before) {
      next[key] = ex.range[0];
      return { ex: exId, dose: next, why: `${label} і досягнуто верхньої межі ${ex.range[1]} — ${isDumbbell(ex) ? 'наступна гантель, ' : 'вага '}+${kgText(next.kg - before)} кг, повторення з ${ex.range[0]}.` };
    }
  }
  if (ex.next) {
    const harder = lib.exercises[ex.next];
    const d = { ...next };
    delete d.reps; delete d.seconds;
    d[harder.unit === 'seconds' ? 'seconds' : 'reps'] = harder.range[0];
    return { ex: ex.next, dose: d, why: `${label} на верхній межі — перехід до складнішого варіанта «${harder.name}».` };
  }
  if (next[key] < ex.range[1]) {
    next[key] = ex.range[1];
    return { ex: exId, dose: next, why: `${label} — до верхньої межі ${ex.range[1]} ${unitWord}.` };
  }
  return { ex: exId, dose: next, why: `${label}, але це верхня межа — далі обери складнішу вправу у «Замінити».` };
}

function hardStreakFor(list) {
  let n = 0;
  for (const p of list) {
    const ev = evidence(p);
    if (!ev.rating) continue;
    if (ev.rating === 'hard') n += 1;
    else break;
  }
  return n;
}

function doseOf(item) {
  const d = {};
  if (item.reps != null) d.reps = item.reps;
  if (item.seconds != null) d.seconds = item.seconds;
  if (item.kg !== undefined) d.kg = item.kg;
  return d;
}

function describeDose(item) {
  return doseLine(item);
}

/**
 * Generate one week from a block template and history.
 *   history: [{plan, log}] of earlier weeks (any order).
 *   profile.swaps: {fromEx: toEx} chosen by the user.
 * Returns { plan, changes, mode }.
 */
export function generateWeek({ block, lib, meta, week, history, profile = {}, recovery = null }) {
  const start = weekStartForCycleWeek(meta, week);
  const all = prescriptions(history.filter((h) => h.plan.week < week));
  const previous = history.find((h) => h.plan.week === week - 1);
  const prevSummary = previous ? summarizeWeek(previous.plan, previous.log, lib, addDays(start, -1)) : null;
  let guard = weekMode(prevSummary);
  // Watch data: a week of poor recovery (resting HR, HRV, sleep) holds progression too.
  if (recovery?.hold && guard.mode === 'progress') guard = { mode: 'hold', reason: recovery.reason };
  const swaps = profile.swaps ?? {};
  const changes = [];
  const sessions = [];
  const weekInBlock = Math.max(0, week - (block.weeks?.[0] ?? week));

  for (const day of block.days) {
    const date = addDays(start, day.dow - 1);
    const base = {
      id: `${date}-${day.key}`, date, slot: day.slot, key: day.key, type: day.type, sport: day.sport,
      title: day.title, optional: !!day.optional,
    };
    if (day.type === 'native') {
      sessions.push({ ...base, native: day.native, fold: day.fold ?? null });
      continue;
    }
    if (day.type === 'cardio') {
      const pick = (v) => (Array.isArray(v) ? v[Math.min(weekInBlock, v.length - 1)] : v);
      const ramped = day.phases.some((p) => Array.isArray(p.minutes) || Array.isArray(p.repeat));
      const phases = day.phases.map((p) => ({ ...p, ...(p.minutes !== undefined ? { minutes: pick(p.minutes) } : {}), ...(p.repeat !== undefined ? { repeat: pick(p.repeat) } : {}) }));
      const last = all.find((p) => p.kind === 'cardio' && p.key === day.key && p.block === block.id);
      const steady = phases.find((p) => p.progress);
      if (ramped) {
        // Planned wave from the block; it only stops growing when the last
        // session of this kind was not done fully or felt hard.
        if (last) {
          const ev = evidence(last);
          const prevTotal = sessionMinutes(last.session, lib);
          const newTotal = sessionMinutes({ type: 'cardio', phases }, lib);
          const ok = guard.mode !== 'hold' && ev.status === 'done' && ev.rating && ev.rating !== 'hard'
            && !(ev.minutes != null && ev.minutes < prevTotal - 1);
          if (newTotal > prevTotal && !ok) {
            last.session.phases.forEach((lp, i) => { if (phases[i]) { if (lp.minutes !== undefined) phases[i].minutes = lp.minutes; if (lp.repeat !== undefined) phases[i].repeat = lp.repeat; } });
            changes.push({ session: day.title, name: day.title, from: `${prevTotal} хв`, to: `${prevTotal} хв`, why: 'Минулого разу не повністю, без оцінки або «Важко» — хвилю не підвищуємо.' });
          } else if (newTotal !== prevTotal) {
            changes.push({ session: day.title, name: day.title, from: `${prevTotal} хв`, to: `${newTotal} хв`, why: newTotal > prevTotal ? 'Хвиля блоку: більше хвилин, бо минулого разу виконано повністю.' : 'Хвиля блоку: розвантажувальний тиждень.' });
          }
        }
        sessions.push({ ...base, activity: day.activity, phases });
        continue;
      }
      if (last && steady) {
        const prevSteady = last.session.phases.find((p) => p.progress);
        steady.minutes = prevSteady.minutes;
        const ev = evidence(last);
        const plannedTotal = sessionMinutes(last.session, lib);
        let add = 0, why;
        if (guard.mode === 'hold') why = null;
        else if (!ev.rating || ev.status !== 'done') why = 'Немає повного виконання з оцінкою — без змін.';
        else if (ev.minutes != null && ev.minutes < plannedTotal - 1) why = `Фактично ${ev.minutes} хв із ${plannedTotal} — без змін.`;
        else if (ev.rating === 'easy') { add = 3; why = '«Легко» — +3 хв рівного темпу.'; }
        else if (ev.rating === 'right') { add = 2; why = '«Посильно» — +2 хв рівного темпу.'; }
        else why = '«Важко» — без змін.';
        steady.minutes = Math.min(steady.minutes + add, 40);
        if (why) changes.push({ session: day.title, name: 'Орбітрек', from: `${plannedTotal} хв`, to: `${sessionMinutes({ type: 'cardio', phases }, lib)} хв`, why });
      }
      sessions.push({ ...base, activity: day.activity, phases });
      continue;
    }
    const blocks = day.blocks.map((b) => {
      const rounds = Array.isArray(b.rounds) ? b.rounds[Math.min(weekInBlock, b.rounds.length - 1)] : b.rounds;
      const items = b.items.map((tpl) => {
        const exId = swaps[tpl.ex] && lib.exercises[swaps[tpl.ex]] ? swaps[tpl.ex] : tpl.ex;
        const swapped = exId !== tpl.ex;
        let item = buildItem({ ...tpl, ex: exId }, lib);
        if (swapped) {
          const ex = lib.exercises[exId];
          const clamp = (v) => Math.min(Math.max(v ?? ex.range[0], ex.range[0]), ex.range[1]);
          if (ex.unit === 'seconds') { item.seconds = clamp(item.seconds); delete item.reps; }
          else { item.reps = clamp(item.reps); delete item.seconds; }
          if (ex.load !== 'bodyweight' && item.kg == null) item.kg = null; // no guess: the first set finds the weight
        }
        if (b.kind !== 'main' || day.optional) return item;
        // Same exercise in different sessions keeps its own dose (e.g. push-ups in A and C).
        const anyKey = all.filter((p) => p.kind === 'item' && p.ex === exId);
        // A bridge week that ran the same sessions counts as this block (block.continues).
        const ownBlock = (id) => id === block.id || (block.continues ?? []).includes(id);
        const sameKey = anyKey.filter((p) => p.session.key === day.key && ownBlock(p.block));
        const mine = sameKey.length ? sameKey : anyKey;
        const last = mine[0];
        if (!last) {
          changes.push({ session: day.title, name: item.name, from: '—', to: describeDose(item), why: swapped ? 'Твоя заміна вправи.' : 'Нова вправа блоку.' });
          return item;
        }
        const ev = evidence(last);
        const sameBlock = ownBlock(last.block);
        if (!sameBlock) {
          // New block: the block's dose is the baseline; keep a real logged weight.
          if (ev.kg != null && item.kg !== undefined) item.kg = clampKg(ev.kg, lib.exercises[exId], lib);
          let why = 'Новий блок: дозування за програмою блоку.';
          if (ev.kg != null && item.kg !== undefined) why += ' Вага — твоя фактична з журналу.';
          if (ev.rating === 'hard') {
            const r = progressExercise({ exId, dose: doseOf(item), lib, ev, hardStreak: 2, mode: 'progress' });
            Object.assign(item, r.dose);
            why += ' Минулого разу «Важко» — на крок легше.';
          }
          changes.push({ session: day.title, name: item.name, from: describeDose(last.item), to: describeDose(item), why });
          return item;
        }
        let dose = doseOf(last.item);
        if (ev.kg != null && dose.kg !== undefined) dose.kg = clampKg(ev.kg, lib.exercises[exId], lib);
        const r = progressExercise({ exId, dose, lib, ev, hardStreak: hardStreakFor(mine), mode: guard.mode });
        if (r.ex !== exId) item = buildItem({ ex: r.ex, ...r.dose }, lib);
        else Object.assign(item, r.dose);
        if (r.why) changes.push({ session: day.title, name: item.name, from: describeDose(last.item), to: describeDose(item), why: r.why });
        return item;
      });
      return { kind: b.kind, title: b.title, format: b.format, rounds, transition: b.transition ?? 0, rest: b.rest ?? 0, items };
    });
    sessions.push({ ...base, blocks });
  }

  for (const s of sessions) s.minutes = sessionMinutes(s, lib);
  const plan = {
    format: 'mygarmin-plan-v2',
    week, start, end: addDays(start, 6), block: block.id, block_title: block.title,
    created_at: new Date().toISOString(),
    guard,
    rationale: history.some((h) => h.plan.block === block.id) ? [] : block.rationale ?? [],
    changes,
    sessions,
  };
  return { plan, changes, mode: guard.mode };
}

// ------------------------------------------------------------ alternatives --
export const DEFAULT_WEIGHTS = { calisthenics: 3, familiarity: 2, preference: 2, level: 2 };
export const CRITERIA = {
  calisthenics: 'Калістеніка',
  familiarity: 'Знайома вправа',
  preference: 'Твоя вподобайка',
  level: 'Близька складність',
};

/**
 * Score alternatives for one exercise. Equipment and exclusions are hard
 * filters; the rest is a transparent weighted sum (0–100) with its parts.
 */
export function alternatives(exId, lib, profile, history) {
  const current = lib.exercises[exId];
  const weights = { ...DEFAULT_WEIGHTS, ...(profile.weights ?? {}) };
  const have = new Set(profile.equipment ?? Object.keys(lib.equipment));
  const excluded = new Set(profile.excluded ?? []);
  const liked = new Set(profile.liked ?? []);
  const counts = {};
  for (const p of prescriptions(history)) if (p.kind === 'item' && p.result && p.result.status !== 'skipped') counts[p.ex] = (counts[p.ex] ?? 0) + 1;
  const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  const out = [];
  for (const [id, ex] of Object.entries(lib.exercises)) {
    if (id === exId || ex.pattern !== current.pattern || ex.catalog !== current.catalog) continue;
    const missing = ex.equipment.filter((e) => !have.has(e));
    if (missing.length || excluded.has(id)) {
      out.push({ id, ex, score: null, blocked: missing.length ? `Немає: ${missing.map((m) => lib.equipment[m] ?? m).join(', ')}` : 'Виключено тобою' });
      continue;
    }
    const parts = {
      calisthenics: ex.calisthenics ? 1 : 0,
      familiarity: Math.min(1, (counts[id] ?? 0) / 4),
      preference: liked.has(id) ? 1 : 0.5,
      level: Math.max(0, 1 - Math.abs(ex.level - current.level) / 3),
    };
    const score = Math.round((Object.entries(parts).reduce((s, [k, v]) => s + v * weights[k], 0) / total) * 100);
    out.push({ id, ex, score, parts, blocked: null });
  }
  return out.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

// ------------------------------------------------------------- week report --
export function weekReport(plan, log, lib, today) {
  const sum = summarizeWeek(plan, log, lib, today);
  const lines = [];
  lines.push(`# Тиждень ${plan.week} · ${plan.start} – ${plan.end}`);
  lines.push(`Виконано ${sum.done}, частково ${sum.partial}, пропущено ${sum.skipped}, не відмічено ${sum.unmarked} з ${sum.required} обов’язкових (${sum.completion} %). Необов’язкових виконано: ${sum.optionalDone}.`);
  for (const [type, m] of Object.entries(sum.byType)) lines.push(`- ${TYPE_NAMES[type] ?? type}: план ${m.planned} хв, факт ${m.actual} хв`);
  lines.push('');
  for (const x of sum.sessions) {
    const r = x.r;
    const status = r ? STATUSES[r.status] : x.state === 'upcoming' ? 'попереду' : 'не відмічено';
    lines.push(`## ${x.s.date} · ${x.s.title}${x.s.optional ? ' (необов’язково)' : ''} — ${status}${r?.difficulty ? ', ' + RATINGS[r.difficulty] : ''}`);
    if (x.s.blocks) {
      for (const b of x.s.blocks) {
        if (b.kind !== 'main') continue;
        for (const it of b.items) {
          const ir = r?.items?.[it.ex];
          const extra = [ir?.rating ? RATINGS[ir.rating] : null, ir?.kg != null ? `факт ${formatKg(ir.kg)}` : null].filter(Boolean).join(', ');
          lines.push(`- ${it.name}: ${b.rounds}× ${doseLine(it)}${extra ? ' — ' + extra : ''}`);
        }
      }
    }
    if (r?.minutes != null) lines.push(`- Фактично ${r.minutes} хв`);
    if (r?.note) lines.push(`- Коментар: ${r.note}`);
  }
  return { text: lines.join('\n'), summary: sum };
}

export const TYPE_NAMES = { strength: 'Сила', cardio: 'Орбітрек', flex: 'Гнучкість', native: 'Готові комплекси Garmin' };
