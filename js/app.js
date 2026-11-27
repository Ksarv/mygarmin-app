import {
  generateWeek, summarizeWeek, weekMode, alternatives, weekStart, addDays, cycleWeek, weekStartForCycleWeek,
  doseLine, blockLine, buildItem, weekReport, RATINGS, STATUSES, TYPE_NAMES, CRITERIA, DEFAULT_WEIGHTS, formatKg,
} from './engine.js';
import { Store } from './store.js';
import { importLegacy } from './legacy.js';
import {
  barChart, lineChart, miniLine, sparkline, heatmap, legend, tableView, installTooltips, tip, SERIES_COLORS, FAMILY, TYPE_FAMILY, zoneBar, focusBars,
} from './charts.js';
import { sheetModel, countLabel } from './sheet.js';
import { weekIcs, DEFAULT_TIMES } from './calendar.js';
import { parseHeartRate, zoneOf, zoneClock } from './heartrate.js';
import { analyze, familyOf, FAMILY_NAME, THRESH, KEEP, journalRecord } from './pose.js';
import { loadModel, resetModel, processVideo, drawPose, frameAt, snapshot, modelInfo, MP_VERSION } from './posemodel.js';
import { matchWatch, dayMinutes, weekMinutes, movementBalance, weightTable, dailyHealth, kpis, readinessPlus as readiness, recoveryWeekPlus as recoveryWeek, watchConclusionsPlus, LEVEL,
  zoneSetup, loadState, loadFocus, sessionZones, statusName } from './insights.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const main = $('#main');
const store = new Store();
let lib, blocks = {};

const WEEKDAYS = ['Понеділок', 'Вівторок', 'Середа', 'Четвер', 'П’ятниця', 'Субота', 'Неділя'];
const DAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
const SLOT = { AM: 'Ранок', MID: 'Обід', PM: 'Вечір' };
const MONTHS = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
const STATE_LABEL = { done: 'Виконано', partial: 'Частково', skipped: 'Пропущено', unmarked: 'Не відмічено', upcoming: 'Попереду', today: 'Сьогодні' };
const SPORT = { strength: 'Сила', yoga: 'Йога', cardio: 'Кардіо', mobility: 'Рухливість', pilates: 'Пілатес' };

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dow(iso) { return (new Date(iso + 'T12:00:00Z').getUTCDay() + 6) % 7; }
function dayLabel(iso) { const [, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; }
function rangeLabel(start) {
  const end = addDays(start, 6);
  const [, m1, d1] = start.split('-').map(Number), [, m2, d2] = end.split('-').map(Number);
  return m1 === m2 ? `${d1}–${d2} ${MONTHS[m2 - 1]}` : `${d1} ${MONTHS[m1 - 1]} – ${d2} ${MONTHS[m2 - 1]}`;
}

function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 3200);
}

// ------------------------------------------------------------------ data --
async function loadJson(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}
async function blockFor(id) {
  if (!blocks[id]) blocks[id] = await loadJson(`data/blocks/${id}.json`);
  return blocks[id];
}
function allPlans() { return store.plans().filter(Boolean).sort((a, b) => a.week - b.week); }
function history() { return allPlans().map((plan) => ({ plan, log: store.log(plan.start) })); }
function findSession(id) {
  for (const plan of allPlans()) {
    const s = plan.sessions.find((x) => x.id === id);
    if (s) return { plan, s };
  }
  return null;
}
function resultOf(s) { return store.log(weekStart(s.date)).sessions[s.id] ?? null; }
function stateOf(s) {
  const r = resultOf(s);
  if (r) return r.status;
  if (s.date === todayIso()) return 'today';
  return s.date > todayIso() ? 'upcoming' : 'unmarked';
}
function chip(s) {
  if (s.optional && !resultOf(s)) return '<span class="chip opt">Необов’язково</span>';
  const st = stateOf(s);
  return `<span class="chip ${st}">${STATE_LABEL[st]}</span>`;
}
function libEx(id) { return lib.exercises[id] ?? null; }
function metricsOf(start) { return store.get(`garmin/metrics/${start}.json`); }
function metricsAll() { return store.list('garmin/metrics/').sort().map((p) => store.get(p)).filter(Boolean); }
function healthAll() { return dailyHealth(metricsAll()); }
/** Sessions of this week marked done in the journal that the watch did not record. */
function unrecordedThisWeek(today) {
  const plan = store.plan(weekStart(today));
  if (!plan) return 0;
  const w = watchMap(plan), log = store.log(plan.start);
  return plan.sessions.filter((s) => s.date <= today && ['done', 'partial'].includes(log.sessions?.[s.id]?.status) && !w[s.id]).length;
}
function watchMap(plan) { return matchWatch(plan.sessions, metricsOf(plan.start), store.log(plan.start)); }
function watchLine(w) {
  if (!w) return '';
  const sets = (w.exercises ?? []).reduce((a, e) => a + (e.sets || 0), 0);
  return `⌚ ${Math.round(w.minutes)} хв${w.avg_hr ? ` · ${w.avg_hr} уд/хв` : ''}${sets ? ` · ${sets} підх.` : ''}`;
}
function watchSets(e) {
  if (!e) return '';
  const parts = e.reps?.length ? e.reps.join(', ') + ' повт.' : e.seconds?.length ? e.seconds.join(', ') + ' с' : `${e.sets} підх.`;
  return `⌚ ${parts}${e.kg ? ' × ' + formatKg(e.kg) : ''}`;
}
const FAMILY_OF = (s) => FAMILY[TYPE_FAMILY[s.type] ?? 'flex'];
const READY = { good: 'у нормі', caution: 'обережно', low: 'відновлення' };
function readinessCard(rd, today) {
  if (rd.level === 'unknown') return '';
  const when = rd.date === today ? 'сьогодні' : `за ${rd.date.slice(8, 10)}.${rd.date.slice(5, 7)}`;
  return `<div class="card ready ${rd.level}"><div class="row"><b>Готовність ${when}</b><span class="chip level ${rd.level}">${LEVEL[rd.level]} ${READY[rd.level]}</span></div>
    <p style="margin:6px 0">${esc(rd.advice)}</p>
    <ul class="list-plain small">${rd.signals.map((x) => `<li><span class="lvl ${x.level}" aria-hidden="true">${LEVEL[x.level]}</span> ${esc(x.label)}: ${esc(x.text)}</li>`).join('')}</ul>
    ${rd.date < today && store.connected ? '<button class="btn small" type="button" id="refresh-watch">Оновити дані годинника</button>' : ''}
    <p class="small muted" style="margin:6px 0 0">Норма — медіана твоїх попередніх днів. Як рахується: «Ще → Правила прогресії».</p></div>`;
}
function conclusionsCard(today) {
  const list = watchConclusionsPlus({ health: healthAll(), weeks: allPlans().map((p) => ({ metrics: metricsOf(p.start) })), today, unrecorded: unrecordedThisWeek(today) });
  if (!list.length) return '';
  return `<div class="card"><h3>Висновки з даних годинника</h3><ul class="list-plain concl">${list.map((c) =>
    `<li><span class="lvl ${c.level}" aria-hidden="true">${LEVEL[c.level]}</span><div><b>${esc(c.title)}</b><div class="small">${esc(c.text)}</div></div></li>`).join('')}</ul></div>`;
}

/** Week map: slots × days, each session one block — colour = family, fill = status. */
function weekMap(plan) {
  const today = todayIso();
  const watch = watchMap(plan);
  let html = `<div class="wmap" role="table" aria-label="Заняття тижня по днях"><span></span>`;
  for (let i = 0; i < 7; i += 1) html += `<span class="h${addDays(plan.start, i) === today ? ' today' : ''}" role="columnheader">${DAYS_SHORT[i]}</span>`;
  for (const slot of ['AM', 'MID', 'PM']) {
    if (!plan.sessions.some((s) => s.slot === slot)) continue;
    html += `<span class="slot" role="rowheader">${SLOT[slot]}</span>`;
    for (let i = 0; i < 7; i += 1) {
      const date = addDays(plan.start, i);
      const list = plan.sessions.filter((s) => s.date === date && s.slot === slot);
      if (!list.length) { html += '<span class="cell empty" role="cell"></span>'; continue; }
      html += `<span class="cell" role="cell">${list.map((s) => {
        const st = stateOf(s);
        const r = resultOf(s);
        const look = s.optional && !r ? 'upcoming' : st === 'done' ? 'done' : st === 'partial' ? 'partial' : ['skipped', 'unmarked'].includes(st) ? 'missed' : 'upcoming';
        const label = `${WEEKDAYS[i]}, ${SLOT[slot].toLowerCase()}: ${s.title} — ${s.optional && !r ? 'необов’язково' : STATE_LABEL[st]}`;
        const rows = [{ v: s.optional && !r ? 'Необов’язково' : STATE_LABEL[st], label: FAMILY_OF(s).name, color: FAMILY_OF(s).color }];
        if (r?.difficulty) rows.push({ v: RATINGS[r.difficulty], label: 'оцінка' });
        if (watch[s.id]) rows.push({ v: watchLine(watch[s.id]), label: '' });
        return `<a class="blip ${look}${s.optional ? ' optional' : ''}" style="--c:${FAMILY_OF(s).color}" href="#s/${encodeURIComponent(s.id)}" aria-label="${esc(label)}" data-tip="${tip(s.title, rows)}"></a>`;
      }).join('')}</span>`;
    }
  }
  html += '</div>';
  const fams = [...new Set(plan.sessions.map((s) => TYPE_FAMILY[s.type] ?? 'flex'))].map((f) => FAMILY[f]);
  html += `<div class="legend wmap-legend">${fams.map((f) => `<span><i class="blip done" style="--c:${f.color}"></i>${esc(f.name)}</span>`).join('')}</div>
    <div class="legend wmap-legend"><span><i class="blip done" style="--c:var(--muted)"></i>виконано</span><span><i class="blip partial" style="--c:var(--muted)"></i>частково</span><span><i class="blip missed" style="--c:var(--muted)"></i>пропущено</span><span><i class="blip upcoming" style="--c:var(--muted)"></i>попереду</span><span><i class="blip upcoming optional" style="--c:var(--muted)"></i>необов’язково</span></div>`;
  return `<div class="card">${html}</div>`;
}

/** Sets per movement group: whole bar = plan of required sessions, fill = done. */
function balanceCard(plan, log, legacy = false) {
  const groups = movementBalance(plan, log, lib).map((g) => (legacy ? { ...g, planned: 0 } : g));
  if (!groups.length) return '';
  const max = Math.max(...groups.map((g) => Math.max(g.planned, g.done)));
  return `<h2>Баланс рухів</h2><div class="card mbal"><p class="small muted" style="margin:0">${legacy ? 'Підходи, записані в старому застосунку (плану тижня не збереглося).' : 'Підходи основної частини. Смуга — план обов’язкових занять, заливка — виконано.'}</p>
    ${groups.map((g) => {
      const width = Math.round((Math.max(g.planned, g.done) / max) * 100);
      const fill = g.planned ? Math.min(100, Math.round((g.done / Math.max(g.planned, g.done)) * 100)) : 100;
      return `<div class="row"><span>${esc(g.name)}</span><span class="num small">${g.done}${legacy ? '' : ' / ' + g.planned} підх.</span></div><div class="bar" style="width:${width}%" data-tip="${tip(g.name, [{ v: `${g.done} підх.`, label: 'виконано' }, ...(legacy ? [] : [{ v: `${g.planned} підх.`, label: 'план' }])])}"><i style="width:${fill}%"></i></div>`;
    }).join('')}</div>`;
}

// ------------------------------------------------------------------ sync --
let syncTimer = null, syncing = false, lastError = null;
function updateSyncBadge() {
  const b = $('#sync');
  const pending = store.data.dirty.length;
  let state = 'off', label = 'Підключити GitHub ›';
  if (store.connected) {
    if (syncing) { state = 'busy'; label = 'Синхронізація…'; }
    else if (lastError) { state = 'error'; label = 'Помилка синхронізації'; }
    else if (pending) { state = 'pending'; label = `Не надіслано: ${pending}`; }
    else { state = 'ok'; label = 'Збережено в GitHub'; }
  }
  b.dataset.state = state;
  $('.label', b).textContent = label;
}
function message(path) {
  if (path.startsWith('log/')) return `Журнал тижня ${path.slice(4, 14)} (з телефона)`;
  if (path.startsWith('plans/')) return `План тижня ${path.slice(6, 16)} (з телефона)`;
  return `Оновлення ${path} (з телефона)`;
}
async function syncNow(quiet = false) {
  if (!store.connected || syncing) return;
  syncing = true; updateSyncBadge();
  try {
    const r = await store.sync(message);
    lastError = r.failed.length ? r.failed.join('; ') : null;
    if (!quiet || r.pulled.length || r.failed.length) {
      toast(r.failed.length ? `Не вдалося: ${r.failed.length}` : `GitHub: отримано ${r.pulled.length}, надіслано ${r.pushed.length}`);
    }
    if (r.pulled.length) route();
  } catch (e) {
    lastError = e.message;
    if (!quiet) toast(e.message);
  } finally {
    syncing = false; updateSyncBadge();
  }
}
function scheduleSync() {
  updateSyncBadge();
  if (!store.connected) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow(true), 1500);
}

// ----------------------------------------------------------------- views --
function weekNav(start, base) {
  const starts = allPlans().map((p) => p.start);
  const i = starts.indexOf(start);
  const prev = starts[i - 1], next = starts[i + 1];
  const plan = store.plan(start);
  return `<div class="weeknav">
    <a href="#${base}/${prev ?? ''}" aria-label="Попередній тиждень" aria-disabled="${!prev}">‹</a>
    <div class="mid"><b>Тиждень ${plan?.week ?? cycleWeek(store.meta, start)}</b><span class="muted small">${rangeLabel(start)}</span></div>
    <a href="#${base}/${next ?? ''}" aria-label="Наступний тиждень" aria-disabled="${!next}">›</a></div>`;
}

function sessionCard(s) {
  const r = resultOf(s);
  const extra = r?.difficulty ? ` · ${RATINGS[r.difficulty]}` : '';
  const plan = store.plan(weekStart(s.date));
  const w = plan ? watchMap(plan)[s.id] : null;
  return `<a class="card tap" href="#s/${encodeURIComponent(s.id)}">
    <div class="row"><span class="session-title">${esc(s.title)}</span>${chip(s)}</div>
    <div class="meta-line">${SLOT[s.slot] ?? s.slot} · ≈ ${esc(s.minutes ?? '')} хв · Garmin: ${esc(SPORT[s.sport] ?? s.sport)}${esc(extra)}</div>
    ${w ? `<div class="meta-line watch">${esc(watchLine(w))}</div>` : ''}</a>`;
}

function viewToday() {
  const today = todayIso();
  const start = weekStart(today);
  const plan = store.plan(start);
  const week = cycleWeek(store.meta, today);
  let html = `<h1>${WEEKDAYS[dow(today)]}, ${dayLabel(today)}</h1><p class="sub">Тиждень ${week} · ${rangeLabel(start)}</p>`;
  html += readinessCard(readiness(healthAll(), today), today);
  if (!store.connected && (plan || allPlans().length)) {
    html += `<a class="banner tap" href="#settings"><b>Дані поки лише на цьому телефоні.</b><p class="small" style="margin:4px 0 0">Додай токен GitHub, щоб підтягнути історію, дані годинника й надсилати журнал. Натисни тут — відкриється екран для токена.</p></a>`;
  }
  if (!plan && !allPlans().length) {
    html += store.connected
      ? `<div class="banner"><b>Ще немає жодного плану.</b><p>Натисни індикатор синхронізації вгорі, щоб завантажити плани з GitHub.</p></div>`
      : `<div class="banner"><b>Підключи GitHub, щоб завантажити план і журнал.</b><p>Твої дані лежать у приватній гілці <code>data</code>; потрібен токен — один раз.</p><a class="btn primary" href="#settings">Підключити</a></div>`;
    return html;
  }
  if (!plan) {
    const prev = store.plan(addDays(start, -7));
    html += `<div class="banner"><b>Плану на цей тиждень ще немає.</b><p>Його формують правила з результатів попереднього тижня.</p>
      <a class="btn primary" href="#next/${week}">Сформувати тиждень ${week}</a>${prev ? ` <a class="btn ghost" href="#summary/${prev.start}">Підсумок тижня ${prev.week}</a>` : ''}</div>`;
    return html;
  }
  const todays = plan.sessions.filter((s) => s.date === today);
  if (todays.length) {
    const evening = todays.find((s) => s.slot === 'PM');
    for (const s of todays) {
      html += sessionCard(s) + `<a class="sheet-link" href="#sheet/${encodeURIComponent(s.id)}">▦ Аркуш: ${esc(s.title)}</a>`;
      if (s.slot === 'AM' && s.fold && evening && !resultOf(s)) html += `<p class="small muted">⤷ ${esc(s.fold)}</p>`;
    }
  } else {
    html += `<div class="card"><b>Сьогодні відпочинок.</b><p class="muted small">Легка прогулянка або 5 хв рухливості — за бажанням.</p></div>`;
  }
  const missed = plan.sessions.filter((s) => s.date < today && !s.optional && !resultOf(s));
  if (missed.length) {
    html += `<h2>Не відмічено</h2>` + missed.map(sessionCard).join('');
  }
  const next = plan.sessions.find((s) => s.date > today && !s.optional);
  if (next) html += `<h2>Далі</h2><p class="muted small">${WEEKDAYS[dow(next.date)]}, ${dayLabel(next.date)}</p>${sessionCard(next)}`;
  const nextStart = addDays(start, 7);
  if (!store.plan(nextStart)) {
    html += `<div class="banner info"><b>Тиждень ${week + 1} ще не сформовано.</b> ${dow(today) >= 5 ? 'Відміть заняття цього тижня й сформуй наступний.' : 'Можна сформувати вже зараз і записати в Garmin; після відміток цього тижня — перерахувати.'}
      <div class="btns"><a class="btn primary" href="#next/${week + 1}">Сформувати тиждень ${week + 1}</a></div></div>`;
  }
  return html;
}

function viewWeek(start) {
  start ||= weekStart(todayIso());
  const plan = store.plan(start);
  if (!plan) {
    const latest = allPlans().at(-1);
    return `<h1>План тижня</h1><div class="banner">Плану на ${rangeLabel(start)} немає.${latest ? ` Останній — <a href="#week/${latest.start}">тиждень ${latest.week}</a>.` : ''}</div>`;
  }
  let html = weekNav(start, 'week');
  html += `<div class="row" style="margin-top:10px"><p class="sub" style="margin:0">${esc(plan.block_title ?? '')}</p><span class="btns" style="margin:0">${addDays(plan.start, 6) >= todayIso() ? '<button class="btn small" type="button" id="to-calendar">У календар</button>' : ''}${['block1', 'legacy'].includes(plan.block) ? '' : `<a class="btn small" href="#garmin/${plan.start}">Garmin</a>`}</span></div>`;
  if (plan.rationale?.length || plan.changes?.length || plan.summary) {
    html += `<details class="card"><summary>Що змінилося і чому</summary>${plan.summary ? `<p>${esc(plan.summary)}</p>` : ''}
      ${plan.rationale?.length ? plan.rationale.map((r) => `<div class="change"><b>${esc(r.what)}</b><div class="why">${esc(r.why)}</div></div>`).join('') : ''}
      ${plan.changes?.length ? `<h3 style="margin-top:12px">Дозування</h3>${changesList(plan.changes)}` : ''}
      ${plan.guard?.reason ? `<p class="small muted">${esc(plan.guard.reason)}</p>` : ''}</details>`;
  }
  const nextStart = addDays(start, 7);
  if (plan === allPlans().at(-1) && !store.plan(nextStart) && plan.start <= todayIso()) {
    html += `<div class="banner info"><b>Тиждень ${plan.week + 1} (${rangeLabel(nextStart)}) ще не сформовано.</b>
      <p class="small" style="margin:4px 0 0">Його можна сформувати вже зараз і записати в Garmin; якщо потім відмітиш цей тиждень — перерахуй, і Garmin оновиться на тих самих тренуваннях.</p>
      <div class="btns"><a class="btn primary" href="#next/${plan.week + 1}">Сформувати тиждень ${plan.week + 1}</a></div></div>`;
  }
  html += weekMap(plan);
  for (let i = 0; i < 7; i += 1) {
    const date = addDays(start, i);
    const sessions = plan.sessions.filter((s) => s.date === date);
    html += `<div class="day ${date === todayIso() ? 'today' : ''}">${WEEKDAYS[i]} <span class="date">${dayLabel(date)}</span></div>`;
    html += sessions.length ? sessions.map(sessionCard).join('') : '<p class="rest">Відпочинок</p>';
  }
  return html;
}

function calendarTimes() { return { ...DEFAULT_TIMES, ...(store.config.calendar_times ?? {}) }; }
function bindWeek(start) {
  start ||= weekStart(todayIso());
  const plan = store.plan(start);
  $('#to-calendar')?.addEventListener('click', async () => {
    const t = calendarTimes();
    const ok = await confirmSheet(`Тиждень ${plan.week} у календар телефона`, `Кожне заняття від сьогодні стане подією з нагадуванням за 30 хв (ранок ${t.AM}, обід ${t.MID}, вечір ${t.PM} — час змінюється в «Налаштуваннях»), після занять — «Відміть заняття», у неділю о 20:00 — «Сформуй тиждень». Fenix 7 покаже події в ранковому звіті (пункт «Календар»), а нагадування прийдуть на телефон і годинник. Після завантаження відкрий файл і вибери «Календар Samsung». Повторне додавання того самого тижня може створити копії — тоді видали старі події.`, 'Завантажити файл');
    if (!ok) return;
    const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    download(`trener-tyzhden-${plan.week}.ics`, weekIcs(plan, lib, { times: t, appUrl: location.href.split('#')[0], stampNow: now, from: todayIso() }), 'text/calendar');
    toast('Файл календаря завантажено');
  });
}

function changesList(changes) {
  const changed = changes.filter((c) => c.from !== '—');
  const added = changes.filter((c) => c.from === '—');
  let html = changed.map((c) => `<div class="change"><b>${esc(c.name)}</b> <span class="small muted">· ${esc(c.session)}</span>
    <div class="from-to">${esc(c.from)} → ${esc(c.to)}</div><div class="why">${esc(c.why)}</div></div>`).join('');
  if (added.length) {
    html += `<details class="change"><summary><b>Нові вправи: ${added.length}</b></summary><ul class="list-plain">${added.map((c) =>
      `<li><b>${esc(c.name)}</b> <span class="small muted">· ${esc(c.session)}</span><div class="small">${esc(c.to)}</div></li>`).join('')}</ul></details>`;
  }
  return html;
}

function sessionDetails(s) {
  let body = '';
  if (s.type === 'cardio') body = `<ol class="phases">${s.phases.map((p) => `<li>${p.repeat ? `${p.repeat} × (${p.on} + ${p.off} хв)` : `${p.minutes} хв`} — ${esc(p.text)}</li>`).join('')}</ol>`;
  else if (s.type === 'native') body = `<p class="small">Готовий комплекс Garmin: ${esc(lib.native[s.native]?.name ?? s.native)}</p>`;
  else body = s.blocks.map((b) => `<p style="margin:10px 0 2px"><b>${esc(b.title)}</b><br><span class="small muted">${esc(blockLine(b))}</span></p><ul class="phases">${b.items.map((it) => `<li>${esc(it.name)} — <b>${esc(doseLine(it))}</b></li>`).join('')}</ul>`).join('');
  return `<details class="card"><summary><span>${esc(s.title)} <span class="small muted">· ${DAYS_SHORT[dow(s.date)]} · ≈ ${s.minutes} хв${s.optional ? ' · необов’язково' : ''}</span></span></summary>${body}</details>`;
}

function itemHtml(item, block, s, logged, canLog, sets = {}) {
  const ex = libEx(item.ex);
  const w = ex?.garmin ? sets[`${ex.garmin.category}/${ex.garmin.exercise}`] : null;
  const main = block.kind === 'main';
  const r = logged?.items?.[item.ex] ?? {};
  let html = `<div class="ex" data-ex="${esc(item.ex)}">
    <div class="ex-name"><button class="link" type="button" data-guide="${esc(item.ex)}">${esc(item.name)}</button>
    ${main && ex && canLog && s.date >= todayIso() && !logged ? `<button class="btn small ghost" type="button" data-swap="${esc(item.ex)}">Замінити</button>` : ''}</div>
    <div class="dose">${esc(doseLine(item))}</div>
    ${ex?.guide ? `<div class="cue">${esc(ex.guide.move)}</div>` : ''}
    ${item.note ? `<div class="note">${esc(item.note)}</div>` : ''}
    <div class="note">Garmin: ${esc(item.garmin_name)}</div>
    ${w ? `<div class="note watch">${esc(watchSets(w))}</div>` : ''}
    ${ex?.guide ? `<details class="howto" data-howto="${esc(item.ex)}"><summary>Як виконувати: техніка й анімація</summary><div class="howto-body"></div></details>` : ''}`;
  if (main && canLog) {
    html += `<div class="seg" role="radiogroup" aria-label="Оцінка: ${esc(item.name)}">${Object.entries(RATINGS).map(([k, t]) =>
      `<label><input type="radio" name="r-${esc(item.ex)}" value="${k}" ${r.rating === k ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>`;
    if (item.load !== 'bodyweight') {
      html += `<label class="kg">Фактична вага, кг <input type="number" inputmode="decimal" min="0" max="200" step="0.5" data-kg="${esc(item.ex)}" value="${r.kg ?? ''}" placeholder="${item.kg ?? ''}"></label>`;
    }
  }
  return html + '</div>';
}

/** Pulse ranges from the watch's own zones for the cardio parts of a session. */
function hrRanges(s) {
  const z = zoneSetup(metricsAll());
  if (!z) return '';
  const rows = [`<li>Розмовний темп ≈ зона 2: <b class="hr-range">${z.z2[0]}–${z.z2[1]} уд/хв</b></li>`];
  if (s.phases?.some((p) => p.repeat)) rows.push(`<li>Швидкий відрізок ≈ зона 3–4: <b class="hr-range">${z.z3[0]}–${z.z4[1] ?? z.z4[0]} уд/хв</b> (пульс доганяє за 30–60 с)</li>`);
  return `<ul class="list-plain small" style="margin:6px 0 0">${rows.join('')}</ul><p class="small muted" style="margin:2px 0 0">Зони з твого Garmin${z.maxHr ? ` (максимум ${z.maxHr})` : ''}. Якщо пульс і розмовний тест розходяться — вір розмовному тесту.</p>`;
}

function viewSession(id) {
  const found = findSession(id);
  if (!found) return `<h1>Заняття не знайдено</h1><p><a href="#week">До плану тижня</a></p>`;
  const { plan, s } = found;
  const logged = resultOf(s);
  const canLog = s.date <= todayIso();
  const watch = watchMap(plan)[s.id];
  const sets = Object.fromEntries((watch?.exercises ?? []).map((e) => [e.garmin, e]));
  let html = `<p class="sub" style="margin:0"><a href="#week/${plan.start}">‹ Тиждень ${plan.week}</a></p>
    <h1>${esc(s.title)}</h1><p class="sub">${WEEKDAYS[dow(s.date)]}, ${dayLabel(s.date)} · ${(SLOT[s.slot] ?? s.slot).toLowerCase()} · ≈ ${esc(s.minutes)} хв · Garmin: ${esc(SPORT[s.sport] ?? s.sport)}${s.optional ? ' · необов’язково' : ''}</p>`;
  html += `<a class="btn sheet-btn" href="#sheet/${encodeURIComponent(s.id)}"><span aria-hidden="true">▦</span> Аркуш заняття: усі вправи на одному екрані</a>`;
  if (watch) {
    const zs = sessionZones(s, watch, zoneSetup(metricsAll()));
    html += `<div class="banner info"><b>${esc(watchLine(watch))}</b><p class="small" style="margin:4px 0 0">Записано годинником${watch.time ? ' о ' + esc(watch.time) : ''}: «${esc(watch.name ?? '')}».${s.type === 'strength' ? ' Підходи з годинника показано біля вправ.' : ''}</p>
      ${zs ? `${zoneBar(zs.minutes, watch.zone_floors ?? [])}<p class="small zone-note"><span class="lvl ${zs.level}" aria-hidden="true">${LEVEL[zs.level]}</span> ${esc(zs.text)} ${esc(zs.te)}</p>` : ''}</div>`;
  }
  if (s.type === 'native') {
    const n = lib.native[s.native];
    html += `<div class="card"><p>Готовий комплекс Garmin — кроки й анімації в оригіналі, без змін.</p>
      <ol class="phases">${(n?.steps ?? []).map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
      ${n?.url ? `<a class="btn" href="${esc(n.url)}" target="_blank" rel="noopener">Відкрити в Garmin Connect</a>` : ''}
      ${s.fold ? `<p class="small muted">${esc(s.fold)}</p>` : ''}</div>`;
  } else if (s.type === 'cardio' && s.activity && s.activity !== 'elliptical') {
    const exs = [...new Set(s.phases.flatMap((p) => [p.ex, p.on_ex, p.off_ex]).filter(Boolean))];
    html += `<div class="card"><ol class="phases">${s.phases.map((p) => `<li><b>${p.repeat ? `${p.repeat} × (${p.on} хв + ${p.off} хв)` : `${p.minutes} хв`}</b> — ${esc(p.text)}</li>`).join('')}</ol>
      <p class="small muted">${esc(s.description ?? 'На Fenix 7 план відкривається в профілі «Кардіо». Орієнтир — розмовний тест.')}</p>${hrRanges(s)}</div>
      ${exs.map((id) => `<div class="card ex" data-ex="${esc(id)}"><div class="ex-name"><b>${esc(libEx(id)?.name ?? id)}</b></div>${libEx(id)?.guide ? `<div class="cue">${esc(libEx(id).guide.move)}</div><details class="howto" data-howto="${esc(id)}"><summary>Як виконувати: техніка й анімація</summary><div class="howto-body"></div></details>` : ''}</div>`).join('')}`;
  } else if (s.type === 'cardio') {
    html += `<div class="card"><ol class="phases">${s.phases.map((p) => `<li><b>${p.repeat ? `${p.repeat} × (${p.on} хв + ${p.off} хв)` : `${p.minutes} хв`}</b> — ${esc(p.text)}</li>`).join('')}</ol>
      <p class="small muted">На Fenix 7 план відкривається в профілі «Кардіо». Головний орієнтир — розмовний тест.</p>${hrRanges(s)}
      <details class="howto" data-cardio="1"><summary>Як виконувати: техніка на орбітреку</summary><div class="howto-body">
        ${globalThis.MyGarminDiagrams?.has('elliptical') ? globalThis.MyGarminDiagrams.svg('elliptical') : ''}
        <ol class="phases"><li><b>Стійка.</b> Стопи повністю на педалях, п’яти не відриваються; коліна над стопами, корпус рівний, погляд уперед.</li>
        <li><b>Рух.</b> Плавне коло ногами, руки легко штовхають і тягнуть рухомі ручки — без опори всією вагою.</li>
        <li><b>Темп.</b> 120–140 кроків за хвилину. Опір — такий, щоб рух був пружним, а не «провалювався».</li>
        <li><b>Інтенсивність.</b> Рівний темп: говориш повними реченнями. Швидкий інтервал: лише кілька слів. Пульс сам покаже годинник.</li></ol>
        <h3>Часті помилки</h3><ul><li>Висіти на нерухомих ручках</li><li>Занадто великий опір у рівному темпі</li></ul></div></details></div>`;
  } else {
    for (const b of s.blocks) {
      html += `<section class="block"><div class="block-head ${b.kind}"><h3>${esc(b.title)}</h3><p>${esc(blockLine(b))}</p></div>
        <div class="card">${b.items.map((it) => itemHtml(it, b, s, logged, canLog, sets)).join('')}</div></section>`;
    }
  }
  if (!canLog) {
    html += `<div class="banner info">Відмітити результат можна в день заняття (${dayLabel(s.date)}).</div>`;
    return html;
  }
  const status = logged?.status ?? 'done';
  html += `<section class="card" id="log-form"><h2 style="margin-top:0">Результат</h2>
    <div class="seg" role="radiogroup" aria-label="Статус">${Object.entries(STATUSES).map(([k, t]) => `<label><input type="radio" name="status" value="${k}" ${status === k ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>
    <p class="small muted" style="margin:12px 0 0">Загальна складність</p>
    <div class="seg" role="radiogroup" aria-label="Складність">${Object.entries(RATINGS).map(([k, t]) => `<label><input type="radio" name="difficulty" value="${k}" ${logged?.difficulty === k ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>
    ${s.type !== 'strength' && s.type !== 'flex' ? `<label class="field">Фактична тривалість, хв <input type="number" inputmode="numeric" min="0" max="240" id="minutes" value="${logged?.minutes ?? ''}" placeholder="${s.minutes}"></label>` : ''}
    <label class="field">Коментар (необов’язково)<textarea id="note" maxlength="2500" placeholder="Що було важко, що змінити">${esc(logged?.note ?? '')}</textarea></label>
    <p class="small muted">Оцінка вправи важливіша за загальну: без неї вправа отримує загальну складність заняття. Без жодної оцінки дозування не змінюється.</p>
    <div class="btns"><button class="btn primary" type="button" id="save">Зберегти</button>${logged ? '<button class="btn ghost" type="button" id="clear">Скинути відмітку</button>' : ''}</div></section>`;
  return html;
}

function bindSession(id) {
  const found = findSession(id);
  if (!found) return;
  const { plan, s } = found;
  $$('[data-guide]').forEach((b) => b.addEventListener('click', () => openGuide(b.dataset.guide, s)));
  bindHowto(main, s);
  $$('[data-swap]').forEach((b) => b.addEventListener('click', () => openSwap(b.dataset.swap, plan, s)));
  const save = $('#save');
  if (!save) return;
  save.addEventListener('click', () => {
    const status = $('input[name=status]:checked')?.value;
    if (!status) { toast('Обери статус'); return; }
    const difficulty = $('input[name=difficulty]:checked')?.value ?? null;
    const items = {};
    for (const el of $$('.ex[data-ex]')) {
      const ex = el.dataset.ex;
      const rating = $(`input[name="r-${CSS.escape(ex)}"]:checked`, el)?.value;
      const kgEl = $(`[data-kg="${CSS.escape(ex)}"]`, el);
      const kg = kgEl && kgEl.value !== '' ? Number(kgEl.value) : null;
      if (rating || kg != null) items[ex] = { ...(rating ? { rating } : {}), ...(kg != null && !Number.isNaN(kg) ? { kg } : {}) };
    }
    const minutesEl = $('#minutes');
    const result = { status, difficulty };
    if (minutesEl && minutesEl.value !== '') result.minutes = Number(minutesEl.value);
    if (Object.keys(items).length) result.items = items;
    const note = $('#note').value.trim();
    if (note) result.note = note;
    store.setResult(plan.start, s.id, result);
    scheduleSync();
    toast('Збережено');
    location.hash = '#week/' + plan.start;
  });
  $('#clear')?.addEventListener('click', () => {
    store.clearResult(plan.start, s.id);
    scheduleSync();
    toast('Відмітку скинуто');
    route();
  });
}

// -------------------------------------------------------- session sheet --
/** Every task of one session in order, as picture cards — a reminder to glance at between sets. */
function viewSheet(id) {
  const found = findSession(id);
  if (!found) return `<h1>Заняття не знайдено</h1><p><a href="#week">До плану тижня</a></p>`;
  const { plan, s } = found;
  const m = sheetModel(s, lib);
  const D = globalThis.MyGarminDiagrams;
  const pic = (scene) => (scene && D?.has(scene) ? D.thumb(scene) : '');
  let html = `<p class="sub noprint" style="margin:0"><a href="#s/${encodeURIComponent(s.id)}">‹ ${esc(s.title)}</a> · <a href="#week/${plan.start}">тиждень ${plan.week}</a></p>
    <h1 class="sheet-h1">${esc(s.title)}</h1>
    <p class="sub">${DAYS_SHORT[dow(s.date)]}, ${dayLabel(s.date)} · ≈ ${esc(s.minutes)} хв · ${countLabel(m.count)} по черзі${s.type === 'native' ? '' : `<span class="noprint"><br>Торкнись картки — анімація й техніка${'wakeLock' in navigator ? '. Екран не згасне, поки аркуш відкритий' : ''}</span>`}</p>`;
  html += hrPanel();
  if (m.hero && pic(m.hero)) html += `<div class="sheet-hero">${pic(m.hero)}</div>`;
  for (const sec of m.sections) {
    html += `<section class="sheet-sec"><div class="sheet-sec-head"><div><h3>${esc(sec.title)}</h3><p>${esc(sec.line)}</p></div>${sec.rounds > 1 ? `<span class="rounds" title="${esc(sec.line)}">↻ ${sec.rounds}</span>` : ''}</div>
      <ol class="sheet-grid">${sec.items.map((it) => {
        const thumb = pic(it.scene);
        const inner = `${thumb ? `<span class="pic">${thumb}<span class="num">${it.n}</span></span>` : `<span class="num">${it.n}</span>`}
          <span class="nm">${esc(it.name)}</span>${it.dose ? `<span class="ds">${esc(it.dose)}</span>` : ''}${it.cue ? `<span class="cu">${esc(it.cue)}</span>` : ''}`;
        return `<li class="sheet-card${thumb ? '' : ' text'}">${it.ex ? `<button type="button" class="sheet-tap" data-guide="${esc(it.ex)}" aria-label="${it.n}. ${esc(it.name)}, ${esc(it.full ?? it.dose)}. Техніка й анімація">${inner}</button>` : `<div class="sheet-tap">${inner}</div>`}</li>`;
      }).join('')}</ol></section>`;
  }
  html += `<div class="btns noprint">${m.link ? `<a class="btn" href="${esc(m.link)}" target="_blank" rel="noopener">Відкрити в Garmin Connect</a>` : ''}
    <a class="btn primary" href="#s/${encodeURIComponent(s.id)}">До заняття й відмітки</a>
    <button class="btn ghost" type="button" id="print-sheet">Друк або PDF</button></div>`;
  return html;
}
function bindSheet(id) {
  const found = findSession(id);
  if (!found) return;
  globalThis.MyGarminDiagrams?.fitThumbs?.(main);
  bindHr();
  $$('[data-guide]').forEach((b) => b.addEventListener('click', () => openGuide(b.dataset.guide, found.s)));
  $('#print-sheet')?.addEventListener('click', () => globalThis.print?.());
}

// ------------------------------------------------------ technique by video --
let tech = null; // { exId, result, frames, aspect, url, video, meta }
const TECH_TARGET = { squat: ['depthGood', 'squat'], lunge: ['kneeGood', 'lunge'], pushup: ['elbowGood', 'pushup'], dip: ['elbowGood', 'dip'], hinge: ['hipGood', 'hinge'], pull: ['hang', 'pull'] };
const FILM_TIP = {
  squat: 'Збоку, телефон на рівні таза, 2–3 м. Видно все тіло від голови до стоп.',
  hinge: 'Строго збоку, на рівні таза: тоді видно кут нахилу й коліна.',
  lunge: 'Збоку, на рівні таза; видно обидві стопи.',
  pushup: 'Збоку, телефон на підлозі або низько, 1,5–2 м; у кадрі від голови до стоп.',
  pull: 'Збоку або під кутом 45°, щоб було видно перекладину, голову й лікті.',
  dip: 'Збоку, на рівні брусів; видно плече й лікоть.',
  hold: 'Збоку, на рівні тіла; у кадрі від голови до стоп.',
  generic: 'Збоку, усе тіло в кадрі з запасом.',
};
function techHistory(exId) {
  return store.list('technique/').map((p) => ({ path: p, rec: store.get(p) })).filter((x) => x.rec && (!exId || x.rec.ex === exId)).sort((a, b) => b.path.localeCompare(a.path));
}
function viewTech(exId) {
  if (!exId) {
    const fams = {};
    for (const [id, ex] of Object.entries(lib.exercises)) {
      const f = familyOf(id, lib);
      if (f === 'generic' && ex.unit === 'seconds') continue;
      (fams[f] ??= []).push({ id, ex });
    }
    const recent = techHistory().slice(0, 5);
    return `<p class="sub" style="margin:0"><a href="#more">‹ Ще</a></p><h1>Розбір техніки</h1>
      <p class="sub">Знімаєш підхід на телефон — модель знаходить суглоби в кожному кадрі, а правила рахують повторення, глибину, темп і лінію тіла. Відео не залишає телефон.</p>
      ${recent.length ? `<h2>Останні розбори</h2>${recent.map((x) => `<a class="card tap" href="#tech/${encodeURIComponent(x.rec.ex)}"><b>${esc(libEx(x.rec.ex)?.name ?? x.rec.ex)}</b><div class="meta-line">${esc(x.rec.date)} · ${x.rec.reps.length} повт. · ${x.rec.checks.filter((c) => c.level === 'good').length} ✓ · ${x.rec.checks.filter((c) => ['caution', 'low'].includes(c.level)).length} !</div></a>`).join('')}` : ''}
      ${['squat', 'hinge', 'lunge', 'pushup', 'pull', 'dip', 'hold', 'generic'].filter((f) => fams[f]).map((f) => `<h2>${esc(FAMILY_NAME[f][0].toUpperCase() + FAMILY_NAME[f].slice(1))}</h2><div class="card"><ul class="list-plain">${fams[f].map(({ id, ex }) => `<li><a href="#tech/${encodeURIComponent(id)}">${esc(ex.name)}</a></li>`).join('')}</ul></div>`).join('')}`;
  }
  const ex = libEx(exId);
  if (!ex) return `<h1>Вправу не знайдено</h1><p><a href="#tech">До списку</a></p>`;
  const fam = familyOf(exId, lib);
  if (tech?.exId !== exId) tech = { exId };
  const hist = techHistory(exId);
  return `<p class="sub" style="margin:0"><a href="#tech">‹ Розбір техніки</a></p><h1>${esc(ex.name)}</h1>
    <p class="sub">Аналіз: ${esc(FAMILY_NAME[fam])}. Відео обробляється на телефоні й нікуди не надсилається.</p>
    <div class="card"><h3>Як зняти</h3><ol class="small" style="margin:6px 0 0;padding-left:20px">
      <li>${esc(FILM_TIP[fam])}</li><li>Телефон нерухомо: на лаві, підвіконні чи штативі. Горизонтально або вертикально — без різниці.</li>
      <li>Добре світло, у кадрі лише ти. Одяг, що не зливається з фоном.</li><li>Один підхід: ${fam === 'hold' ? '20–40 с утримання' : '3–8 повторень'}, на початку й наприкінці 1–2 с постій.</li></ol>
      <div class="btns"><label class="btn primary">🎥 Зняти відео<input type="file" accept="video/*" capture="environment" id="tech-cam" hidden></label>
      <label class="btn">Вибрати з галереї<input type="file" accept="video/*" id="tech-file" hidden></label></div>
      <details class="small"><summary>Як має бути (анімація)</summary>${globalThis.MyGarminDiagrams?.has(ex.scene) ? globalThis.MyGarminDiagrams.svg(ex.scene) : ''}</details></div>
    <div id="tech-run"></div><div id="tech-result"></div>
    ${hist.length ? `<h2>Попередні розбори</h2>${hist.slice(0, 6).map((x, i) => `<button class="card tap" type="button" data-hist="${i}" style="width:100%;text-align:left"><b>${esc(x.rec.date)}</b><div class="meta-line">${x.rec.reps.length} повт. · ${x.rec.checks.filter((c) => c.level !== 'info').map((c) => LEVEL[c.level] + ' ' + c.title.toLowerCase()).join(' · ')}</div></button>`).join('')}` : ''}
    <p class="small muted">Як рахується: модель MediaPipe Pose (Google) знаходить 33 точки тіла; кути, повторення й висновки — прості правила з порогами, які налаштовуємо на твоїх відео.</p>`;
}
function bindTech(exId) {
  if (!exId) return;
  globalThis.MyGarminDiagrams?.mount(main);
  for (const id of ['#tech-cam', '#tech-file']) $(id)?.addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) runTech(exId, f); e.target.value = ''; });
  const hist = techHistory(exId);
  $$('[data-hist]').forEach((b) => b.addEventListener('click', () => {
    const rec = hist[Number(b.dataset.hist)].rec;
    tech = { exId, result: { ...rec, reps: rec.reps }, saved: true, fromHistory: true };
    renderTechResult();
    $('#tech-result').scrollIntoView({ behavior: 'smooth' });
  }));
  if (tech?.result) renderTechResult();
}
async function runTech(exId, file) {
  const box = $('#tech-run');
  const ctrl = new AbortController();
  box.innerHTML = `<div class="card"><b id="tech-status">Готую…</b><div class="bar" style="margin-top:8px"><i id="tech-bar" style="width:0%"></i></div>
    <p class="small muted" style="margin:6px 0 0">Екран не гасне, поки йде аналіз. 30 с відео — приблизно пів хвилини.</p><button class="btn small ghost" type="button" id="tech-stop">Скасувати</button></div>`;
  $('#tech-stop').addEventListener('click', () => ctrl.abort());
  $('#tech-result').innerHTML = '';
  if (tech?.url) URL.revokeObjectURL(tech.url);
  keepAwake(true);
  try {
    const lm = await loadModel((t) => { $('#tech-status').textContent = t; });
    $('#tech-status').textContent = 'Аналізую кадри…';
    const res = await processVideo(file, lm, { signal: ctrl.signal, onProgress: (p, k, n) => {
      if ($('#tech-bar')) $('#tech-bar').style.width = `${Math.round(p * 100)}%`;
      if ($('#tech-status')) $('#tech-status').textContent = `Аналізую кадр ${k} з ${n}…`;
    } });
    const aspect = res.width / res.height;
    const result = analyze(res.frames, exId, lib, { aspect });
    tech = { exId, result, frames: res.frames, aspect, url: res.url, video: res.video, meta: { width: res.width, height: res.height, duration: Math.round(res.duration * 10) / 10, fps: res.fps, model: { ...modelInfo, version: MP_VERSION } }, saved: false };
    box.innerHTML = '';
    renderTechResult();
    makeBottoms();
  } catch (e) {
    resetModel();
    box.innerHTML = `<div class="banner bad"><b>Не вдалося проаналізувати відео.</b><p class="small">${esc(e.message ?? String(e))}</p><p class="small muted">Якщо модель не завантажилась — перевір інтернет (потрібен лише перший раз).</p></div>`;
  } finally {
    keepAwake(location.hash.startsWith('#sheet/'));
  }
}
function techChart(r) {
  const s = r.series;
  const vals = s.v.filter((v) => v != null);
  if (!vals.length) return '';
  const W = 340, H = 150, m = { l: 34, r: 8, t: 10, b: 22 };
  const target = TECH_TARGET[r.family] ? THRESH[TECH_TARGET[r.family][1]][TECH_TARGET[r.family][0]] : null;
  const lo = Math.max(0, Math.floor((Math.min(...vals, target ?? 999) - 10) / 10) * 10), hi = Math.min(185, Math.ceil((Math.max(...vals, target ?? 0) + 5) / 10) * 10);
  const tmax = s.t.at(-1) || 1;
  const x = (t) => m.l + ((W - m.l - m.r) * t) / tmax, y = (v) => H - m.b - ((H - m.t - m.b) * (v - lo)) / (hi - lo);
  let d = '', pen = false;
  s.v.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(s.t[i]).toFixed(1)} ${y(v).toFixed(1)}`; pen = true; });
  const grid = [lo, Math.round((lo + hi) / 2), hi].map((v) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="currentColor" stroke-opacity=".1"/><text x="${m.l - 5}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="currentColor" fill-opacity=".65">${v}°</text>`).join('');
  const tl = target != null ? `<line x1="${m.l}" x2="${W - m.r}" y1="${y(target)}" y2="${y(target)}" stroke="currentColor" stroke-opacity=".45" stroke-dasharray="4 3"/><text x="${W - m.r}" y="${y(target) - 4}" text-anchor="end" font-size="10" fill="currentColor" fill-opacity=".7">ціль ${target}°</text>` : '';
  const dots = (s.bottoms ?? []).map((b) => `<circle cx="${x(b.t)}" cy="${y(b.v)}" r="4" fill="var(--c2)"/><text x="${x(b.t)}" y="${y(b.v) + 14}" text-anchor="middle" font-size="10" fill="currentColor">${b.n}</text>`).join('');
  const xt = [0, tmax / 2, tmax].map((t) => `<text x="${x(t)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="currentColor" fill-opacity=".65">${Math.round(t)} с</text>`).join('');
  return `<div class="card"><h3>${esc(s.label)}</h3><svg viewBox="0 0 ${W} ${H}" class="tech-chart" role="img" aria-label="${esc(s.label)} за часом, точки — нижні точки повторень">${grid}${tl}<path d="${d}" fill="none" stroke="var(--c1)" stroke-width="2" stroke-linejoin="round"/>${dots}${xt}</svg></div>`;
}
function renderTechResult() {
  const el = $('#tech-result');
  if (!el || !tech?.result) return;
  const r = tech.result;
  const q = r.quality ?? {};
  let html = `<h2>Результат${tech.fromHistory ? ` · ${esc(r.date)}` : ''}</h2>`;
  if (q.warnings?.length) html += `<div class="banner info">${q.warnings.map((w) => `<p class="small" style="margin:2px 0">${esc(w)}</p>`).join('')}</div>`;
  html += `<div class="card"><ul class="list-plain concl">${r.checks.map((c) => `<li><span class="lvl ${c.level}" aria-hidden="true">${LEVEL[c.level]}</span><div><b>${esc(c.title)}</b><div class="small">${esc(c.text)}</div></div></li>`).join('')}</ul>
    <p class="small muted" style="margin:8px 0 0">Тіло знайдено в ${q.detectedPct ?? '—'} % кадрів · аналізується ${q.side ?? '—'} сторона${tech.meta?.model?.delegate ? ` · модель: ${tech.meta.model.delegate === 'GPU' ? 'відеокарта' : 'процесор'}` : ''}</p></div>`;
  if (!tech.fromHistory && tech.url) html += `<div class="card tech-player"><div class="tech-stage"><video src="${tech.url}" controls playsinline muted id="tech-video"></video><canvas id="tech-overlay"></canvas></div><p class="small muted" style="margin:6px 0 0">Жовтим — сторона, яку аналізує застосунок. Якщо точки «стрибають» не туди — це помилка моделі: надішли файл для налаштування.</p></div>`;
  html += techChart(r);
  if (r.reps?.length) {
    html += `<div class="card"><h3>Повторення</h3><div class="tbl-wrap"><table class="grid"><thead><tr><th>#</th><th>${{ knee: 'Коліно', kneeMin: 'Переднє коліно', hip: 'Таз', elbow: 'Лікоть' }[r.series.key] ?? 'Кут'}</th><th>Униз</th><th>Угору</th>${r.family === 'squat' || r.family === 'lunge' ? '<th>Корпус</th>' : r.family === 'pushup' ? '<th>Лінія</th>' : ''}</tr></thead><tbody>
      ${r.reps.map((x) => `<tr><td>${x.n}</td><td>${x.depth}°</td><td>${String(x.down).replace('.', ',')} с</td><td>${String(x.up).replace('.', ',')} с</td>${r.family === 'squat' || r.family === 'lunge' ? `<td>${x.trunk ?? '—'}°</td>` : r.family === 'pushup' ? `<td>${x.bodyMin ?? '—'}°</td>` : ''}</tr>`).join('')}</tbody></table></div></div>`;
  }
  if (!tech.fromHistory) html += `<div class="card" id="tech-bottoms"><h3>Нижні точки</h3><div class="tech-shots small muted">Готую кадри…</div></div>`;
  if (r.hold) html += `<div class="card"><b>Утримання: ${String(r.hold.seconds).replace('.', ',')} с</b>${r.hold.line ? ` · лінія тіла ${r.hold.line}°` : ''}</div>`;
  if (!tech.fromHistory) {
    html += `<div class="card"><div class="btns">${tech.saved ? '<span class="chip done">Збережено в журнал</span>' : '<button class="btn primary" type="button" id="tech-save">Зберегти в журнал</button>'}
      <button class="btn" type="button" id="tech-export">Файл для налаштування</button></div>
      <label class="row small" style="margin-top:8px;justify-content:flex-start;gap:8px"><input type="checkbox" id="tech-images"> додати у файл кадри нижніх точок (зображення)</label>
      <p class="small muted" style="margin:6px 0 0">У журнал іде лише результат і кути, без відео. «Файл для налаштування» — точки тіла по кадрах; надішли його Claude в чаті, щоб підлаштувати пороги й перевірити модель.</p></div>`;
  }
  el.innerHTML = html;
  bindTechPlayer();
  $('#tech-save')?.addEventListener('click', saveTech);
  $('#tech-export')?.addEventListener('click', exportTech);
}
function bindTechPlayer() {
  const v = $('#tech-video'), c = $('#tech-overlay');
  if (!v || !c || !tech.frames) return;
  const draw = () => {
    const w = v.clientWidth, h = v.clientHeight;
    if (!w || !h) return;
    if (c.width !== w * devicePixelRatio) { c.width = w * devicePixelRatio; c.height = h * devicePixelRatio; c.style.width = w + 'px'; c.style.height = h + 'px'; }
    const ctx = c.getContext('2d');
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const f = frameAt(tech.frames, v.currentTime);
    const rep = tech.result.reps.find((x) => v.currentTime >= x.start && v.currentTime <= x.end);
    drawPose(ctx, f?.lm, w, h, tech.result.side, rep ? `Повторення ${rep.n}` : '');
  };
  const loop = () => { draw(); if (v.isConnected && 'requestVideoFrameCallback' in v) v.requestVideoFrameCallback(loop); };
  v.addEventListener('loadeddata', draw);
  v.addEventListener('seeked', draw);
  v.addEventListener('timeupdate', draw);
  window.addEventListener('resize', draw);
  if ('requestVideoFrameCallback' in v) v.requestVideoFrameCallback(loop);
}
async function makeBottoms() {
  const box = $('#tech-bottoms .tech-shots');
  if (!box || !tech?.video) return;
  const reps = tech.result.reps.slice(0, 8);
  if (!reps.length) { box.textContent = 'Повторень не знайдено.'; return; }
  tech.shots = [];
  for (const r of reps) {
    try { tech.shots.push({ n: r.n, t: r.bottom, src: await snapshot(tech.video, tech.frames, r.bottom, tech.result.side, { label: `${r.n} · ${r.depth}°` }) }); } catch { /* skip a frame the browser cannot seek */ }
  }
  if ($('#tech-bottoms .tech-shots')) $('#tech-bottoms .tech-shots').innerHTML = tech.shots.map((s) => `<img src="${s.src}" alt="Повторення ${s.n}, нижня точка" loading="lazy">`).join('') || 'Кадри не вдалося зробити.';
}
function saveTech() {
  const now = new Date();
  const date = todayIso();
  const path = `technique/${date}-${tech.exId}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}.json`;
  store.put(path, journalRecord(tech.result, { exId: tech.exId, date, video: tech.meta }));
  scheduleSync();
  tech.saved = true;
  toast('Розбір збережено');
  renderTechResult();
  if (tech.shots) $('#tech-bottoms .tech-shots').innerHTML = tech.shots.map((s) => `<img src="${s.src}" alt="Повторення ${s.n}">`).join('');
}
async function exportTech() {
  const withImages = $('#tech-images')?.checked;
  const out = {
    kind: 'mygarmin-technique', app: await appVersion(), exported_at: new Date().toISOString(), ex: tech.exId, video: tech.meta,
    keep: KEEP, frames: tech.frames.map((f) => ({ t: Math.round(f.t * 1000) / 1000, p: f.lm ? KEEP.map((i) => f.lm[i] ? [f.lm[i][0], f.lm[i][1], f.lm[i][3]] : null) : null })),
    result: journalRecord(tech.result, { exId: tech.exId, date: todayIso(), video: tech.meta }),
    ...(withImages && tech.shots ? { images: tech.shots } : {}),
  };
  download(`tekhnika-${tech.exId}-${todayIso()}.json`, JSON.stringify(out), 'application/json');
  toast('Файл збережено в «Завантаження»');
}

// ------------------------------------------------------- live heart rate --
/** One connection for the whole app; the panel re-attaches when the page is redrawn. */
const hr = { device: null, char: null, bpm: null, zone: 0, contact: null, clock: zoneClock(), state: 'off', error: null };
function hrPanel() {
  const supported = 'bluetooth' in navigator;
  return `<div class="card hr-live noprint" id="hr-live"><div class="row"><b>Пульс з годинника наживо</b>${supported ? '<button class="btn small" type="button" id="hr-btn"></button>' : ''}</div>
    <div class="hr-now" id="hr-now"></div><div id="hr-zones"></div>
    ${supported ? '' : '<p class="small muted" style="margin:4px 0 0">Цей браузер не має Bluetooth. Відкрий застосунок у Chrome на Android.</p>'}
    <details class="small"><summary>Як увімкнути трансляцію на Fenix 7</summary><ol>
      <li>На годиннику: утримуй MENU → <b>Sensors &amp; Accessories → Wrist Heart Rate → Broadcast Heart Rate</b> (або утримуй LIGHT і вибери значок трансляції пульсу в меню керування).</li>
      <li>Щоб пульс ішов і під час запису заняття: у налаштуваннях активності «Сила» чи «Кардіо» увімкни <b>Broadcast Heart Rate</b>.</li>
      <li>Тут натисни «Під’єднати» й вибери свій Fenix. Трансляція швидше розряджає годинник.</li></ol></details></div>`;
}
function renderHr() {
  const btn = $('#hr-btn'), now = $('#hr-now'), zones = $('#hr-zones');
  if (!now) return;
  if (btn) btn.textContent = hr.state === 'on' ? 'Від’єднати' : hr.state === 'connecting' ? 'Під’єднання…' : 'Під’єднати';
  if (hr.state === 'on' && hr.bpm != null) {
    const z = zoneSetup(metricsAll());
    now.innerHTML = `<span class="bpm">${hr.bpm}</span><span class="small">уд/хв</span>${hr.zone ? `<span class="hz"><i style="background:var(--z${hr.zone})"></i>зона ${hr.zone}</span>` : '<span class="hz muted">нижче зони 1</span>'}${hr.contact === false ? '<span class="small muted">годинник не на руці?</span>' : ''}`;
    const mins = hr.clock.secs.slice(1).map((x) => Math.round(x / 60));
    zones.innerHTML = mins.some(Boolean) ? zoneBar(mins, z?.floors ?? []) : '';
  } else {
    now.innerHTML = hr.error ? `<span class="small">${esc(hr.error)}</span>` : hr.state === 'on' ? '<span class="small muted">Чекаю дані…</span>' : '';
    if (hr.state !== 'on') zones.innerHTML = hr.clock.secs.some((x) => x > 59) ? zoneBar(hr.clock.secs.slice(1).map((x) => Math.round(x / 60))) : '';
  }
}
async function hrConnect() {
  hr.error = null; hr.state = 'connecting'; renderHr();
  try {
    hr.device = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
    hr.device.addEventListener('gattserverdisconnected', () => { if (hr.state === 'on') { hr.state = 'off'; hr.error = 'З’єднання втрачено. Перевір, що трансляція на годиннику ще працює.'; renderHr(); } });
    const server = await hr.device.gatt.connect();
    hr.char = await (await server.getPrimaryService('heart_rate')).getCharacteristic('heart_rate_measurement');
    hr.char.addEventListener('characteristicvaluechanged', (e) => {
      const m = parseHeartRate(e.target.value);
      hr.bpm = m.bpm; hr.contact = m.contact;
      hr.zone = zoneOf(m.bpm, zoneSetup(metricsAll())?.floors ?? []);
      hr.clock.add(hr.zone, Date.now());
      renderHr();
    });
    await hr.char.startNotifications();
    hr.state = 'on'; hr.clock.reset();
  } catch (e) {
    hr.state = 'off';
    hr.error = e.name === 'NotFoundError' ? 'Годинник не вибрано або трансляція пульсу вимкнена.' : `Не вдалося під’єднатися: ${e.message}`;
  }
  renderHr();
}
function hrDisconnect() {
  hr.state = 'off'; hr.bpm = null;
  try { hr.device?.gatt?.disconnect(); } catch { /* already gone */ }
  renderHr();
}
function bindHr() {
  $('#hr-btn')?.addEventListener('click', () => (hr.state === 'on' ? hrDisconnect() : hr.state === 'off' ? hrConnect() : null));
  renderHr();
}

// --------------------------------------------------------------- sheets --
function openSheet(html, after) {
  const dlg = $('#sheet');
  $('#sheet-body').innerHTML = html;
  $$('[data-close]', dlg).forEach((b) => b.addEventListener('click', () => dlg.close()));
  if (!dlg.open) dlg.showModal();
  after?.($('#sheet-body'));
}

function guideHtml(exId, item) {
  const ex = libEx(exId);
  const name = ex?.name ?? item?.name ?? exId;
  const scene = ex?.scene ?? item?.scene;
  const g = ex?.guide;
  const prof = store.profile;
  let html = `<div class="sheet-head"><div><h2 style="margin:0">${esc(name)}</h2><p class="small muted" style="margin:2px 0 0">Garmin: ${esc(ex?.garmin_name ?? item?.garmin_name ?? '')}</p></div><button class="close" data-close aria-label="Закрити">×</button></div>`;
  if (item) html += `<p class="dose">${esc(doseLine(item))}</p>`;
  html += guideBody(exId, item);
  if (ex) {
    html += `<p class="small muted">Обладнання: ${ex.equipment.length ? ex.equipment.map((e) => esc(lib.equipment[e] ?? e)).join(', ') : 'не потрібне'} · діапазон ${ex.range[0]}–${ex.range[1]} ${ex.unit === 'seconds' ? 'с' : 'повт.'}</p>
      <div class="btns"><button class="btn small" data-like="${esc(exId)}">${prof.liked?.includes(exId) ? '♥ Подобається' : '♡ Подобається'}</button>
      <button class="btn small ghost" data-exclude="${esc(exId)}">${prof.excluded?.includes(exId) ? 'Знову пропонувати' : 'Не пропонувати в замінах'}</button></div>`;
  }
  return html;
}
/** Animation and full technique for one exercise (sheet, guide page and inline). */
function guideBody(exId, item) {
  const ex = libEx(exId);
  const scene = ex?.scene ?? item?.scene;
  const g = ex?.guide;
  let html = '';
  if (scene && globalThis.MyGarminDiagrams?.has(scene)) html += globalThis.MyGarminDiagrams.svg(scene);
  else html += `<p class="banner info small">Анімації для цього руху в застосунку немає — відкрий вправу в Garmin Connect.</p>`;
  if (g) {
    html += `<p>${esc(g.why)}</p><ol class="phases"><li><b>Підготовка.</b> ${esc(g.setup)}</li><li><b>Рух.</b> ${esc(g.move)}</li>${g.finish ? `<li><b>Завершення.</b> ${esc(g.finish)}</li>` : ''}</ol>`;
    if (ex.tempo || item?.tempo) html += `<p><b>Темп:</b> ${esc(item?.tempo ?? ex.tempo)}</p>`;
    if (g.check?.length) html += `<h3>Перевір себе</h3><ul>${g.check.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
    if (g.mistakes?.length) html += `<h3>Часті помилки</h3><ul>${g.mistakes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
    if (g.easier) html += `<p><b>Легше:</b> ${esc(g.easier)}</p>`;
  } else if (item?.note) html += `<p>${esc(item.note)}</p>`;
  if (ex && ex.unit !== 'seconds' || familyOf(exId, lib) === 'hold') html += `<p><a class="btn small" href="#tech/${encodeURIComponent(exId)}">🎥 Розбір техніки по відео</a></p>`;
  return html;
}
function bindHowto(root, s) {
  for (const d of root.querySelectorAll('details[data-cardio]')) {
    d.addEventListener('toggle', () => { if (d.open && !d.dataset.ready) { globalThis.MyGarminDiagrams?.mount(d); d.dataset.ready = '1'; } });
  }
  for (const d of root.querySelectorAll('details[data-howto]')) {
    d.addEventListener('toggle', () => {
      if (!d.open || d.dataset.ready) return;
      const exId = d.dataset.howto;
      const item = s?.blocks?.flatMap((b) => b.items).find((i) => i.ex === exId);
      const body = d.querySelector('.howto-body');
      body.innerHTML = guideBody(exId, item) + `<button class="btn small ghost" type="button" data-guide="${esc(exId)}">Відкрити окремо · вподобати чи виключити</button>`;
      globalThis.MyGarminDiagrams?.mount(body);
      body.querySelector('[data-guide]')?.addEventListener('click', () => openGuide(exId, s));
      d.dataset.ready = '1';
    });
  }
}
function openGuide(exId, session) {
  const item = session?.blocks?.flatMap((b) => b.items).find((i) => i.ex === exId);
  openSheet(guideHtml(exId, item), (body) => {
    globalThis.MyGarminDiagrams?.mount(body);
    bindPrefs(body, () => openGuide(exId, session));
  });
}
function bindPrefs(body, reopen) {
  $$('[data-like]', body).forEach((b) => b.addEventListener('click', () => togglePref('liked', b.dataset.like, reopen)));
  $$('[data-exclude]', body).forEach((b) => b.addEventListener('click', () => togglePref('excluded', b.dataset.exclude, reopen)));
}
function togglePref(key, exId, reopen) {
  const p = structuredClone(store.profile);
  p[key] = p[key]?.includes(exId) ? p[key].filter((x) => x !== exId) : [...(p[key] ?? []), exId];
  store.setProfile(p);
  scheduleSync();
  reopen();
}

function openSwap(exId, plan, s) {
  const alts = alternatives(exId, lib, store.profile, history());
  const weights = { ...DEFAULT_WEIGHTS, ...(store.profile.weights ?? {}) };
  let html = `<div class="sheet-head"><div><h2 style="margin:0">Замінити: ${esc(libEx(exId).name)}</h2>
    <p class="small muted" style="margin:2px 0 0">Той самий тип руху. Бал 0–100 = зважена сума критеріїв (ваги — у «Налаштуваннях»).</p></div><button class="close" data-close aria-label="Закрити">×</button></div>`;
  html += `<p class="small muted">Ваги: ${Object.entries(CRITERIA).map(([k, t]) => `${esc(t)} ×${weights[k]}`).join(' · ')}</p>`;
  if (!alts.length) html += '<p>Для цього руху в бібліотеці немає замін.</p>';
  for (const a of alts) {
    html += `<div class="alt"><div class="row"><div><b>${esc(a.ex.name)}</b><div class="small muted">${a.ex.calisthenics ? 'Калістеніка' : 'З обладнанням'} · рівень ${a.ex.level}/5</div></div>
      ${a.blocked ? `<span class="chip skipped">${esc(a.blocked)}</span>` : `<span class="score">${a.score}</span>`}</div>
      ${a.parts ? `<div class="parts">${Object.entries(a.parts).map(([k, v]) => `<span>${esc(CRITERIA[k])}: ${Math.round(v * 100)}%</span>`).join('')}</div>` : ''}
      ${a.blocked ? '' : `<div class="btns"><button class="btn small" data-guide-alt="${esc(a.id)}">Як виконувати</button><button class="btn small primary" data-pick="${esc(a.id)}">Обрати</button></div>`}</div>`;
  }
  openSheet(html, (body) => {
    $$('[data-guide-alt]', body).forEach((b) => b.addEventListener('click', () => openSheet(guideHtml(b.dataset.guideAlt) + `<div class="btns"><button class="btn" id="back">‹ До замін</button></div>`, (b2) => {
      globalThis.MyGarminDiagrams?.mount(b2);
      bindPrefs(b2, () => openSwap(exId, plan, s));
      $('#back', b2).addEventListener('click', () => openSwap(exId, plan, s));
    })));
    $$('[data-pick]', body).forEach((b) => b.addEventListener('click', () => applySwap(exId, b.dataset.pick, plan, s)));
  });
}
function applySwap(fromId, toId, plan, s) {
  const profile = structuredClone(store.profile);
  profile.swaps ??= {};
  const origin = Object.keys(profile.swaps).find((k) => profile.swaps[k] === fromId) ?? fromId;
  if (origin === toId) delete profile.swaps[origin]; else profile.swaps[origin] = toId;
  store.setProfile(profile);
  const next = structuredClone(plan);
  const ex = libEx(toId);
  for (const sess of next.sessions) {
    if (sess.date < todayIso() || resultOf(sess) || !sess.blocks) continue;
    for (const b of sess.blocks) {
      b.items = b.items.map((it) => {
        if (it.ex !== fromId || b.kind !== 'main') return it;
        const dose = ex.unit === 'seconds' ? { seconds: Math.min(Math.max(it.seconds ?? ex.range[0], ex.range[0]), ex.range[1]) } : { reps: Math.min(Math.max(it.reps ?? ex.range[0], ex.range[0]), ex.range[1]) };
        return buildItem({ ex: toId, ...dose, kg: ex.load === 'bodyweight' ? undefined : (it.kg ?? null) }, lib);
      });
    }
  }
  next.changes = [...(next.changes ?? []), { session: s.title, name: ex.name, from: libEx(fromId).name, to: ex.name, why: 'Твоя заміна вправи (застосовано до невиконаних занять і наступних тижнів).' }];
  store.setPlan(next);
  scheduleSync();
  $('#sheet').close();
  toast('Заміну застосовано');
  route();
}

// ---------------------------------------------------------------- summary --
function viewSummary(start) {
  start ||= weekStart(todayIso());
  let plan = store.plan(start);
  if (!plan) {
    const prev = allPlans().filter((p) => p.start <= start).at(-1);
    if (!prev) return '<h1>Підсумок</h1><p>Немає планів.</p>';
    start = prev.start; plan = prev;
  }
  const log = store.log(start);
  const sum = summarizeWeek(plan, log, lib, todayIso());
  const guard = weekMode(sum);
  let html = weekNav(start, 'summary');
  html += `<div class="stats" style="margin-top:12px">
    <div class="stat"><span class="small muted">Виконання</span><b>${sum.completion}%</b><div class="bar"><i style="width:${sum.completion}%"></i></div></div>
    <div class="stat"><span class="small muted">Виконано / частково</span><b>${sum.done} / ${sum.partial}</b><span class="small muted">з ${sum.required} обов’язкових</span></div>
    <div class="stat"><span class="small muted">Пропущено / не відмічено</span><b>${sum.skipped} / ${sum.unmarked}</b><span class="small muted">попереду: ${sum.upcoming}</span></div>
    <div class="stat"><span class="small muted">Оцінок «Важко»</span><b>${sum.hard}</b><span class="small muted">необов’язкових: ${sum.optionalDone}</span></div></div>`;
  const rec = recoveryWeek(healthAll(), start);
  if (rec.days.length) {
    const n = (l) => rec.days.filter((d) => d.level === l).length;
    html += `<div class="card ready ${rec.hold ? 'caution' : 'good'}"><b>Відновлення за годинником</b><p class="small" style="margin:4px 0 0">${n('good')} дн. у нормі · ${rec.caution} обережно · ${rec.low} відновлення (з ${rec.days.length}).${rec.hold ? ' ' + esc(rec.reason) : ''}</p></div>`;
  }
  html += `<h2>Тиждень на одному екрані</h2>` + weekMap(plan);
  html += balanceCard(plan, log, plan.block === 'legacy');
  const legacy = plan.block === 'legacy';
  const mins = weekMinutes(plan, log, metricsOf(start), lib);
  html += `<h2>Хвилини: план і факт</h2><div class="card bars"><p class="small muted" style="margin:0">Факт заняття — більше з двох: журнал або годинник; тренування з годинника поза планом теж пораховано.</p>${Object.entries(mins).filter(([, m]) => m.planned || m.actual).map(([f, m]) => {
    const pct = m.planned ? Math.min(100, Math.round((m.actual / m.planned) * 100)) : 100;
    return `<div class="row"><span>${esc(FAMILY[f].name)}</span><span class="num">${m.actual}${legacy ? '' : ' / ' + m.planned} хв</span></div><div class="bar"><i style="width:${pct}%;background:${FAMILY[f].color}"></i></div>`;
  }).join('')}</div>`;
  const watch = watchMap(plan);
  html += `<h2>Заняття</h2><div class="card"><ul class="list-plain">${sum.sessions.map((x) => `<li><div class="row"><a href="#s/${encodeURIComponent(x.s.id)}">${esc(x.s.title)}</a>${chip(x.s)}</div>
    <div class="small muted">${WEEKDAYS[dow(x.s.date)]}${x.r?.difficulty ? ' · ' + RATINGS[x.r.difficulty] : ''}${x.r?.minutes != null ? ` · ${x.r.minutes} хв` : ''}${watch[x.s.id] ? ' · ' + esc(watchLine(watch[x.s.id])) : ''}</div>
    ${x.r?.note ? `<div class="small">${esc(x.r.note)}</div>` : ''}</li>`).join('')}</ul></div>`;
  const ratings = [];
  for (const x of sum.sessions) for (const [ex, r] of Object.entries(x.r?.items ?? {})) ratings.push({ name: libEx(ex)?.name ?? ex, r, date: x.s.date });
  if (ratings.length) {
    html += `<h2>Оцінки вправ і фактичні ваги</h2><div class="card"><ul class="list-plain">${ratings.map((x) => `<li class="row"><span>${esc(x.name)}</span><span class="small">${x.r.rating ? RATINGS[x.r.rating] : ''}${x.r.kg != null ? ' · ' + formatKg(x.r.kg) : ''}</span></li>`).join('')}</ul></div>`;
  }
  html += garminMetricsCard(start);
  html += `<h2>Наступний тиждень</h2><div class="banner ${guard.mode === 'progress' ? 'info' : ''}"><b>${guard.mode === 'progress' ? 'Можна прогресувати' : 'Дозування тримаємо'}</b><p class="small" style="margin:4px 0 0">${esc(guard.reason)}</p>`;
  const nextStart = addDays(start, 7);
  const nextPlan = store.plan(nextStart);
  if (nextPlan) html += `<div class="btns"><a class="btn" href="#week/${nextStart}">План тижня ${nextPlan.week}</a>${Object.keys(store.log(nextStart).sessions).length ? '' : `<a class="btn ghost" href="#next/${plan.week + 1}">Перерахувати</a>`}</div>`;
  else html += `<div class="btns"><a class="btn primary" href="#next/${plan.week + 1}">Сформувати тиждень ${plan.week + 1}</a></div>`;
  html += '</div>';
  html += `<h2>Обмін для аналізу</h2><div class="card"><p class="small muted">Дані тижня вже лежать у гілці <code>data</code> приватного репозиторію (якщо синхронізація ввімкнена). Для чату — короткий звіт:</p>
    <div class="btns"><button class="btn" id="copy-report">Скопіювати звіт</button><button class="btn ghost" id="dl-report">Завантажити .md</button></div></div>`;
  return html;
}
function bindSummary(start) {
  start ||= weekStart(todayIso());
  const plan = store.plan(start) ?? allPlans().filter((p) => p.start <= start).at(-1);
  if (!plan) return;
  const report = () => weekReport(plan, store.log(plan.start), lib, todayIso()).text;
  $('#copy-report')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(report()); toast('Звіт скопійовано'); } catch { toast('Не вдалося скопіювати — скористайся завантаженням'); }
  });
  $('#dl-report')?.addEventListener('click', () => download(`tyzhden-${plan.week}.md`, report(), 'text/markdown'));
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ------------------------------------------------------------ next week --
let pending = null;
async function viewNext(week) {
  week = Number(week);
  const meta = store.meta;
  if (week < meta.block_from_week) return `<h1>Тиждень ${week}</h1><div class="banner">Цей тиждень належить попередній програмі.</div>`;
  const block = await blockFor(meta.block);
  const start = weekStartForCycleWeek(meta, week);
  const existing = store.plan(start);
  if (existing && Object.keys(store.log(start).sessions).length) {
    return `<h1>Тиждень ${week}</h1><div class="banner">Тиждень уже розпочато — виконані заняття не переписуються. <a href="#week/${start}">Відкрити план</a>.</div>`;
  }
  const recovery = recoveryWeek(healthAll(), weekStartForCycleWeek(meta, week - 1));
  const res = generateWeek({ block, lib, meta, week, history: history().filter((h) => h.plan.week < week), profile: store.profile, recovery });
  pending = res.plan;
  const beyond = !block.weeks.includes(week);
  let html = `<p class="sub" style="margin:0"><a href="#summary">‹ Підсумок</a></p><h1>Тиждень ${week} · ${rangeLabel(start)}</h1>
    <p class="sub">${esc(block.title)}${beyond ? ' · блок розрахований на тижні ' + block.weeks[0] + '–' + block.weeks.at(-1) + ', далі варто оновити програму' : ''}</p>
    ${res.plan.rationale.length
      ? `<div class="banner info"><b>Початок нового блоку</b><p class="small" style="margin:4px 0 0">Дози — з програми блоку; твої фактичні ваги й оцінки «Важко» з журналу враховано. ${esc(res.plan.guard.reason)}</p></div>`
      : `<div class="banner ${res.mode === 'progress' ? 'info' : ''}"><b>${res.mode === 'progress' ? 'Прогресія за правилами' : 'Дозування тримаємо'}</b><p class="small" style="margin:4px 0 0">${esc(res.plan.guard.reason)}</p></div>`}`;
  if (res.plan.rationale.length) html += `<h2>Що змінюється і чому</h2><div class="card">${res.plan.rationale.map((r) => `<div class="change"><b>${esc(r.what)}</b><div class="why">${esc(r.why)}</div></div>`).join('')}</div>`;
  html += `<h2>Дозування</h2><div class="card">${res.changes.length ? changesList(res.changes) : '<p class="muted">Без змін дозування.</p>'}</div>`;
  html += `<h2>Заняття тижня</h2><p class="small muted">Розгорни, щоб побачити кожну вправу з дозуванням і вагою.</p>${res.plan.sessions.map(sessionDetails).join('')}`;
  html += `<div class="btns"><button class="btn primary block" id="accept">${existing ? 'Замінити план тижня ' + week : 'Зберегти план тижня ' + week}</button></div>`;
  return html;
}
function bindNext() {
  $('#accept')?.addEventListener('click', () => {
    if (!pending) return;
    store.setPlan(pending);
    scheduleSync();
    toast(`План тижня ${pending.week} збережено — тепер «Записати в Garmin»`);
    location.hash = store.connected ? '#garmin/' + pending.start : '#week/' + pending.start;
  });
}

// --------------------------------------------------------------- progress --
function progressData() {
  const plans = allPlans();
  const weeks = plans.map((plan) => ({ plan, log: store.log(plan.start), metrics: metricsOf(plan.start) }));
  const sums = plans.map((p) => summarizeWeek(p, store.log(p.start), lib, todayIso()));
  const days = dayMinutes(weeks, lib);
  const health = dailyHealth(store.list('garmin/metrics/').map((p) => store.get(p))).filter((d) => d.date <= todayIso());
  return { plans, weeks, sums, days, health, labels: plans.map((p) => `Т${p.week}`) };
}
const shortDate = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

function viewProgress() {
  const plans = allPlans();
  if (!plans.length) return '<h1>Прогрес</h1><p>Ще немає даних.</p>';
  const { weeks, sums, days, health } = progressData();
  const k = kpis(weeks, sums, days, todayIso());
  const today = todayIso();
  const heatWeeks = plans.map((p) => ({
    label: `Т${p.week}`,
    cells: Array.from({ length: 7 }, (_, i) => {
      const date = addDays(p.start, i);
      const d = days[date] ?? { minutes: 0, log: 0, watch: 0, sessions: [] };
      const title = `${DAYS_SHORT[i]}, ${dayLabel(date)}`;
      if (date > today) return { future: true, title };
      const rows = [{ v: `${d.minutes} хв`, label: 'тренувань за день' }];
      if (d.watch) rows.push({ v: `${d.watch} хв`, label: 'за годинником' });
      if (d.log) rows.push({ v: `${d.log} хв`, label: 'за журналом' });
      for (const x of d.sessions) if (x.status || !x.optional) rows.push({ v: x.status ? STATE_LABEL[x.status] : STATE_LABEL.unmarked, label: x.title });
      return { title, minutes: d.minutes, rows, today: date === today };
    }),
  }));
  const weights = weightTable(weeks, lib);
  const last = (key) => health.filter((d) => d[key] != null).at(-1);
  const avg7 = (key) => {
    const v = health.slice(-7).map((d) => d[key]).filter((x) => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const metricCard = (key, name, unit, id, dec = 0) => {
    const l = last(key), a = avg7(key);
    return `<div class="mini-card"><div class="row"><b>${name}</b><span class="small muted num">${l ? `${String(+l[key].toFixed(dec)).replace('.', ',')} ${unit}` : '—'}${a != null ? ` · 7 дн: ${String(+a.toFixed(dec)).replace('.', ',')}` : ''}</span></div><div class="chart mini" id="${id}"><svg></svg></div></div>`;
  };
  let html = `<h1>Прогрес</h1><p class="sub">Журнал телефона, історія старого застосунку й дані годинника — разом. Торкнися стовпчика, клітинки чи точки, щоб побачити числа.</p>
    <div class="stats">
      <div class="stat kpi"><span class="small muted">Тренувань виконано</span><b>${k.sessions}</b><span class="small muted">за ${plans.length} тиж.</span></div>
      <div class="stat kpi"><span class="small muted">Годин тренувань</span><b>${String(k.hours).replace('.', ',')}</b><span class="small muted">журнал і годинник</span></div>
      <div class="stat kpi"><span class="small muted">Днів із тренуванням</span><b>${k.activeDays} / ${k.days}</b><span class="small muted">від початку циклу</span></div>
      <div class="stat kpi"><span class="small muted">Цей тиждень</span><b>${k.thisDone ?? '—'}${k.thisRequired ? ' / ' + k.thisRequired : ''}</b><span class="small muted">обов’язкових виконано</span></div>
    </div>
    ${conclusionsCard(todayIso())}
    <div class="card"><h3>Календар тренувань</h3><p class="small muted" style="margin:2px 0 8px">Хвилини за день — більше з двох: журнал або годинник.</p>${heatmap(heatWeeks, { days: DAYS_SHORT })}</div>
    <div class="card"><h3>Виконання обов’язкових занять</h3><div class="chart" id="c-completion"><svg></svg></div>${plans.some((p) => p.block === 'legacy') ? `<p class="small muted" style="margin:4px 0 0">${plans.filter((p) => p.block === 'legacy').map((p) => 'Т' + p.week).join(', ')} — історія старого застосунку: повного плану не збереглося, тому відсоток не рахуємо.</p>` : ''}<div id="t-completion"></div></div>
    <div class="card"><h3>Хвилини за тиждень (факт)</h3><p class="small muted" style="margin:2px 0 0">Журнал або годинник — що більше; тренування з годинника поза планом теж тут.</p><div class="chart" id="c-minutes"><svg></svg></div><div id="l-minutes"></div><div id="t-minutes"></div></div>
    <div class="card"><h3>Ключові навички власною вагою</h3><p class="small muted" style="margin:2px 0 0">Повторень у підході за планом тижня.</p><div class="chart" id="c-skills"><svg></svg></div><div id="l-skills"></div><div id="t-skills"></div></div>`;
  if (weights.length) {
    html += `<div class="card"><h3>Робочі ваги</h3><div class="legend"><span><i class="line-key" style="border-color:var(--c1)"></i>план по тижнях</span><span><i style="background:var(--c2);border-radius:50%"></i>факт: журнал або годинник</span></div>
      <div class="tbl-wrap"><table class="grid"><thead><tr><th>Вправа й динаміка</th><th>Зараз</th><th>Факт</th></tr></thead><tbody>${weights.map((w) => {
        const fact = w.lastFact ? `${formatKg(w.lastFact.kg)}<div class="small muted">Т${plans[w.lastFact.week].week}, ${esc(w.lastFact.source)}</div>` : '<span class="muted">—</span>';
        const delta = w.delta ? `<div class="small muted">${w.delta > 0 ? '+' : '−'}${formatKg(Math.abs(w.delta))}</div>` : '';
        const tipRows = plans.map((p, i) => ({ v: `${w.plan[i] != null ? formatKg(w.plan[i]) : '—'}${w.fact[i] != null ? ' · факт ' + formatKg(w.fact[i]) : ''}`, label: `Т${p.week}` }));
        return `<tr><td class="name">${esc(w.name)}${w.plan.filter((v, i) => v != null || w.fact[i] != null).length > 1 ? `<div class="spark-cell" tabindex="0" data-tip="${tip(w.name, tipRows)}">${sparkline(w.plan, w.fact, plans.map((p) => `Т${p.week}`))}</div>` : ''}</td><td>${w.now != null ? formatKg(w.now) : '—'}${delta}</td><td>${fact}</td></tr>`;
      }).join('')}</tbody></table></div>
      <p class="small muted">«Зараз» — найважча вага в плані останнього тижня з цією вправою, під нею — зміна від першого плану. Вага на гантелю. Торкнися графіка — значення по тижнях.</p></div>`;
  }
  if (health.length) {
    html += `<div class="card"><h3>Годинник: відновлення</h3><p class="small muted" style="margin:2px 0 6px">Щоденні дані Fenix 7. Кожен графік — своя шкала.</p>
      ${metricCard('resting_hr', 'Пульс спокою', 'уд/хв', 'c-rhr')}${metricCard('hrv_night_ms', 'HRV уночі', 'мс', 'c-hrv')}${metricCard('sleep_hours', 'Сон', 'год', 'c-sleep', 1)}
      ${health.some((d) => d.deep_min != null) ? metricCard('deep_min', 'Глибокий сон', 'хв', 'c-deep') : ''}${health.some((d) => d.resp_night != null) ? metricCard('resp_night', 'Дихання вночі', 'вд/хв', 'c-resp', 1) : ''}
      ${tableView(health.map((d) => shortDate(d.date)), [
        { name: 'Пульс спокою', values: health.map((d) => d.resting_hr ?? null) },
        { name: 'HRV, мс', values: health.map((d) => d.hrv_night_ms ?? null) },
        { name: 'Сон, год', values: health.map((d) => d.sleep_hours ?? null) },
        { name: 'Глибокий, хв', values: health.map((d) => d.deep_min ?? null) },
        { name: 'Дихання', values: health.map((d) => d.resp_night ?? null) },
      ], { head: 'Дата' })}</div>`;
    const ls = loadState(health, today), lf = loadFocus(metricsAll());
    const endurance = metricsAll().map((m) => ({ start: m.start, v: m.week?.endurance?.score })).filter((x) => x.v != null);
    if (ls || lf || endurance.length) {
      const loadDays = health.filter((d) => d.load_ratio != null).length;
      html += `<div class="card"><h3>Годинник: навантаження</h3>
        ${loadDays < 14 && store.connected ? `<p class="small muted" style="margin:4px 0">Нових даних годинника лише за ${loadDays} дн.</p><button class="btn small" type="button" id="pull-history">Підтягнути всю історію з годинника</button>` : ''}
        ${ls ? `<div class="mini-card"><div class="row"><b>Навантаження проти звичного</b><span class="small muted num">${String(ls.ratio).replace('.', ',')}${ls.status ? ` · ${esc(ls.status)}` : ''}</span></div>
          <p class="small muted" style="margin:2px 0 0">Гостре (7 днів) ÷ звичне (4 тижні). Вище 1,5 — ріст занадто швидкий, нижче 0,8 — менше звичного.</p><div class="chart mini" id="c-load"><svg></svg></div></div>` : ''}
        ${lf ? `<div class="mini-card"><div class="row"><b>Фокус навантаження за 4 тижні</b><span class="small muted">${lf.date ? 'на ' + shortDate(lf.date) : ''}</span></div>
          <p class="small muted" style="margin:2px 0 0">Смуга — твоє навантаження, пунктирна рамка — норма Garmin для твого рівня.</p>${focusBars(lf.rows)}</div>` : ''}
        ${endurance.length ? `<div class="mini-card"><div class="row"><b>Endurance Score</b><span class="small muted num">${endurance.at(-1).v}</span></div><p class="small muted" style="margin:2px 0 0">Витривалість з усіх видів занять: VO2 max і навантаження за тижні.${endurance.length > 1 ? '' : ' Графік з’явиться, коли буде кілька тижнів.'}</p>${endurance.length > 1 ? '<div class="chart mini" id="c-endurance"><svg></svg></div>' : ''}</div>` : ''}
      </div>`;
    }
  } else {
    html += `<div class="banner info">Даних годинника ще немає. Їх приносить дія «Отримати дані» в розділі <a href="#garmin">Garmin</a>.</div>`;
  }
  html += `<div class="card"><h3>Оцінки занять</h3><div class="chart" id="c-ratings"><svg></svg></div><div id="l-ratings"></div><div id="t-ratings"></div></div>`;
  return html;
}
function bindProgress() {
  const plans = allPlans();
  if (!plans.length) return;
  $('#pull-history')?.addEventListener('click', (e) => { e.target.disabled = true; e.target.textContent = 'Читаю годинник… 2–4 хв'; runGarmin('history', ''); });
  const { sums, health, labels, weeks } = progressData();
  const completion = [{ name: 'Виконання', values: sums.map((s, i) => (plans[i].block === 'legacy' ? null : s.completion)), color: SERIES_COLORS[0] }];
  barChart($('#c-completion'), { labels, series: completion, yTitle: '%', max: 100, unit: '%' });
  $('#t-completion').innerHTML = tableView(labels, completion, { unit: '%' });
  const fam = ['strength', 'cardio', 'flex'];
  const wm = weeks.map((w) => weekMinutes(w.plan, w.log, w.metrics, lib));
  const mSeries = fam.map((f) => ({ name: FAMILY[f].name, color: FAMILY[f].color, values: wm.map((m) => m[f].actual) }));
  barChart($('#c-minutes'), { labels, series: mSeries, yTitle: 'хв', unit: 'хв' });
  $('#l-minutes').innerHTML = legend(mSeries);
  $('#t-minutes').innerHTML = tableView(labels, mSeries, { unit: 'хв' });
  const maxDose = (p, ids, key) => {
    let v = null;
    for (const s of p.sessions) for (const b of s.blocks ?? []) for (const it of b.items) if (b.kind === 'main' && ids.includes(it.ex) && it[key] != null) v = Math.max(v ?? 0, it[key]);
    return v;
  };
  const skills = [
    { name: 'Підтягування: стрибок + опускання', ids: ['pullup_neg'] },
    { name: 'Підтягування', ids: ['pullup'] },
    { name: 'Віджимання', ids: ['pushup'] },
    { name: 'Бруси', ids: ['dip_neg', 'dip'] },
  ].map((x, i) => ({ name: x.name, values: plans.map((p) => maxDose(p, x.ids, 'reps')), color: SERIES_COLORS[i] })).filter((x) => x.values.some((v) => v != null));
  lineChart($('#c-skills'), { labels, series: skills, yTitle: 'повт.', unit: 'повт.' });
  $('#l-skills').innerHTML = legend(skills);
  $('#t-skills').innerHTML = tableView(labels, skills, { unit: 'повт.' });
  if (health.length) {
    const pts = (key) => health.map((d) => ({ label: shortDate(d.date), title: `${DAYS_SHORT[dow(d.date)]}, ${dayLabel(d.date)}`, value: d[key] ?? null }));
    miniLine($('#c-rhr'), { points: pts('resting_hr'), unit: 'уд/хв', name: 'Пульс спокою' });
    miniLine($('#c-hrv'), { points: pts('hrv_night_ms'), unit: 'мс', name: 'HRV уночі' });
    miniLine($('#c-sleep'), { points: pts('sleep_hours'), unit: 'год', name: 'Сон', decimals: 1 });
    if ($('#c-deep')) miniLine($('#c-deep'), { points: pts('deep_min'), unit: 'хв', name: 'Глибокий сон' });
    if ($('#c-resp')) miniLine($('#c-resp'), { points: pts('resp_night'), unit: 'вд/хв', name: 'Дихання вночі', decimals: 1 });
    if ($('#c-load')) {
      const lp = pts('load_ratio');
      const first = lp.findIndex((p) => p.value != null);
      miniLine($('#c-load'), { points: lp.slice(Math.max(0, first)), unit: '', name: 'Співвідношення', decimals: 1, band: [0.8, 1.3], bandLabel: 'норма 0,8–1,3', lo: 0 });
    }
    if ($('#c-endurance')) {
      const ep = metricsAll().filter((m) => m.week?.endurance?.score != null).map((m) => ({ label: shortDate(m.start), title: `Тиждень від ${dayLabel(m.start)}`, value: m.week.endurance.score }));
      miniLine($('#c-endurance'), { points: ep, unit: '', name: 'Endurance Score' });
    }
  }
  const rs = Object.keys(RATINGS).map((k, i) => ({ name: RATINGS[k], values: plans.map((p) => Object.values(store.log(p.start).sessions).filter((r) => r.difficulty === k).length), color: SERIES_COLORS[i] }));
  barChart($('#c-ratings'), { labels, series: rs, yTitle: 'занять', unit: '' });
  $('#l-ratings').innerHTML = legend(rs);
  $('#t-ratings').innerHTML = tableView(labels, rs);
}

// ------------------------------------------------------------------ more --
function viewMore() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  return `<h1>Ще</h1>
    ${standalone ? '' : `<button class="card tap install" type="button" id="install"><b>📲 Встановити на телефон</b><div class="meta-line">Іконка на головному екрані, відкривається на весь екран</div></button>`}
    <a class="card tap" href="#garmin"><b>Garmin Connect</b><div class="meta-line">Запис тижня на Fenix 7, дані годинника, вхід</div></a>
    <a class="card tap" href="#guide"><b>Довідник вправ</b><div class="meta-line">Анімації, техніка, улюблені й виключені вправи</div></a>
    <a class="card tap" href="#tech"><b>Розбір техніки по відео</b><div class="meta-line">Знімаєш підхід — застосунок рахує повторення, глибину, темп і лінію тіла</div></a>
    <a class="card tap" href="#settings"><b>Налаштування й синхронізація</b><div class="meta-line">GitHub, обладнання, ваги критеріїв, імпорт і експорт</div></a>
    <a class="card tap" href="#rules"><b>Правила прогресії</b><div class="meta-line">Як застосунок змінює дозування без ШІ</div></a>
    <p class="small muted">Версія застосунку: <span id="app-version">…</span> · <button class="link small" type="button" id="check-update">Перевірити оновлення</button></p>`;
}

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
window.addEventListener('appinstalled', () => { installPrompt = null; toast('Застосунок встановлено — шукай «Мій тренер» на головному екрані'); });
function bindMore() {
  appVersion().then((v) => { if ($('#app-version')) $('#app-version').textContent = v ?? 'локальна'; });
  $('#check-update')?.addEventListener('click', async () => {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (!reg) { location.reload(); return; }
    toast('Перевіряю…');
    await reg.update().catch(() => {});
    setTimeout(() => { if (!$('#update-bar')) toast('Встановлено найновішу версію'); }, 2500);
  });
  $('#install')?.addEventListener('click', async () => {
    if (installPrompt) {
      installPrompt.prompt();
      const choice = await installPrompt.userChoice.catch(() => null);
      installPrompt = null;
      if (choice?.outcome === 'accepted') return;
    }
    const ios = /iphone|ipad/i.test(navigator.userAgent);
    const inApp = /FBAN|FBAV|Instagram|Telegram|; wv\)/i.test(navigator.userAgent);
    openSheet(`<div class="sheet-head"><h2 style="margin:0">Встановити на телефон</h2><button class="close" data-close aria-label="Закрити">×</button></div>
      ${inApp ? `<div class="banner"><b>Ти у вбудованому браузері іншого застосунку.</b><p class="small">Тут встановити не можна. Відкрий <b>${esc(location.origin + location.pathname)}</b> у Chrome (або Safari на iPhone).</p></div>` : ''}
      ${ios ? `<ol class="phases"><li>Відкрий сторінку в <b>Safari</b>.</li><li>Натисни <b>Поділитися</b> (квадрат зі стрілкою вгору).</li><li>Вибери <b>«На початковий екран»</b> → <b>«Додати»</b>.</li><li>Відкрий застосунок з іконки й один раз встав токен GitHub — на iPhone встановлений застосунок має окреме сховище.</li></ol>`
      : `<ol class="phases"><li>Відкрий сторінку в <b>Chrome</b>.</li><li>Натисни меню <b>⋮</b> праворуч угорі.</li><li>Вибери <b>«Додати на головний екран»</b> або <b>«Установити додаток»</b> → <b>«Установити»</b>.</li><li>Іконка «Мій тренер» з’явиться на головному екрані. Токен і дані лишаються ті самі.</li></ol>
      <p class="small muted">Samsung Internet: меню <b>≡</b> → «Додати сторінку до» → «Головний екран».</p>`}`);
  });
}
function bindToday() {
  $('#refresh-watch')?.addEventListener('click', (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Оновлюю… (1–2 хв)';
    runGarmin('fetch', weekStart(todayIso()));
  });
}
function viewGuide(exId) {
  if (exId) return `<p class="sub" style="margin:0"><a href="#guide">‹ Довідник</a></p>` + guideHtml(exId).replace('<button class="close" data-close aria-label="Закрити">×</button>', '');
  const used = new Set();
  const plan = store.plan(weekStart(todayIso())) ?? allPlans().at(-1);
  for (const s of plan?.sessions ?? []) for (const b of s.blocks ?? []) for (const it of b.items) used.add(it.ex);
  const entries = Object.entries(lib.exercises).sort((a, b) => (used.has(b[0]) - used.has(a[0])) || a[1].name.localeCompare(b[1].name, 'uk'));
  return `<h1>Довідник вправ</h1><input class="search" id="q" type="search" placeholder="Пошук: тяга, баланс, плечі…" aria-label="Пошук вправи">
    <ul class="list-plain" id="guide-list" style="margin-top:10px">${entries.map(([id, ex]) => `<li data-name="${esc((ex.name + ' ' + ex.garmin_name + ' ' + ex.guide.why).toLowerCase())}"><a href="#guide/${esc(id)}"><b>${esc(ex.name)}</b></a>
      ${used.has(id) ? ' <span class="chip">у плані</span>' : ''}<div class="small muted">${esc(ex.guide.why)}</div></li>`).join('')}</ul>`;
}
function bindGuide(exId) {
  if (exId) { globalThis.MyGarminDiagrams?.mount(main); bindPrefs(main, route); return; }
  $('#q')?.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    for (const li of $$('#guide-list li')) li.hidden = q && !li.dataset.name.includes(q);
  });
}

function viewRules() {
  return `<h1>Правила прогресії</h1><p class="sub">Застосунок не вгадує: кожна зміна має причину, яку видно в плані тижня.</p>
  <div class="card stack">
    <p><b>Оцінка вправи</b> (або загальна оцінка заняття, якщо вправу не оцінено):</p>
    <ul><li>«Легко» → +2 кроки (наприклад, +2 повторення або +10 с);</li><li>«Посильно» → +1 крок;</li><li>«Важко» → без змін; двічі поспіль «Важко» → −1 крок;</li><li>«Частково», «Пропущено» або без оцінки → без змін.</li></ul>
    <p><b>Верхня межа діапазону:</b> для вправ із гантелями — наступна гантель, що є в залі (до 10 кг крок 1 кг, далі 2,5 кг), для блоків — +5 кг; повторення з нижньої межі; для вправ власною вагою — перехід до складнішого варіанта (наприклад, стрибок+опускання → повне підтягування).</p>
    <p><b>Тижневий запобіжник:</b> якщо виконано менше 60 % обов’язкових занять або 2+ заняття оцінено «Важко», весь наступний тиждень повторює дозування.</p>
    <p><b>Орбітрек:</b> «Легко» +3 хв, «Посильно» +2 хв рівного темпу; лише якщо заняття виконано повністю.</p>
    <p><b>Ваги</b> ніколи не опускаються нижче ${formatKg(lib.dumbbell.min_kg)} (найлегша гантель); фактична вага з журналу стає базою наступного тижня.</p>
    <p><b>Годинник:</b> щодня порівнюю пульс спокою, HRV уночі й сон із твоєю нормою (медіана попередніх до 28 днів). Пульс +3 уд/хв або HRV −8 % або сон &lt; 6,5 год — «обережно»; пульс +5, HRV −15 %, сон &lt; 5 год — «відновлення». Дихання вночі +1 вд/хв — «обережно», +2 — «відновлення». Garmin Training Readiness показую поруч, а рахую лише «погану». Якщо за тиждень 2+ дні «відновлення» або 4+ дні з обох, наступний тиждень повторює дозування.</p>
    <p><b>Навантаження проти звичного</b> (з годинника: гостре за 7 днів ÷ звичне за 4 тижні): 0,8–1,3 — норма; вище 1,5 — наступний тиждень повторює дозування. Рахується лише з тренувань, записаних на годиннику.</p>
    <p><b>Пульсові зони заняття:</b> рівне кардіо — ціль більше половини часу в зоні 2, якщо понад 35 % у зоні 3+ — зменшити опір; інтервали — хоча б половина часу швидких відрізків у зоні 3+. Це підказки, дозування від них не змінюється.</p>
    <p><b>Новий блок</b> починається з дозувань блоку, але з твоїми фактичними вагами; минуле «Важко» — на крок легше.</p>
    <p><b>Заміни</b> — лише в межах того самого типу руху; обладнання й виключені вправи — жорсткий фільтр, решта — зважений бал (ваги критеріїв змінюються в «Налаштуваннях»).</p>
  </div>`;
}

function tokenUrl() {
  const q = new URLSearchParams({ name: 'MyGarmin phone', description: 'Телефонний застосунок MyGarmin: журнал і план у гілці data, запуск синхронізації Garmin', target_name: store.config.owner, expires_in: '366', contents: 'write', actions: 'write' });
  return `https://github.com/settings/personal-access-tokens/new?${q}`;
}

function viewSettings() {
  const p = store.profile;
  const cfg = store.config;
  const weights = { ...DEFAULT_WEIGHTS, ...(p.weights ?? {}) };
  return `<h1>Налаштування</h1>
  <h2>Синхронізація з GitHub</h2><div class="card">
    <p class="small">Журнал і плани зберігаються на телефоні й надсилаються в гілку <code>${esc(cfg.branch)}</code> приватного репозиторію <code>${esc(cfg.owner)}/${esc(cfg.repo)}</code>. Токен лишається лише на цьому пристрої.</p>
    <ol class="small"><li><a href="${esc(tokenUrl())}" target="_blank" rel="noopener">Створити токен у GitHub</a> — форма вже заповнена; у «Repository access» вибери <b>Only select repositories → ${esc(cfg.repo)} і ${esc(cfg.repo)}-app</b> (другий — для автоматичної публікації оновлень застосунку) і натисни «Generate token».</li><li>Скопіюй токен і встав нижче.</li></ol>
    <label class="field">Токен GitHub<input id="token" type="password" autocomplete="off" value="${esc(cfg.token)}" placeholder="github_pat_…"></label>
    <div class="btns"><button class="btn primary" id="connect">Перевірити й синхронізувати</button>${cfg.token ? '<button class="btn ghost" id="disconnect">Від’єднати</button>' : ''}</div>
    <p class="small muted" id="conn-status">${store.data.lastSync ? 'Остання синхронізація: ' + esc(new Date(store.data.lastSync).toLocaleString('uk-UA')) : 'Ще не синхронізовано.'} Не надіслано змін: ${store.data.dirty.length}.</p></div>
  <h2>Календар телефона</h2><div class="card">
    <p class="small">Час занять для подій у календарі (кнопка «У календар» на плані тижня). Fenix 7 показує їх у ранковому звіті.</p>
    <div class="times">${[['AM', 'Ранок'], ['MID', 'Обід'], ['PM', 'Вечір']].map(([k, t]) => `<label class="field">${t}<input type="time" data-time="${k}" value="${esc(calendarTimes()[k])}"></label>`).join('')}</div></div>
  <h2>Обладнання</h2><div class="card">${Object.entries(lib.equipment).map(([k, t]) => `<label class="row" style="padding:6px 0"><span>${esc(t)}</span><input type="checkbox" data-eq="${esc(k)}" ${p.equipment?.includes(k) ? 'checked' : ''} style="width:22px;height:22px"></label>`).join('')}
    <p class="small muted">Вимкнене обладнання прибирає вправи із замін.</p></div>
  <h2>Ваги критеріїв для замін</h2><div class="card">${Object.entries(CRITERIA).map(([k, t]) => `<label class="field">${esc(t)}: <b data-wv="${k}">${weights[k]}</b><input type="range" min="0" max="5" step="1" value="${weights[k]}" data-w="${k}"></label>`).join('')}
    <div class="btns"><button class="btn" id="save-prefs">Зберегти</button></div></div>
  <h2>Імпорт і експорт</h2><div class="card">
    <label class="field">Тиждень зі старого застосунку (файл MyGarmin_feedback_W…json з «Тренер → Підготувати звіт для чату»)<input type="file" id="legacy" accept="application/json,.json"></label>
    <label class="field">Резервна копія цього застосунку (JSON)<input type="file" id="bundle" accept="application/json,.json"></label>
    <div class="btns"><button class="btn ghost" id="export">Завантажити резервну копію</button></div></div>
  <p class="small muted">Мій тренер · ${esc(cfg.owner)}/${esc(cfg.repo)}</p>`;
}
function bindSettings() {
  $$('[data-time]').forEach((el) => el.addEventListener('change', () => {
    if (!/^\d{2}:\d{2}$/.test(el.value)) return;
    store.saveConfig({ calendar_times: { ...calendarTimes(), [el.dataset.time]: el.value } });
    toast('Час збережено');
  }));
  $('#connect')?.addEventListener('click', async () => {
    const token = $('#token').value.trim();
    if (!token) { toast('Встав токен'); return; }
    store.saveConfig({ token });
    $('#conn-status').textContent = 'Перевіряю…';
    try {
      const c = await store.checkConnection();
      if (!c.canPush) throw new Error('Токен без права запису (Contents: Read and write).');
      if (!c.branch) throw new Error(`У репозиторії немає гілки «${store.config.branch}».`);
      await syncNow(false);
      $('#conn-status').textContent = 'Підключено. ' + (lastError ? 'Помилка: ' + lastError : 'Синхронізовано.');
    } catch (e) {
      lastError = e.message; updateSyncBadge();
      $('#conn-status').textContent = e.message;
    }
  });
  $('#disconnect')?.addEventListener('click', () => { store.saveConfig({ token: '' }); lastError = null; updateSyncBadge(); route(); });
  $$('[data-eq]').forEach((c) => c.addEventListener('change', () => {
    const p = structuredClone(store.profile);
    p.equipment = $$('[data-eq]').filter((x) => x.checked).map((x) => x.dataset.eq);
    store.setProfile(p); scheduleSync(); toast('Обладнання збережено');
  }));
  $$('[data-w]').forEach((r) => r.addEventListener('input', () => { $(`[data-wv="${r.dataset.w}"]`).textContent = r.value; }));
  $('#save-prefs')?.addEventListener('click', () => {
    const p = structuredClone(store.profile);
    p.weights = Object.fromEntries($$('[data-w]').map((r) => [r.dataset.w, Number(r.value)]));
    store.setProfile(p); scheduleSync(); toast('Ваги критеріїв збережено');
  });
  $('#legacy')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const pkg = JSON.parse(await file.text());
      const dates = (pkg.plan ?? []).map((x) => x.date).sort();
      const existing = dates.length ? store.plan(weekStart(dates[0])) : null;
      const res = importLegacy(pkg, lib, existing);
      if (res.createdPlan) store.setPlan(res.plan);
      const current = store.log(res.plan.start);
      let added = 0;
      for (const [id, r] of Object.entries(res.log.sessions)) {
        if (current.sessions[id] && current.sessions[id].source !== 'legacy') continue; // phone entries win
        store.setResult(res.plan.start, id, r); added += 1;
      }
      scheduleSync();
      toast(`Тиждень ${res.plan.week}: додано результатів ${added}${res.unmatched.length ? `, без пари ${res.unmatched.length}` : ''}`);
    } catch (err) { toast(err.message); }
    e.target.value = '';
  });
  $('#bundle')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const b = JSON.parse(await file.text());
      if (b.format !== 'mygarmin-export-v1') throw new Error('Це не резервна копія застосунку.');
      const n = store.importFiles(b.files);
      scheduleSync(); toast(`Відновлено файлів: ${n}`); route();
    } catch (err) { toast(err.message); }
    e.target.value = '';
  });
  $('#export')?.addEventListener('click', () => download(`mygarmin-${todayIso()}.json`, JSON.stringify(store.exportBundle(), null, 1), 'application/json'));
}


// ---------------------------------------------------------------- garmin --
const GARMIN_ACTIONS = { preview: 'Перевірка', apply: 'Запис у Garmin', fetch: 'Дані Garmin', history: 'Історія з годинника', login: 'Вхід у Garmin' };
const ROW_LABEL = { create: 'Створити', update: 'Оновити (той самий ID)', unchanged: 'Без змін', native_found: 'Готовий комплекс знайдено',
  native_missing: 'Немає в «Мої тренування»', past: 'Минуле — не змінюю', logged: 'Відмічене — не змінюю', retire: 'Більше немає в плані' };
const SCHED_LABEL = { needed: 'запланувати', already: 'вже в календарі', none: '', remove: 'зняти з календаря', keep: 'лишити' };
let garminRun = null;

function garminPlans() { return allPlans().filter((p) => !['block1', 'legacy'].includes(p.block)); }

function viewGarmin(start) {
  const plans = garminPlans();
  const today = todayIso();
  start ||= (plans.find((p) => p.end >= today) ?? plans.at(-1))?.start;
  const plan = start ? store.plan(start) : null;
  const auth = store.get('garmin/auth.json');
  let html = `<h1>Garmin Connect</h1><p class="sub">Запис тренувань на Fenix 7 і читання даних годинника через GitHub Actions. Пароль Garmin зберігається лише в секретах репозиторію.</p>`;
  if (!store.connected) return html + `<div class="banner">Спершу підключи GitHub у <a href="#settings">Налаштуваннях</a>.</div>`;
  html += `<div class="card"><div class="row"><b>Обліковий запис Garmin</b>${auth?.connected ? '<span class="chip done">Підключено</span>' : '<span class="chip unmarked">Не підключено</span>'}</div>
    <p class="small muted">${auth?.saved_at ? 'Токени оновлено: ' + esc(new Date(auth.saved_at).toLocaleString('uk-UA')) : 'Перший вхід: секрети GARMIN_EMAIL і GARMIN_PASSWORD у репозиторії, потім «Увійти». Якщо Garmin надішле код — введи його тут.'}</p>
    <div class="btns"><button class="btn small" data-garmin="login">${auth?.connected ? 'Увійти заново' : 'Увійти в Garmin'}</button></div></div>`;
  if (!plan) {
    const nextWeek = (allPlans().at(-1)?.week ?? cycleWeek(store.meta, today)) + 1;
    return html + `<div class="banner"><b>Тиждень ${nextWeek - 1} уже на годиннику зі старого застосунку.</b>
      <p class="small">Нова програма (блок 2) починається з тижня ${nextWeek}. Сформуй його — і тут з’явиться кнопка «Записати в Garmin».</p>
      <a class="btn primary" href="#next/${nextWeek}">Сформувати тиждень ${nextWeek}</a></div>`;
  }
  const others = plans.map((p) => `<option value="${p.start}" ${p.start === start ? 'selected' : ''}>Тиждень ${p.week} · ${rangeLabel(p.start)}</option>`).join('');
  html += `<h2>Тиждень</h2><label class="field">План<select id="g-week">${others}</select></label>
    <div class="btns"><button class="btn" data-garmin="preview">Перевірити</button><button class="btn primary" data-garmin="apply">Записати в Garmin</button><button class="btn ghost" data-garmin="fetch">Отримати дані годинника</button><button class="btn ghost" data-garmin="history">Уся історія з годинника</button></div>
    <p class="small muted">Записуються лише сьогоднішні й майбутні заняття, які ще не відмічені. Свої тренування оновлюються на тому самому ID — без дублікатів.</p>
    <div id="g-live">${garminLiveHtml()}</div>`;
  const report = store.get(`garmin/sync-${start}.json`);
  const preview = store.get(`garmin/preview-${start}.json`);
  if (report && (!preview || report.at >= preview.at)) {
    html += `<h2>Останній запис · ${esc(new Date(report.at).toLocaleString('uk-UA'))}</h2><div class="card"><ul class="list-plain">${report.results.map((r) =>
      `<li><div class="row"><b>${esc(r.title)}</b><span class="small muted">${DAYS_SHORT[dow(r.date)]}</span></div>
      <div class="small ${r.error ? '' : 'muted'}">${r.error ? '⚠ ' + esc(r.error) : esc(r.done.join(' · ') || r.skipped || '')}</div></li>`).join('')}</ul></div>`;
  } else if (preview) {
    html += `<h2>Перевірка · ${esc(new Date(preview.at).toLocaleString('uk-UA'))}</h2><div class="card"><p class="small">${esc(preview.summary)}</p><ul class="list-plain">${preview.rows.map((r) =>
      `<li><div class="row"><b>${esc(r.title)}</b><span class="small muted">${DAYS_SHORT[dow(r.date)]}</span></div>
      <div class="small">${esc(ROW_LABEL[r.action] ?? r.action)}${SCHED_LABEL[r.schedule] ? ' · ' + SCHED_LABEL[r.schedule] : ''}${r.name ? ` · «${esc(r.name)}»` : ''}</div>
      ${r.note ? `<div class="small muted">${esc(r.note)}</div>` : ''}${(r.issues ?? []).map((i) => `<div class="small">⚠ ${esc(i)}</div>`).join('')}
      ${(r.others ?? []).length ? `<div class="small">ℹ На цю дату в календарі Garmin уже є: ${r.others.map((o) => '«' + esc(o) + '»').join(', ')}</div>` : ''}</li>`).join('')}</ul></div>`;
  }
  html += `<p class="small muted"><a href="https://github.com/${esc(store.config.owner)}/${esc(store.config.repo)}/actions/workflows/garmin.yml" target="_blank" rel="noopener">Журнал запусків у GitHub</a></p>`;
  return html;
}

function garminLiveHtml() {
  if (!garminRun) return '';
  const st = garminRun.status;
  const title = GARMIN_ACTIONS[garminRun.action];
  if (!st) return `<div class="banner info"><b>${title}</b><p class="small" style="margin:4px 0 0">${esc(garminRun.note ?? 'Запуск у GitHub Actions… (зазвичай 30–60 с до старту)')}</p></div>`;
  if (st.state === 'needs_mfa') {
    return `<div class="banner"><b>Код підтвердження Garmin</b><p class="small">${esc(st.message)}</p>
      <label class="field">Код з листа або SMS<input id="g-code" inputmode="numeric" autocomplete="one-time-code" maxlength="12"></label>
      <div class="btns"><button class="btn primary" id="g-send">Надіслати код</button></div></div>`;
  }
  const cls = st.state === 'error' ? 'bad' : st.state === 'done' ? 'info' : 'info';
  return `<div class="banner ${cls}"><b>${title}: ${st.state === 'done' ? 'готово' : st.state === 'error' ? 'помилка' : 'виконується'}</b><p class="small" style="margin:4px 0 0">${esc(st.message)}</p></div>`;
}

function renderGarminLive() {
  const box = $('#g-live');
  if (!box) return;
  box.innerHTML = garminLiveHtml();
  $('#g-send')?.addEventListener('click', async () => {
    const code = $('#g-code').value.trim();
    if (!/^\d{4,10}$/.test(code)) { toast('Введи код із цифр'); return; }
    try {
      await store.putRemoteJson('garmin/mfa.json', { request_id: garminRun.id, code, at: new Date().toISOString() }, 'Garmin: код підтвердження (з телефона)');
      garminRun.status = { state: 'running', message: 'Код надіслано, чекаю на Garmin…' };
      renderGarminLive();
    } catch (e) { toast(e.message); }
  });
}

async function runGarmin(action, start) {
  if (garminRun && !['done', 'error'].includes(garminRun.status?.state)) { toast('Вже виконується'); return; }
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  garminRun = { id, action, start, status: null, note: 'Надсилаю план у GitHub…' };
  renderGarminLive();
  try {
    if (store.data.dirty.length) await store.sync(message);
    garminRun.note = null;
    renderGarminLive();
    await store.dispatch('garmin.yml', { action, week_start: start ?? '', request_id: id });
  } catch (e) {
    garminRun.status = { state: 'error', message: e.status === 404 ? 'Workflow Garmin не знайдено в main або токену бракує дозволу Actions.' : e.message };
    renderGarminLive();
    return;
  }
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 4000));
    let st = null;
    try { st = (await store.remoteJson('garmin/status.json')).data; } catch { continue; }
    if (st?.request_id !== id) continue;
    const prev = garminRun.status?.state;
    garminRun.status = st;
    if (!(prev === 'needs_mfa' && st.state === 'needs_mfa')) renderGarminLive();
    if (st.state === 'done' || st.state === 'error') {
      await syncNow(true);
      if (location.hash.startsWith('#garmin') || location.hash.startsWith('#progress')) route();
      toast(`${GARMIN_ACTIONS[action]}: ${st.state === 'done' ? 'готово' : 'помилка'}`);
      return;
    }
  }
  garminRun.status = { state: 'error', message: 'Немає відповіді 15 хв. Перевір журнал запусків у GitHub.' };
  renderGarminLive();
}

function bindGarmin(start) {
  $('#g-week')?.addEventListener('change', (e) => { location.hash = '#garmin/' + e.target.value; });
  $$('[data-garmin]').forEach((b) => b.addEventListener('click', async () => {
    const action = b.dataset.garmin;
    const weekStart = $('#g-week')?.value ?? start ?? '';
    if (action === 'apply' && !(await confirmSheet('Записати тиждень у Garmin?', 'Будуть створені або оновлені (на тому самому ID) лише сьогоднішні й майбутні невідмічені заняття, і вони з’являться в календарі. Минулі й відмічені заняття не змінюються.'))) return;
    runGarmin(action, action === 'login' ? '' : weekStart);
  }));
  renderGarminLive();
}

function confirmSheet(title, text, yes = 'Так, записати') {
  return new Promise((resolve) => {
    openSheet(`<div class="sheet-head"><h2 style="margin:0">${esc(title)}</h2><button class="close" data-close aria-label="Закрити">×</button></div><p>${esc(text)}</p>
      <div class="btns"><button class="btn primary" id="yes">${esc(yes)}</button><button class="btn ghost" id="no">Скасувати</button></div>`, (body) => {
      const dlg = $('#sheet');
      const done = (v) => { dlg.close(); resolve(v); };
      $('#yes', body).addEventListener('click', () => done(true));
      $('#no', body).addEventListener('click', () => done(false));
      dlg.addEventListener('close', () => resolve(false), { once: true });
    });
  });
}

function garminMetricsCard(start) {
  const m = store.get(`garmin/metrics/${start}.json`);
  if (!m) return '';
  const days = Object.values(m.days ?? {});
  const avg = (k) => { const v = days.map((d) => d[k]).filter((x) => typeof x === 'number'); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null; };
  const mins = m.activities.reduce((a, x) => a + (x.minutes || 0), 0);
  return `<h2>Дані Garmin</h2><div class="stats">
    <div class="stat"><span class="small muted">Активностей / хв</span><b>${m.activities.length} / ${Math.round(mins)}</b></div>
    <div class="stat"><span class="small muted">Пульс спокою, сер.</span><b>${avg('resting_hr') ?? '—'}</b></div>
    <div class="stat"><span class="small muted">Сон, год сер.</span><b>${avg('sleep_hours') ?? '—'}</b></div>
    <div class="stat"><span class="small muted">HRV уночі, мс сер.</span><b>${avg('hrv_night_ms') ?? '—'}</b></div></div>
    <div class="card"><ul class="list-plain">${m.activities.map((a) => `<li class="row"><span>${esc(a.date)} · ${esc(a.name ?? a.type ?? '')}</span><span class="small num">${a.minutes} хв${a.avg_hr ? ' · ' + a.avg_hr + ' уд/хв' : ''}</span></li>`).join('') || '<li class="muted">Активностей немає.</li>'}</ul>
    <p class="small muted">Отримано ${esc(new Date(m.fetched_at).toLocaleString('uk-UA'))}. Garmin не оцінює техніку й самопочуття — це роблять твої оцінки.</p></div>`;
}

// ----------------------------------------------------------------- router --
async function route() {
  const [name, arg] = decodeURIComponent(location.hash.slice(1) || 'today').split('/');
  const tab = { today: 'today', week: 'week', s: 'week', sheet: 'week', tech: 'more', guide: 'more', summary: 'summary', next: 'summary', progress: 'progress' }[name] ?? 'more';
  $$('.tabs a').forEach((a) => (a.dataset.tab === tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  try {
    switch (name) {
      case 'week': main.innerHTML = viewWeek(arg); bindWeek(arg); break;
      case 's': case 'sheet': {
        const id = resolveSession(arg);
        if (id && id !== arg) window.history.replaceState(null, '', `#${name}/${encodeURIComponent(id)}`);
        if (!id) { main.innerHTML = `<h1>Сьогодні занять немає</h1><p class="sub">Відпочинок — або легка прогулянка.</p><p><a class="btn" href="#week">План тижня</a></p>`; break; }
        if (name === 's') { main.innerHTML = viewSession(id); bindSession(id); } else { main.innerHTML = viewSheet(id); bindSheet(id); }
        break;
      }
      case 'summary': main.innerHTML = viewSummary(arg); bindSummary(arg); break;
      case 'next': main.innerHTML = await viewNext(arg); bindNext(); break;
      case 'progress': main.innerHTML = viewProgress(); bindProgress(); break;
      case 'more': main.innerHTML = viewMore(); bindMore(); break;
      case 'guide': main.innerHTML = viewGuide(arg); bindGuide(arg); break;
      case 'tech': main.innerHTML = viewTech(arg); bindTech(arg); break;
      case 'settings': main.innerHTML = viewSettings(); bindSettings(); break;
      case 'rules': main.innerHTML = viewRules(); break;
      case 'garmin': main.innerHTML = viewGarmin(arg); bindGarmin(arg); break;
      default: main.innerHTML = viewToday(); bindToday();
    }
  } catch (e) {
    console.error(e);
    main.innerHTML = `<div class="banner bad"><b>Помилка відображення.</b><p class="small">${esc(e.message)}</p></div>`;
  }
  keepAwake(name === 'sheet');
  updateSyncBadge();
}

/** "today" (icon shortcuts) → today's first unmarked required session, else today's first, else the next one. */
function resolveSession(arg) {
  if (arg !== 'today') return arg;
  const today = todayIso();
  const plan = store.plan(weekStart(today));
  const list = (plan?.sessions ?? []).filter((s) => s.date === today);
  const pick = list.find((s) => !s.optional && !resultOf(s)) ?? list.find((s) => !resultOf(s)) ?? list[0]
    ?? allPlans().flatMap((p) => p.sessions).find((s) => s.date > today && !s.optional);
  return pick?.id ?? null;
}

/** Keep the screen on while a session sheet is open (phone on the bench). */
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && !wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      const w = wakeLock; wakeLock = null; await w.release();
    }
  } catch { wakeLock = null; }
}
document.addEventListener('visibilitychange', () => { if (location.hash.startsWith('#sheet/')) keepAwake(true); });

async function start() {
  lib = await loadJson('data/library.json');
  const index = await loadJson('data/seed/index.json');
  const seed = {};
  for (const f of index.files) seed[f] = await loadJson(`data/seed/${f}`);
  store.load(seed);
  installTooltips();
  window.addEventListener('hashchange', () => { if ($('#sheet').open) $('#sheet').close(); route(); window.scrollTo(0, 0); });
  $('#sync').addEventListener('click', () => (store.connected ? syncNow(false) : (location.hash = '#settings')));
  window.addEventListener('online', () => scheduleSync());
  await route();
  if (store.connected) syncNow(true);
  if ('serviceWorker' in navigator && location.protocol === 'https:') watchUpdates();
}

/** Look for a new version whenever the app comes back to the screen; offer a restart when one is installed. */
function watchUpdates() {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    let last = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - last > 60 * 1000) { last = Date.now(); reg.update().catch(() => {}); }
    });
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || $('#update-bar')) return;
    document.body.insertAdjacentHTML('beforeend', `<div class="update-bar" id="update-bar" role="status"><span>Є нова версія застосунку</span><button class="btn small primary" type="button" id="update-now">Оновити</button></div>`);
    $('#update-now').addEventListener('click', () => location.reload());
  });
}
async function appVersion() {
  try { return (await caches.keys()).find((k) => k.startsWith('mygarmin-app-'))?.replace('mygarmin-app-', '') ?? null; } catch { return null; }
}

start().catch((e) => {
  main.innerHTML = `<div class="banner bad"><b>Не вдалося запустити застосунок.</b><p class="small">${esc(e.message)}</p></div>`;
});

