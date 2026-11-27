// Import a week exported from the previous MyGarmin Coach (Codespace app):
// «Тренер → Підготувати звіт для чату» produces `mygarmin-coach-context-v1`.
// Results are attached to the matching sessions; nothing is invented.

import { weekStart, addDays } from './engine.js';

const RATING = new Set(['easy', 'right', 'hard']);

function garminKey(move, catalog) {
  return `${catalog}:${move.garmin_category || move.category}/${move.garmin_exercise_name || move.exerciseName}`;
}

function libraryIndex(lib) {
  const map = {};
  for (const [id, ex] of Object.entries(lib.exercises)) map[`${ex.catalog}:${ex.garmin.category}/${ex.garmin.exercise}`] ??= id;
  return map;
}

function convertItem(move, catalog, index, lib) {
  const id = index[garminKey(move, catalog)] ?? `legacy_${move.key}`;
  const ex = lib.exercises[id];
  const item = {
    ex: id, name: ex?.name ?? move.name, garmin_name: ex?.garmin_name ?? move.name,
    garmin: { category: move.garmin_category || move.category || null, exercise: move.garmin_exercise_name || move.exerciseName || null },
    catalog, unit: move.reps ? 'reps' : 'seconds', sides: !!move.sides,
    load: move.weight_basis && move.weight_basis !== 'bodyweight' ? 'one_dumbbell' : 'bodyweight',
    scene: ex?.scene ?? null,
  };
  if (item.unit === 'reps') item.reps = move.reps; else item.seconds = move.seconds;
  if (item.load !== 'bodyweight') item.kg = move.target_weight_kg ?? null;
  return item;
}

function convertSession(e, key, index, lib) {
  const base = { id: `${e.date}-${key}`, date: e.date, slot: e.slot ?? 'PM', key, optional: !!e.optional };
  if (e.kind === 'CARDIO' && e.aerobic) {
    return { ...base, type: 'cardio', sport: 'cardio', activity: 'elliptical', title: e.title || 'Орбітрек',
      phases: e.aerobic.steps.map((p) => ({ phase: p.phase === 'interval' ? 'steady' : p.phase, minutes: Math.round(p.seconds / 60), text: p.instruction, ...(p.phase === 'interval' ? { progress: true } : {}) })) };
  }
  if (e.source?.type === 'garmin_provider') {
    return { ...base, type: 'native', sport: e.kind === 'PILATES' ? 'pilates' : 'mobility', native: e.source.id, title: e.source.name, fold: null };
  }
  const strength = ['A', 'B', 'C'].includes(e.kind);
  const catalog = strength ? 'strength' : 'yoga';
  const moves = Object.fromEntries((e.moves ?? []).map((m) => [m.key, m]));
  const blocks = [];
  if (e.warmup_steps?.length) blocks.push({ kind: 'warmup', title: 'Розминка', format: 'sequence', rounds: 1, transition: 0, rest: 0, items: e.warmup_steps.map((m) => convertItem(m, catalog, index, lib)) });
  if (e.circuits?.length) {
    for (const c of e.circuits) blocks.push({ kind: 'main', title: c.title, format: 'circuit', rounds: c.rounds, transition: c.transition_seconds ?? 15, rest: c.round_rest_seconds ?? 60, items: c.move_keys.map((k) => convertItem(moves[k], catalog, index, lib)) });
  } else if (e.moves?.length) {
    blocks.push({ kind: 'main', title: 'Основна частина', format: 'circuit', rounds: e.moves[0].sets ?? 1, transition: 15, rest: e.moves[0].rest ?? 60, items: e.moves.map((m) => convertItem(m, catalog, index, lib)) });
  }
  if (e.cooldown_steps?.length) blocks.push({ kind: 'cooldown', title: 'Заминка', format: 'sequence', rounds: 1, transition: 0, rest: 0, items: e.cooldown_steps.map((m) => convertItem(m, catalog, index, lib)) });
  return { ...base, type: strength ? 'strength' : 'flex', sport: strength ? 'strength' : 'yoga', title: e.title || (strength ? `Сила ${e.kind}` : 'Гнучкість'), blocks };
}

function matchSession(plan, log, used) {
  const sameDay = plan.sessions.filter((s) => s.date === log.date && !used.has(s.id));
  const kind = log.kind;
  const pick = sameDay.find((s) => s.key === kind)
    ?? sameDay.find((s) => (kind === 'CARDIO' && s.type === 'cardio') || (kind === 'PILATES' && s.type === 'native') || (['FLEX', 'MOBILITY', 'MORNING'].includes(kind) && s.type === 'flex'))
    ?? (sameDay.length === 1 ? sameDay[0] : null);
  return pick;
}

/**
 * @returns {{plan, log, attached:number, unmatched:string[], createdPlan:boolean}}
 */
export function importLegacy(pkg, lib, existingPlan) {
  if (pkg?.format !== 'mygarmin-coach-context-v1') throw new Error('Це не експорт попереднього застосунку (mygarmin-coach-context-v1).');
  const dates = pkg.plan.map((e) => e.date).sort();
  const start = weekStart(dates[0]);
  const index = libraryIndex(lib);
  let plan = existingPlan;
  const createdPlan = !plan;
  if (!plan) {
    const counter = {};
    const sessions = pkg.plan.map((e) => {
      counter[e.kind] = (counter[e.kind] ?? 0) + 1;
      const key = ['A', 'B', 'C'].includes(e.kind) ? e.kind : `${e.kind[0]}${counter[e.kind]}`;
      return convertSession(e, key, index, lib);
    });
    plan = { format: 'mygarmin-plan-v2', week: pkg.week, start, end: addDays(start, 6), block: 'legacy',
      block_title: 'Перенесено з попереднього застосунку', created_at: new Date().toISOString(),
      guard: { mode: 'imported', reason: 'Перенесено з попереднього застосунку.' }, rationale: [], changes: [], sessions };
  }
  const sessions = {};
  const used = new Set();
  const unmatched = [];
  for (const l of pkg.logs ?? []) {
    const s = matchSession(plan, l, used);
    if (!s) { unmatched.push(`${l.date} ${l.kind}`); continue; }
    used.add(s.id);
    const status = l.completion_status ?? (l.completed === true ? 'done' : l.completed === false ? 'partial' : null);
    if (!status) { unmatched.push(`${l.date} ${l.kind} (без статусу)`); continue; }
    const items = {};
    const old = pkg.plan.find((e) => e.date === l.date && e.kind === l.kind);
    const byOldKey = {};
    for (const m of old?.moves ?? []) {
      const id = index[garminKey(m, ['A', 'B', 'C'].includes(l.kind) ? 'strength' : 'yoga')] ?? `legacy_${m.key}`;
      byOldKey[m.key] = id;
    }
    for (const [k, rating] of Object.entries(l.exercise_ratings ?? {})) if (RATING.has(rating)) (items[byOldKey[k] ?? k] ??= {}).rating = rating;
    for (const x of l.exercises ?? []) if (typeof x.kg === 'number') (items[byOldKey[x.key] ?? x.key] ??= {}).kg = x.kg;
    sessions[s.id] = {
      status, difficulty: RATING.has(l.difficulty) ? l.difficulty : null,
      ...(typeof l.actual_minutes === 'number' ? { minutes: l.actual_minutes } : {}),
      ...(Object.keys(items).length ? { items } : {}),
      ...(l.notes ? { note: String(l.notes).slice(0, 2500) } : {}),
      source: 'legacy', updated_at: l.feedback_updated_at ? `${l.feedback_updated_at}T12:00:00Z` : new Date().toISOString(),
    };
  }
  return { plan, log: { week_start: start, sessions }, attached: Object.keys(sessions).length, unmatched, createdPlan };
}
