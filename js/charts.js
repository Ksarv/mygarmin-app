// Small dependency-free charts: SVG bar/line charts, small multiples, a
// calendar heatmap, sparklines and a shared tap/hover tooltip.
// Colours are CSS variables (app.css) so light and dark mode each use their
// own validated steps. Text always uses the text inks, never series colours.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Categorical slots in fixed order (validated: scripts/validate_palette.js). */
export const SERIES_COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)'];
/** Session families. Three slots pass the all-pairs check, so ready-made Garmin
 * mobility/pilates complexes share the mobility colour. */
export const TYPE_FAMILY = { strength: 'strength', cardio: 'cardio', flex: 'flex', native: 'flex' };
export const FAMILY = {
  strength: { name: 'Сила', color: 'var(--c1)' },
  cardio: { name: 'Кардіо', color: 'var(--c2)' },
  flex: { name: 'Рухливість і гнучкість', color: 'var(--c3)' },
};
/** Sequential one-hue ramp for the heatmap, light→dark (dark mode: dark→light). */
export const HEAT_BINS = [
  { max: 0, color: 'var(--heat0)', label: '0' },
  { max: 20, color: 'var(--heat1)', label: '1–20' },
  { max: 45, color: 'var(--heat2)', label: '21–45' },
  { max: 75, color: 'var(--heat3)', label: '46–75' },
  { max: Infinity, color: 'var(--heat4)', label: '76+' },
];
export function heatBin(minutes) { return HEAT_BINS.findIndex((b) => minutes <= b.max); }

const fmt = (v) => (typeof v === 'number' ? String(+v.toFixed(1)).replace('.', ',') : String(v));

export function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/** Tooltip payload: a title and rows of {v, label, color}. Encoded into one
 * attribute and rendered with textContent only. */
export function tip(title, rows = []) {
  return esc(JSON.stringify({ t: title, r: rows }));
}

function frame(el, draw) {
  const svg = el.querySelector('svg');
  const render = () => { svg.innerHTML = draw(el.clientWidth, el.clientHeight); };
  render();
  if ('ResizeObserver' in window) new ResizeObserver(render).observe(el);
}

function axes(W, H, m, max, ticks, yTitle, labels, xTitle, min = 0) {
  let out = '';
  for (let i = 0; i <= ticks; i += 1) {
    const v = min + ((max - min) / ticks) * i;
    const y = H - m.b - ((H - m.t - m.b) * i) / ticks;
    out += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" stroke="currentColor" stroke-opacity="${i === 0 ? '.3' : '.1'}"/>`;
    out += `<text x="${m.l - 6}" y="${y + 4}" text-anchor="end" font-size="11" fill="currentColor" fill-opacity=".65">${esc(fmt(v))}</text>`;
  }
  const step = (W - m.l - m.r) / labels.length;
  const fit = Math.max(1, Math.floor((W - m.l - m.r) / 34));
  const every = Math.ceil(labels.length / fit);
  labels.forEach((l, i) => {
    if (i % every && i !== labels.length - 1) return;
    out += `<text x="${m.l + step * (i + 0.5)}" y="${H - m.b + 16}" text-anchor="middle" font-size="11" fill="currentColor" fill-opacity=".75">${esc(l)}</text>`;
  });
  if (yTitle) out += `<text x="${m.l}" y="${m.t - 8}" font-size="11" fill="currentColor" fill-opacity=".75">${esc(yTitle)}</text>`;
  if (xTitle) out += `<text x="${W - m.r}" y="${H - 2}" text-anchor="end" font-size="11" fill="currentColor" fill-opacity=".75">${esc(xTitle)}</text>`;
  return { out, step };
}

/** A bar with 4px rounded data end and a square base on the baseline. */
function barPath(x, y, w, h) {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z`;
}

/** Invisible full-height column per x label: the tap/hover target and, for
 * line charts, the crosshair. One readout lists every series at that x. */
function columns(W, H, m, step, labels, series, unit, crosshair) {
  return labels.map((l, i) => {
    const x = m.l + step * i;
    const rows = series.map((s) => ({ v: s.values[i] == null ? '—' : `${fmt(s.values[i])}${unit ? ' ' + unit : ''}`, label: s.name, color: s.color }));
    return `<g class="col" tabindex="0" data-tip="${tip(l, rows)}">${crosshair ? `<line class="xh" x1="${x + step / 2}" x2="${x + step / 2}" y1="${m.t}" y2="${H - m.b}"/>` : ''}<rect x="${x}" y="${m.t}" width="${step}" height="${H - m.t - m.b}" fill="transparent"/></g>`;
  }).join('');
}


/** Grouped bars: series = [{name, values, color}] over labels. */
export function barChart(el, { labels, series, yTitle, xTitle = 'тиждень', max, unit = '' }) {
  frame(el, (W, H) => {
    const m = { l: 36, r: 8, t: 22, b: 34 };
    const top = Math.max(4, niceMax(max ?? Math.max(1, ...series.flatMap((s) => s.values.map((v) => v ?? 0)))));
    const { out, step } = axes(W, H, m, top, 4, yTitle, labels, xTitle);
    let bars = '';
    const bw = Math.max(4, Math.min(26, (step * 0.72) / series.length));
    series.forEach((s, si) => {
      s.values.forEach((v, i) => {
        if (!v) return;
        const h = ((H - m.t - m.b) * Math.min(v, top)) / top;
        const x = m.l + step * i + step / 2 - (bw * series.length) / 2 + bw * si + 1;
        bars += `<path d="${barPath(x, H - m.b - h, bw - 2, h)}" style="fill:${s.color}"/>`;
      });
    });
    return out + bars + columns(W, H, m, step, labels, series, unit, false);
  });
}

/** Lines with ≥8px markers; null values break the line. The last value of
 * each series is labelled in text ink. */
export function lineChart(el, { labels, series, yTitle, xTitle = 'тиждень', unit = '' }) {
  frame(el, (W, H) => {
    const m = { l: 36, r: 30, t: 22, b: 34 };
    const top = Math.max(4, niceMax(Math.max(1, ...series.flatMap((s) => s.values.map((v) => v ?? 0)))));
    const { out, step } = axes(W, H, m, top, 4, yTitle, labels, xTitle);
    let lines = '', dots = '', ends = [];
    for (const s of series) {
      let d = '', pen = false, last = null;
      s.values.forEach((v, i) => {
        if (v == null) { pen = false; return; }
        const x = m.l + step * (i + 0.5);
        const y = H - m.b - ((H - m.t - m.b) * v) / top;
        d += `${pen ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
        pen = true;
        last = { x, y, v };
        dots += `<circle cx="${x}" cy="${y}" r="4" style="fill:${s.color}" stroke="var(--card)" stroke-width="2"/>`;
      });
      lines += `<path d="${d}" fill="none" style="stroke:${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      if (last) ends.push(last);
    }
    // Selective direct labels: last value only, nudged apart when they collide.
    ends.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i += 1) if (ends[i].y - ends[i - 1].y < 12) ends[i].y = ends[i - 1].y + 12;
    const labelsOut = ends.map((e) => `<text x="${e.x + 8}" y="${e.y + 4}" font-size="11" fill="currentColor" fill-opacity=".8">${esc(fmt(e.v))}</text>`).join('');
    return out + lines + dots + labelsOut + columns(W, H, m, step, labels, series, unit, true);
  });
}

/** One small multiple: a single daily series on its own scale (no dual axes). */
/** A small single-series line. `band: [lo, hi]` shades a target range behind the line (recessive, labelled). */
export function miniLine(el, { points, unit, name, color = 'var(--c1)', decimals = 0, band = null, bandLabel = '', lo: fixLo = null, hi: fixHi = null }) {
  frame(el, (W, H) => {
    const m = { l: 34, r: 8, t: 10, b: 22 };
    const vals = points.map((p) => p.value).filter((v) => v != null);
    if (!vals.length) return `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="12" fill="currentColor" fill-opacity=".6">Немає даних</text>`;
    let lo = Math.min(...vals, ...(band ?? [])), hi = Math.max(...vals, ...(band ?? []));
    const pad = Math.max(band ? 0.1 : 1, (hi - lo) * 0.15);
    lo = fixLo ?? (band ? Math.max(0, Math.floor((lo - pad) * 10) / 10) : Math.floor(lo - pad));
    hi = fixHi ?? (band ? Math.ceil((hi + pad) * 10) / 10 : Math.ceil(hi + pad));
    const labels = points.map((p) => p.label);
    const { out, step } = axes(W, H, m, hi, 2, '', labels, '', lo);
    const y = (v) => H - m.b - ((H - m.t - m.b) * (v - lo)) / (hi - lo);
    const bandSvg = band ? `<rect x="${m.l}" y="${y(band[1]).toFixed(1)}" width="${W - m.l - m.r}" height="${(y(band[0]) - y(band[1])).toFixed(1)}" fill="currentColor" fill-opacity=".07"/>${bandLabel ? `<text x="${W - m.r - 4}" y="${(y(band[1]) + 12).toFixed(1)}" text-anchor="end" font-size="10.5" fill="currentColor" fill-opacity=".6">${esc(bandLabel)}</text>` : ''}` : '';
    let d = '', pen = false, dots = '';
    points.forEach((p, i) => {
      if (p.value == null) { pen = false; return; }
      const x = m.l + step * (i + 0.5);
      d += `${pen ? 'L' : 'M'}${x.toFixed(1)} ${y(p.value).toFixed(1)}`;
      pen = true;
      if (points.length <= 21) dots += `<circle cx="${x}" cy="${y(p.value)}" r="3" style="fill:${color}"/>`;
    });
    const cols = points.map((p, i) => {
      const x = m.l + step * i;
      return `<g class="col" tabindex="0" data-tip="${tip(p.title ?? p.label, [{ v: p.value == null ? '—' : `${fmt(+p.value.toFixed(decimals))} ${unit}`, label: name, color }])}"><line class="xh" x1="${x + step / 2}" x2="${x + step / 2}" y1="${m.t}" y2="${H - m.b}"/><rect x="${x}" y="${m.t}" width="${step}" height="${H - m.t - m.b}" fill="transparent"/></g>`;
    }).join('');
    return out + bandSvg + `<path d="${d}" fill="none" style="stroke:${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` + dots + cols;
  });
}

/** Compact per-exercise trend: only weeks with data, plan as a line (it
 * carries over gaps), facts as dots, week labels underneath. SVG markup. */
export function sparkline(plan, facts, labels, { w = 132, h = 44 } = {}) {
  const idx = labels.map((_, i) => i).filter((i) => plan[i] != null || facts[i] != null);
  if (!idx.length) return '';
  const all = idx.flatMap((i) => [plan[i], facts[i]]).filter((v) => v != null);
  const lo = Math.min(...all), hi = Math.max(...all);
  const top = 6, bottom = 28;
  const x = (k) => (idx.length === 1 ? w / 2 : 10 + ((w - 20) * k) / (idx.length - 1));
  const y = (v) => (hi === lo ? (top + bottom) / 2 : bottom - ((bottom - top) * (v - lo)) / (hi - lo));
  let d = '';
  idx.forEach((i, k) => { if (plan[i] != null) d += `${d ? 'L' : 'M'}${x(k).toFixed(1)} ${y(plan[i]).toFixed(1)}`; });
  let marks = '';
  idx.forEach((i, k) => {
    if (plan[i] != null) marks += `<circle cx="${x(k).toFixed(1)}" cy="${y(plan[i]).toFixed(1)}" r="3" style="fill:var(--c1)"/>`;
    if (facts[i] != null) marks += `<circle cx="${x(k).toFixed(1)}" cy="${y(facts[i]).toFixed(1)}" r="3.5" style="fill:var(--c2)" stroke="var(--card)" stroke-width="1.5"/>`;
    marks += `<text x="${x(k).toFixed(1)}" y="${h - 3}" text-anchor="middle" font-size="10" fill="currentColor" fill-opacity=".6">${esc(labels[i])}</text>`;
  });
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><path d="${d}" fill="none" style="stroke:var(--c1)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>${marks}</svg>`;
}

/** Calendar heatmap: rows = weeks, columns = Mon..Sun, cell = minutes. */
export function heatmap(weeks, { days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'] } = {}) {
  let html = `<div class="heat" role="table" aria-label="Хвилини тренувань по днях"><div role="row" class="heat-row head"><span></span>${days.map((d) => `<span role="columnheader">${esc(d)}</span>`).join('')}</div>`;
  for (const w of weeks) {
    html += `<div role="row" class="heat-row"><span role="rowheader" class="heat-label">${esc(w.label)}</span>`;
    for (const c of w.cells) {
      if (c.future) { html += `<span role="cell" class="heat-cell future" aria-label="${esc(c.title)}: попереду"></span>`; continue; }
      const bin = heatBin(c.minutes);
      html += `<span role="cell" tabindex="0" class="heat-cell${c.today ? ' today' : ''}" style="background:${HEAT_BINS[bin].color}" aria-label="${esc(c.title)}: ${c.minutes} хв" data-tip="${tip(c.title, c.rows)}"></span>`;
    }
    html += '</div>';
  }
  html += `</div><div class="legend heat-legend"><span>хв за день:</span>${HEAT_BINS.map((b) => `<span><i style="background:${b.color}"></i>${b.label}</span>`).join('')}</div>`;
  return html;
}

export function legend(series) {
  return `<div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`;
}

/** The table view every chart offers: same numbers, no colour needed. */
export function tableView(labels, series, { unit = '', head = 'Тиждень' } = {}) {
  return `<details class="tbl"><summary>Таблиця</summary><div class="tbl-wrap"><table><thead><tr><th>${esc(head)}</th>${series.map((s) => `<th>${esc(s.name)}</th>`).join('')}</tr></thead><tbody>${labels.map((l, i) =>
    `<tr><th>${esc(l)}</th>${series.map((s) => `<td>${s.values[i] == null ? '—' : esc(fmt(s.values[i])) + (unit ? ' ' + esc(unit) : '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
}

/** One shared tooltip for every [data-tip] mark: hover, focus and tap. */
export function installTooltips(root = document) {
  if (installTooltips.done) return;
  installTooltips.done = true;
  const box = document.createElement('div');
  box.className = 'tip';
  box.setAttribute('role', 'status');
  box.hidden = true;
  document.body.append(box);
  let current = null;
  const hide = () => { box.hidden = true; current?.classList.remove('on'); current = null; };
  const show = (el) => {
    if (current === el) return;
    current?.classList.remove('on');
    current = el;
    el.classList.add('on');
    let data;
    try { data = JSON.parse(el.getAttribute('data-tip')); } catch { return; }
    box.replaceChildren();
    const t = document.createElement('div');
    t.className = 'tip-title';
    t.textContent = data.t;
    box.append(t);
    for (const r of data.r ?? []) {
      const row = document.createElement('div');
      row.className = 'tip-row';
      if (r.color) { const k = document.createElement('i'); k.style.borderColor = r.color; row.append(k); }
      const v = document.createElement('b'); v.textContent = r.v;
      const l = document.createElement('span'); l.textContent = r.label ?? '';
      row.append(v, l);
      box.append(row);
    }
    box.hidden = false;
    const rect = el.getBoundingClientRect();
    const bw = box.offsetWidth, bh = box.offsetHeight;
    let left = rect.left + rect.width / 2 - bw / 2;
    left = Math.max(8, Math.min(window.innerWidth - bw - 8, left));
    let top = rect.top - bh - 8;
    if (top < 8) top = rect.bottom + 8;
    box.style.left = `${left + window.scrollX}px`;
    box.style.top = `${top + window.scrollY}px`;
  };
  const target = (e) => e.target.closest?.('[data-tip]');
  root.addEventListener('pointerover', (e) => { const el = target(e); if (el && e.pointerType === 'mouse') show(el); });
  root.addEventListener('pointerout', (e) => { if (e.pointerType === 'mouse' && target(e) && !e.relatedTarget?.closest?.('[data-tip]')) hide(); });
  root.addEventListener('pointerdown', (e) => {
    const el = target(e);
    if (!el) { hide(); return; }
    if (el.tagName === 'A' && e.pointerType !== 'mouse') return; // a tap on a link opens it
    if (current === el) hide(); else show(el);
  });
  root.addEventListener('focusin', (e) => { const el = target(e); if (el) show(el); });
  root.addEventListener('focusout', (e) => { if (target(e)) hide(); });
  window.addEventListener('scroll', hide, { passive: true });
  window.addEventListener('hashchange', hide);
}

/** Five heart-rate zones as one segmented bar (sequential ramp, 2px gaps), with a tooltip per zone. */
export const ZONE_COLORS = ['var(--z1)', 'var(--z2)', 'var(--z3)', 'var(--z4)', 'var(--z5)'];
export function zoneBar(minutes, floors = []) {
  const total = minutes.reduce((a, b) => a + b, 0) || 1;
  return `<div class="zbar" role="img" aria-label="${esc(minutes.map((v, i) => `зона ${i + 1}: ${v} хв`).join(', '))}">${minutes.map((v, i) => (v ? `<i style="flex:${v};background:${ZONE_COLORS[i]}" data-tip="${tip(`Зона ${i + 1}${floors[i] ? ` · від ${floors[i]} уд/хв` : ''}`, [{ v: `${v} хв`, label: `${Math.round((v / total) * 100)} % часу` }])}"></i>` : '')).join('')}</div>
    <div class="zkeys small muted">${minutes.map((v, i) => (v ? `<span><i style="background:${ZONE_COLORS[i]}"></i>зона ${i + 1}: ${v} хв</span>` : '')).join('')}</div>`;
}
/** Load focus: value bar against the target range bracket. */
export function focusBars(rows) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.load ?? 0, r.max ?? 0))) * 1.08;
  const pc = (v) => `${((v / max) * 100).toFixed(1)}%`;
  const n = (v) => (v == null ? '—' : String(Math.round(v)));
  return `<div class="focus">${rows.map((r) => `<div class="row"><b class="fname">${esc(r.name)}</b><span class="num small">${n(r.load)}${r.min != null ? ` <span class="muted">/ норма ${n(r.min)}–${n(r.max)}</span>` : ''}</span></div>
    <div class="small muted">${esc(r.short)}</div>
    <div class="fbar ${r.state}" data-tip="${tip(r.name, [{ v: n(r.load), label: 'навантаження за 4 тижні' }, { v: `${n(r.min)}–${n(r.max)}`, label: 'норма Garmin' }])}">${r.min != null ? `<span class="target" style="left:${pc(r.min)};width:${pc(r.max - r.min)}"></span>` : ''}<i style="width:${pc(r.load ?? 0)}"></i></div>`).join('')}</div>`;
}
