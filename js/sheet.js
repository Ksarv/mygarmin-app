// One page per session: every task in the order it is done, for a quick reminder
// between sets. Pure data — the app adds the pictures.
import { doseLine, blockLine, plural, formatKg } from './engine.js';

const PHASE = { warmup: 'Розминка', steady: 'Рівний темп', intervals: 'Інтервали', cooldown: 'Заминка' };

/** Short dose for a small card: "8 повт. / бік · по 12,5 кг". The full wording stays in doseLine. */
export function shortDose(item) {
  const side = item.sides ? ' / бік' : '';
  const amount = item.unit === 'seconds' ? `${item.seconds} с`
    : item.words ? `${item.reps} ${plural(item.reps, ...item.words)}` : `${item.reps} повт.`;
  const parts = [amount + side];
  if (item.load !== 'bodyweight' || item.kg != null) {
    if (item.kg == null) parts.push('вагу підбери');
    else parts.push((item.load === 'each_dumbbell' ? 'по ' : '') + formatKg(item.kg));
  }
  return parts.join(' · ');
}

function phaseLine(p) {
  if (p.repeat) return `${p.repeat} × (${p.on} хв + ${p.off} хв)`;
  return `${p.minutes} хв`;
}

/**
 * @returns {{ title: string, minutes: number, hero: string|null, link: string|null,
 *   sections: { title: string, line: string, rounds: number, items: { n: number, ex: string|null,
 *   name: string, dose: string, full?: string, cue: string, scene: string|null }[] }[], count: number }}
 */
export function sheetModel(s, lib) {
  let n = 0;
  const exItem = (id, extra = {}) => {
    const ex = lib.exercises[id];
    return { n: ++n, ex: ex ? id : null, name: ex?.name ?? id, dose: '', cue: ex?.guide?.move ?? '', scene: ex?.scene ?? null, ...extra };
  };
  const textItem = (name, dose = '', cue = '') => ({ n: ++n, ex: null, name, dose, cue, scene: null });
  const sections = [];
  let hero = null;
  let link = null;

  if (s.type === 'native') {
    const nat = lib.native?.[s.native];
    link = nat?.url ?? null;
    sections.push({
      title: nat?.name ?? 'Готовий комплекс Garmin',
      line: `Готовий комплекс Garmin · ≈ ${nat?.minutes ?? s.minutes} хв · анімації в Garmin Connect`,
      rounds: 1,
      items: (nat?.steps ?? []).map((t) => {
        const m = /^(.*?)\s+(\d+\s*×\s*\d+\s*(?:с|хв|повт\.?))$/.exec(t);
        return m ? textItem(m[1], m[2]) : textItem(t);
      }),
    });
  } else if (s.type === 'cardio') {
    if (!s.activity || s.activity === 'elliptical') hero = 'elliptical';
    for (const p of s.phases ?? []) {
      const items = [];
      if (p.repeat && (p.on_ex || p.off_ex)) {
        if (p.on_ex) items.push(exItem(p.on_ex, { dose: `${p.on} хв`, cue: p.on_text ?? '' }));
        if (p.off_ex) items.push(exItem(p.off_ex, { dose: `${p.off} хв`, cue: p.off_text ?? '' }));
      } else if (p.ex) {
        items.push(exItem(p.ex, { dose: phaseLine(p), cue: p.text }));
      } else {
        items.push(textItem(p.text, phaseLine(p)));
      }
      sections.push({ title: PHASE[p.phase] ?? 'Етап', line: phaseLine(p), rounds: p.repeat ?? 1, items });
    }
  } else {
    for (const b of s.blocks ?? []) {
      sections.push({
        title: b.title,
        line: blockLine(b),
        rounds: b.rounds ?? 1,
        items: b.items.map((it) => exItem(it.ex, { name: it.name, dose: shortDose(it), full: doseLine(it), ...(it.note && !lib.exercises[it.ex]?.guide ? { cue: it.note } : {}) })),
      });
    }
  }
  return { title: s.title, minutes: s.minutes, hero, link, sections, count: n };
}

export function countLabel(n) {
  return `${n} ${plural(n, 'завдання', 'завдання', 'завдань')}`;
}
