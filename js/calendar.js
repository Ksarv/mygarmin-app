// A week of the plan as an iCalendar file for the phone calendar. The Fenix 7
// shows phone calendar events in its morning report and mirrors the phone's
// reminders, so this is how the plan reaches the watch every morning.
import { addDays, doseLine } from './engine.js';

export const DEFAULT_TIMES = { AM: '07:30', MID: '12:30', PM: '19:00' };

const pad = (n) => String(n).padStart(2, '0');
/** Floating local time (no zone): the event stays at 19:00 wherever the phone is. */
function stamp(date, time, plusMin = 0) {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + plusMin;
  const day = addDays(date, Math.floor(total / 1440));
  const t = ((total % 1440) + 1440) % 1440;
  return `${day.replaceAll('-', '')}T${pad(Math.floor(t / 60))}${pad(t % 60)}00`;
}
/** RFC 5545 text escaping and 75-octet line folding. */
export function esc(text) {
  return String(text ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
export function fold(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out = [];
  let cur = '', size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; size = 0; }
    cur += ch; size += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function steps(s, lib) {
  if (s.type === 'native') return (lib.native?.[s.native]?.steps ?? []).join('\n');
  if (s.type === 'cardio') return (s.phases ?? []).map((p) => `${p.repeat ? `${p.repeat} × (${p.on} + ${p.off} хв)` : `${p.minutes} хв`} — ${p.text}`).join('\n');
  return (s.blocks ?? []).map((b) => `${b.title}${b.rounds > 1 ? ` (${b.rounds} кола)` : ''}:\n${b.items.map((it) => `• ${it.name} — ${doseLine(it)}`).join('\n')}`).join('\n\n');
}

/**
 * @param plan  one week of the plan
 * @param opt   { times, appUrl, stampNow: 'YYYYMMDDTHHMMSSZ', remind: minutes before, from: first date to include }
 */
export function weekIcs(plan, lib, { times = DEFAULT_TIMES, appUrl = '', stampNow = '20260101T000000Z', remind = 30, from = '' } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MyGarmin//Мій тренер//UK', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:Мій тренер · тиждень ${plan.week}`];
  const event = (uid, start, end, summary, description, url, alarms) => {
    lines.push('BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${stampNow}`, `DTSTART:${start}`, `DTEND:${end}`, `SUMMARY:${esc(summary)}`);
    if (description) lines.push(`DESCRIPTION:${esc(description)}`);
    if (url) lines.push(`URL:${url}`);
    for (const a of alarms) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER:${a.trigger}`, `DESCRIPTION:${esc(a.text)}`, 'END:VALARM');
    lines.push('END:VEVENT');
  };
  const byDay = {};
  for (const s of plan.sessions) if (s.date >= from) (byDay[s.date] ??= []).push(s);
  const order = { AM: 0, MID: 1, PM: 2 };
  for (const [date, list] of Object.entries(byDay)) {
    list.sort((a, b) => (order[a.slot] ?? 3) - (order[b.slot] ?? 3));
    let lastEnd = null;
    for (const s of list) {
      const time = times[s.slot] ?? DEFAULT_TIMES[s.slot] ?? '18:00';
      const minutes = Math.max(10, Math.round(s.minutes ?? 30));
      const link = appUrl ? `${appUrl}#sheet/${encodeURIComponent(s.id)}` : '';
      event(`${s.id}@mygarmin`, stamp(date, time), stamp(date, time, minutes), `${s.optional ? '(за бажанням) ' : ''}${s.title}`,
        `≈ ${minutes} хв. На годиннику: Тренування → Календар.\n\n${steps(s, lib)}${link ? `\n\nАркуш: ${link}` : ''}`, link,
        s.optional ? [] : [{ trigger: `-PT${remind}M`, text: `${s.title} через ${remind} хв` }]);
      if (!s.optional) lastEnd = { at: stamp(date, time, minutes + 10), atEnd: stamp(date, time, minutes + 15), s };
    }
    if (lastEnd) {
      event(`log-${date}@mygarmin`, lastEnd.at, lastEnd.atEnd, 'Відміть заняття в застосунку', 'Оцінки вправ і фактичні ваги — з них правила складуть наступний тиждень.',
        appUrl ? `${appUrl}#s/today` : '', [{ trigger: 'PT0M', text: `Відміть: ${lastEnd.s.title}` }]);
    }
  }
  const sunday = addDays(plan.start, 6);
  if (sunday >= from) event(`plan-${plan.start}@mygarmin`, stamp(sunday, '20:00'), stamp(sunday, '20:15'), `Сформуй тиждень ${plan.week + 1}`,
    'Перевір, що всі заняття тижня відмічені, сформуй наступний тиждень і запиши його в Garmin.', appUrl ? `${appUrl}#next/${plan.week + 1}` : '',
    [{ trigger: 'PT0M', text: `Сформуй тиждень ${plan.week + 1}` }]);
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
