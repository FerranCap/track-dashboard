'use strict';

const researchSessions = new Map();
const researchCache = new Map();
const researchSecondCache = new Map();
const researchTime = new Intl.DateTimeFormat('es-ES', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const researchSecondTime = new Intl.DateTimeFormat('es-ES', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const researchCharts = {
  minute: { canvas: 'research-canvas', container: 'research-chart', details: 'research-bar-details', seconds: 60 },
  second: { canvas: 'research-seconds-canvas', container: 'research-seconds-chart', details: 'research-bar-details', seconds: 1 }
};
let researchData = null;
let researchSecondData = null;
let researchLoading = false;
let researchStart = 0;
let researchWindow = 0;
let researchSpan = 0;
let researchFrame = null;
let researchMonth = '';
let researchDrag = null;

function researchClock(time, seconds = false) {
  return (seconds ? researchSecondTime : researchTime).format(new Date(time * 1000));
}

function researchVisibleRange() {
  if (!researchData) return null;
  const first = researchData.bars[0].time + researchStart * 60;
  return { first, last: first + researchWindow * 60 };
}

function researchOpeningMinute() {
  const bar = researchData?.bars.find(item => researchClock(item.time) === '09:30');
  return bar ? { start: bar.time, end: bar.time + 60, high: bar.high, low: bar.low } : null;
}

function drawResearchOpeningLevels(paint, geometry) {
  const opening = researchOpeningMinute();
  if (!opening) return;
  const { left, right, top, bottom, low, high } = geometry;
  const levels = opening.high === opening.low
    ? [[opening.high, 'High/Low 09:30', '#f6c560']]
    : [[opening.high, 'High 09:30', '#f6c560'], [opening.low, 'Low 09:30', '#7dbbff']];
  paint.save(); paint.font = '11px system-ui'; paint.lineWidth = 1;
  for (const [price, label, color] of levels) {
    const py = bottom - (price - low) / (high - low) * (bottom - top);
    if (py < top || py > bottom) continue;
    paint.strokeStyle = paint.fillStyle = color;
    paint.setLineDash([6, 4]);
    paint.beginPath(); paint.moveTo(left, py); paint.lineTo(right, py); paint.stroke();
    paint.fillText(`${label} · ${price.toFixed(2)}`, left + 8, Math.max(top + 12, py - 5));
  }
  paint.restore();
}

function researchLowerBound(bars, time) {
  let low = 0, high = bars.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (bars[middle].time < time) low = middle + 1;
    else high = middle;
  }
  return low;
}

function syncResearchScroll() {
  const scroll = document.getElementById('research-position');
  document.getElementById('research-scroll-track').style.width = `${researchData ? researchSpan / researchWindow * 100 : 100}%`;
  scroll.setAttribute('aria-disabled', String(!researchData || researchWindow >= researchSpan));
  const maxScroll = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
  const position = researchSpan > researchWindow ? researchStart / (researchSpan - researchWindow) * maxScroll : 0;
  if (Math.abs(scroll.scrollLeft - position) > .5) scroll.scrollLeft = position;
}

function scheduleResearchChart() {
  if (researchFrame !== null) return;
  researchFrame = requestAnimationFrame(() => { researchFrame = null; drawResearchChart(); });
}

function resetResearchPanes() {
  for (const pane of Object.values(researchCharts)) {
    const canvas = document.getElementById(pane.canvas);
    if (researchDrag?.canvas === pane.canvas && canvas.hasPointerCapture(researchDrag.pointerId)) canvas.releasePointerCapture(researchDrag.pointerId);
    pane.hover = pane.priceRange = pane.geometry = pane.cacheKey = null;
    pane.visibleBars = [];
    canvas.style.cursor = 'crosshair';
    document.getElementById(pane.details).textContent = 'America/New_York · USD';
  }
  researchDrag = null;
}

function clearResearchSession() {
  researchData = researchSecondData = null;
  researchStart = researchWindow = researchSpan = 0;
  resetResearchPanes();
  document.querySelectorAll('[data-research-date]').forEach(button => button.setAttribute('aria-pressed', 'false'));
  document.getElementById('research-chart-title').textContent = 'NVDA · 1 minuto';
  document.getElementById('research-status').textContent = 'Selecciona un día en el calendario.';
  document.getElementById('research-seconds-status').textContent = 'Muestra el mismo intervalo visible que el gráfico de 1 minuto.';
  document.getElementById('research-seconds-status').hidden = true;
  drawResearchChart();
}

function selectResearchDay(date) {
  if (researchLoading) return;
  if (researchData?.date === date) clearResearchSession();
  else return loadResearchSession(date);
}

function drawResearchPane(pane, data) {
  const canvas = document.getElementById(pane.canvas), bounds = canvas.getBoundingClientRect();
  if (bounds.width <= 77 || !bounds.height) return;
  const pixelRatio = window.devicePixelRatio || 1;
  const pixelWidth = Math.round(bounds.width * pixelRatio), pixelHeight = Math.round(bounds.height * pixelRatio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
  const ctx = canvas.getContext('2d'), width = bounds.width, height = bounds.height;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  const range = researchVisibleRange();
  if (!data || !range) {
    pane.geometry = null; pane.visibleBars = [];
    ctx.fillStyle = '#101b2a'; ctx.fillRect(0, 0, width, height);
    ctx.font = '11px system-ui'; ctx.fillStyle = '#96a9c1';
    ctx.fillText(researchData ? 'Sin datos de 1 segundo cargados' : 'Selecciona una sesión en el calendario', 20, 35);
    return;
  }
  const { first, last } = range;
  const key = `${data.date}|${first}|${last}|${pixelWidth}|${pixelHeight}|${pane.priceRange?.low}|${pane.priceRange?.high}`;
  if (pane.cacheKey !== key || pane.cachedData !== data) {
    const bars = data.bars.slice(researchLowerBound(data.bars, first), researchLowerBound(data.bars, last));
    pane.visibleBars = bars;
    const left = 12, right = width - 65, top = 20, bottom = height * .71;
    const volumeTop = height * .77, volumeBottom = height - 32;
    let min = Infinity, max = -Infinity, maxVolume = 1;
    for (const bar of bars.length ? bars : [data.bars[0]]) {
      min = Math.min(min, bar.low); max = Math.max(max, bar.high); maxVolume = Math.max(maxVolume, bar.volume);
    }
    const padding = Math.max((max - min) * .07, .02);
    const low = pane.priceRange?.low ?? min - padding, high = pane.priceRange?.high ?? max + padding;
    const x = time => left + (time - first + pane.seconds / 2) / (last - first) * (right - left);
    const y = price => bottom - (price - low) / (high - low) * (bottom - top);
    pane.geometry = { left, right, top, bottom, low, high, volumeBottom, first, last };
    pane.buffer ||= document.createElement('canvas');
    pane.buffer.width = pixelWidth; pane.buffer.height = pixelHeight;
    const paint = pane.buffer.getContext('2d');
    paint.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    paint.fillStyle = '#101b2a'; paint.fillRect(0, 0, width, height); paint.font = '11px system-ui';
    paint.save(); paint.beginPath(); paint.rect(left, top, right - left, volumeBottom - top); paint.clip();
    const local = researchClock(researchData.bars[0].time, true).split(':').map(Number);
    const midnight = researchData.bars[0].time - local[0] * 3600 - local[1] * 60 - local[2];
    paint.fillStyle = '#19263b';
    const boundary = time => left + (time - first) / (last - first) * (right - left);
    for (const [start, end] of [[first, Math.min(last, midnight + 9.5 * 3600)], [Math.max(first, midnight + 16 * 3600), last]]) {
      if (end > start) paint.fillRect(boundary(start), top, boundary(end) - boundary(start), volumeBottom - top);
    }
    paint.strokeStyle = '#29374b'; paint.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const py = top + i * (bottom - top) / 4;
      paint.beginPath(); paint.moveTo(left, py); paint.lineTo(right, py); paint.stroke();
    }
    const bodyWidth = Math.max(.35, Math.min(12, (right - left) * pane.seconds / (last - first) * .72));
    paint.save(); paint.beginPath(); paint.rect(left, top, right - left, bottom - top); paint.clip();
    for (const bar of bars) {
      paint.strokeStyle = paint.fillStyle = bar.close >= bar.open ? '#35ebb3' : '#ff6b7d';
      const px = x(bar.time);
      paint.beginPath(); paint.moveTo(px, y(bar.high)); paint.lineTo(px, y(bar.low)); paint.stroke();
      paint.fillRect(px - bodyWidth / 2, Math.min(y(bar.open), y(bar.close)), bodyWidth, Math.max(1, Math.abs(y(bar.open) - y(bar.close))));
    }
    paint.restore(); paint.globalAlpha = .65;
    for (const bar of bars) {
      paint.fillStyle = bar.close >= bar.open ? '#35ebb3' : '#ff6b7d';
      const volumeHeight = bar.volume / maxVolume * (volumeBottom - volumeTop);
      paint.fillRect(x(bar.time) - bodyWidth / 2, volumeBottom - volumeHeight, bodyWidth, volumeHeight);
    }
    paint.globalAlpha = 1; paint.restore(); paint.fillStyle = '#a6bad2';
    for (let i = 0; i <= 4; i++) paint.fillText((high - i * (high - low) / 4).toFixed(2), right + 7, top + i * (bottom - top) / 4 + 4);
    paint.fillText('Vol', left + 4, volumeTop - 5);
    if (pane.seconds === 1) drawResearchOpeningLevels(paint, pane.geometry);
    const ticks = Math.max(2, Math.floor((right - left) / (pane.seconds === 1 ? 100 : 85)));
    for (let i = 0; i < ticks; i++) {
      const time = first + Math.floor(i * ((last - first) / pane.seconds - 1) / (ticks - 1)) * pane.seconds;
      paint.fillText(researchClock(time, pane.seconds === 1), Math.min(boundary(time), right - (pane.seconds === 1 ? 52 : 32)), height - 10);
    }
    pane.cacheKey = key; pane.cachedData = data;
  }
  ctx.drawImage(pane.buffer, 0, 0, width, height);
  const { left, right, top, bottom, low, high, volumeBottom } = pane.geometry;
  if (pane.hover) {
    const target = first + Math.floor(pane.hover.x * (last - first) / pane.seconds) * pane.seconds;
    const px = left + (target - first + pane.seconds / 2) / (last - first) * (right - left);
    const index = researchLowerBound(data.bars, target), bar = data.bars[index]?.time === target ? data.bars[index] : null;
    ctx.save(); ctx.strokeStyle = '#9bb4d0'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(px, volumeBottom); ctx.stroke();
    if (pane.hover.y >= top && pane.hover.y <= bottom) {
      ctx.beginPath(); ctx.moveTo(left, pane.hover.y); ctx.lineTo(right, pane.hover.y); ctx.stroke();
      const price = high - (pane.hover.y - top) / (bottom - top) * (high - low);
      ctx.fillStyle = '#365480'; ctx.fillRect(right + 1, pane.hover.y - 10, width - right - 1, 20);
      ctx.font = '11px system-ui'; ctx.fillStyle = '#ffffff'; ctx.fillText(price.toFixed(2), right + 7, pane.hover.y + 4);
    }
    ctx.restore();
    document.getElementById(pane.details).textContent = bar
      ? `${researchClock(bar.time, pane.seconds === 1)} NY · O ${bar.open.toFixed(2)} · H ${bar.high.toFixed(2)} · L ${bar.low.toFixed(2)} · C ${bar.close.toFixed(2)} USD · Vol ${bar.volume.toLocaleString('es-ES')}`
      : `${researchClock(target, pane.seconds === 1)} NY · Sin operaciones`;
  }
}

function drawResearchChart() {
  drawResearchPane(researchCharts.minute, researchData);
  drawResearchPane(researchCharts.second, researchSecondData);
  if (researchSecondData && researchData) {
    const { first, last } = researchVisibleRange();
    const count = researchCharts.second.visibleBars.length;
    document.getElementById('research-seconds-status').textContent = `${researchClock(first, true)}–${researchClock(last - 1, true)} NY · ${count} velas de 1 segundo${count ? '' : ' · Sin datos de 1 segundo en este intervalo'} · Intervalo sincronizado`;
    document.getElementById('research-seconds-status').hidden = true;
  }
  syncResearchScroll();
}

async function fetchResearchBars(session, date, seconds = false) {
  const cache = seconds ? researchSecondCache : researchCache;
  if (cache.has(date)) return cache.get(date);
  const file = seconds ? session.secondsFile : session.file;
  if (!file) throw new Error('No second bars available');
  const response = await fetch(`data/research/${file}?v=${encodeURIComponent(session.version)}`, { cache: 'default' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json(), interval = seconds ? '1s' : '1m';
  if (data.symbol !== 'NVDA' || data.interval !== interval || data.date !== date || data.timezone !== 'America/New_York' || !data.bars?.length) throw new Error('Invalid session');
  const bars = data.bars.map((bar, index) => {
    const prices = Object.fromEntries(['open', 'high', 'low', 'close'].map(key => [key, Number(bar[key])]));
    if (!Number.isInteger(bar.time) || (!seconds && bar.time % 60 !== 0) || (index > 0 && bar.time <= data.bars[index - 1].time)
      || Object.values(prices).some(price => !Number.isFinite(price) || price <= 0)
      || !Number.isSafeInteger(bar.volume) || bar.volume < 0) throw new Error('Invalid bar');
    return { ...bar, ...prices };
  });
  const result = { ...data, bars }; cache.set(date, result); return result;
}

async function loadResearchSession(date) {
  if (researchLoading) return;
  const session = researchSessions.get(date);
  if (!session) return;
  const status = document.getElementById('research-status');
  researchLoading = true; status.textContent = 'Cargando sesión…';
  try {
    const data = await fetchResearchBars(session, date);
    resetResearchPanes(); researchData = data; researchSecondData = null;
    researchStart = 0;
    researchSpan = (data.bars.at(-1).time - data.bars[0].time) / 60 + 1;
    researchWindow = researchSpan;
    document.querySelectorAll('[data-research-date]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.researchDate === date)));
    document.getElementById('research-chart-title').textContent = `NVDA · ${date.split('-').reverse().join('/')} · 1 minuto`;
    status.textContent = `${researchClock(data.bars[0].time)}–${researchClock(data.bars.at(-1).time)} NY · ${data.bars.length} velas`;
    document.getElementById('research-seconds-status').textContent = 'Cargando velas de 1 segundo…';
    document.getElementById('research-seconds-status').hidden = false;
    drawResearchChart();
    try { researchSecondData = await fetchResearchBars(session, date, true); drawResearchChart(); }
    catch {
      document.getElementById('research-seconds-status').textContent = 'No se pudieron cargar las velas de 1 segundo. Deselecciona el día y vuelve a seleccionarlo para reintentar.';
      document.getElementById('research-seconds-status').hidden = false;
    }
  } catch { status.textContent = 'No se pudo cargar la sesión. Pulsa el día para reintentar.'; }
  finally { researchLoading = false; }
}

function clearResearchHover() {
  for (const pane of Object.values(researchCharts)) pane.hover = null;
}

function panResearch(start) {
  researchStart = Math.max(0, Math.min(researchSpan - researchWindow, Math.round(start)));
  clearResearchHover(); scheduleResearchChart();
}

function zoomResearch(factor, anchor = .5) {
  if (!researchData) return;
  const scaled = Math.round(researchWindow * factor);
  const directed = factor > 1 ? Math.max(researchWindow + 1, scaled) : factor < 1 ? Math.min(researchWindow - 1, scaled) : scaled;
  const next = Math.min(researchSpan, Math.max(1, directed));
  researchStart = Math.max(0, Math.min(researchSpan - next, Math.round(researchStart + (researchWindow - next) * anchor)));
  researchWindow = next; clearResearchHover(); drawResearchChart();
}

function renderResearchCalendar(month) {
  researchMonth = month;
  const calendar = document.getElementById('research-calendar'); calendar.replaceChildren();
  const [year, number] = month.split('-').map(Number);
  document.getElementById('research-month').textContent = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T12:00:00Z`));
  const count = [...researchSessions.keys()].filter(date => date.startsWith(month)).length;
  document.getElementById('research-availability').textContent = `${count} ${count === 1 ? 'día disponible' : 'días disponibles'}`;
  for (const label of ['L', 'M', 'X', 'J', 'V', 'S', 'D']) {
    const weekday = document.createElement('span'); weekday.textContent = label; calendar.append(weekday);
  }
  const offset = (new Date(Date.UTC(year, number - 1, 1)).getUTCDay() + 6) % 7, days = new Date(Date.UTC(year, number, 0)).getUTCDate();
  for (let i = 0; i < offset; i++) { const blank = document.createElement('span'); blank.setAttribute('aria-hidden', 'true'); calendar.append(blank); }
  for (let day = 1; day <= days; day++) {
    const date = `${month}-${String(day).padStart(2, '0')}`, available = researchSessions.has(date);
    const button = document.createElement('button'); button.type = 'button'; button.textContent = day; button.disabled = !available;
    button.setAttribute('aria-label', `${date.split('-').reverse().join('/')}${available ? ' · Datos disponibles' : ' · Sin datos cargados'}`);
    if (available) {
      button.dataset.researchDate = date; button.setAttribute('aria-pressed', String(researchData?.date === date));
      button.addEventListener('click', () => selectResearchDay(date));
    }
    calendar.append(button);
  }
}

function initializeResearchPane(pane) {
  const canvas = document.getElementById(pane.canvas);
  canvas.addEventListener('wheel', event => {
    if (!researchData || !event.deltaY) return;
    event.preventDefault();
    const bounds = canvas.getBoundingClientRect();
    const anchor = Math.max(0, Math.min(1, (event.clientX - bounds.left - 12) / (bounds.width - 77)));
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1);
    zoomResearch(Math.exp(Math.max(-240, Math.min(240, delta)) * .003), anchor);
  }, { passive: false });
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !researchData || !pane.geometry || researchDrag) return;
    const bounds = canvas.getBoundingClientRect(), geometry = pane.geometry;
    const px = event.clientX - bounds.left, py = event.clientY - bounds.top;
    if (px < geometry.left || py < geometry.top || py > geometry.volumeBottom) return;
    const price = px >= geometry.right && py <= geometry.bottom;
    if (px >= geometry.right && !price) return;
    event.preventDefault();
    researchDrag = { canvas: pane.canvas, pointerId: event.pointerId, type: price ? 'price' : 'pan', x: event.clientX, y: event.clientY,
      start: researchStart, window: researchWindow, width: geometry.right - geometry.left, low: geometry.low, high: geometry.high };
    clearResearchHover(); canvas.setPointerCapture(event.pointerId); canvas.style.cursor = price ? 'ns-resize' : 'grabbing';
  });
  canvas.addEventListener('pointermove', event => {
    const bounds = canvas.getBoundingClientRect();
    if (researchDrag) {
      if (event.pointerId !== researchDrag.pointerId || researchDrag.canvas !== pane.canvas) return;
      if (researchDrag.type === 'pan') panResearch(researchDrag.start - (event.clientX - researchDrag.x) / researchDrag.width * researchDrag.window);
      else {
        const center = (researchDrag.high + researchDrag.low) / 2;
        const half = (researchDrag.high - researchDrag.low) / 2 * Math.exp(Math.max(-4, Math.min(4, (event.clientY - researchDrag.y) * .012)));
        pane.priceRange = { low: center - half, high: center + half }; scheduleResearchChart();
      }
      return;
    }
    const px = event.clientX - bounds.left, py = event.clientY - bounds.top;
    const overAxis = pane.geometry && px >= pane.geometry.right && py >= pane.geometry.top && py <= pane.geometry.bottom;
    canvas.style.cursor = overAxis ? 'ns-resize' : 'crosshair';
    pane.hover = !overAxis && px >= 12 && px < bounds.width - 65 && py >= 20 && py < bounds.height - 32
      ? { x: Math.max(0, Math.min(.999999, (px - 12) / (bounds.width - 77))), y: py } : null;
    scheduleResearchChart();
  });
  const finishDrag = event => {
    if (!researchDrag || event.pointerId !== researchDrag.pointerId || researchDrag.canvas !== pane.canvas) return;
    researchDrag = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    canvas.style.cursor = 'crosshair'; scheduleResearchChart();
  };
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, finishDrag);
  canvas.addEventListener('dblclick', event => {
    const bounds = canvas.getBoundingClientRect();
    if (pane.geometry && event.clientX - bounds.left >= pane.geometry.right) { pane.priceRange = null; drawResearchChart(); }
  });
  canvas.addEventListener('pointerleave', () => { if (!researchDrag) pane.hover = null; scheduleResearchChart(); });
  canvas.addEventListener('keydown', event => {
    if (!researchData || !['ArrowLeft', 'ArrowRight', '+', '-'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === '+' || event.key === '-') zoomResearch(event.key === '+' ? .5 : 2);
    else panResearch(researchStart + (event.key === 'ArrowRight' ? 1 : -1) * Math.max(1, Math.round(researchWindow / 10)));
  });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(scheduleResearchChart).observe(document.getElementById(pane.container));
}

async function initializeResearch() {
  for (const [id, offset] of [['research-month-prev', -1], ['research-month-next', 1]]) {
    document.getElementById(id).addEventListener('click', () => {
      if (!researchMonth) return;
      const [year, month] = researchMonth.split('-').map(Number);
      renderResearchCalendar(new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 7));
    });
  }
  const scroll = document.getElementById('research-position');
  scroll.addEventListener('scroll', () => {
    if (!researchData || researchWindow >= researchSpan) return;
    const maxScroll = scroll.scrollWidth - scroll.clientWidth;
    const next = maxScroll > 0 ? Math.round(scroll.scrollLeft / maxScroll * (researchSpan - researchWindow)) : 0;
    if (next !== researchStart) panResearch(next);
  });
  for (const pane of Object.values(researchCharts)) initializeResearchPane(pane);
  if (typeof ResizeObserver === 'undefined') window.addEventListener('resize', scheduleResearchChart);
  scheduleResearchChart();
  try {
    const response = await fetch('data/research/sessions.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const index = await response.json();
    if (index.symbol !== 'NVDA' || index.timezone !== 'America/New_York' || index.interval !== '1m' || !index.sessions?.length) throw new Error('Invalid calendar');
    for (const session of index.sessions) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(session.date) || !/^nvda-\d{4}-\d{2}-\d{2}-1m\.json$/.test(session.file)
        || (session.secondsFile && !/^nvda-\d{4}-\d{2}-\d{2}-1s\.json$/.test(session.secondsFile)) || !session.version || researchSessions.has(session.date)) throw new Error('Invalid session index');
      researchSessions.set(session.date, session);
    }
    const months = [...new Set([...researchSessions.keys()].sort().map(date => date.slice(0, 7)))];
    for (const id of ['research-month-prev', 'research-month-next']) document.getElementById(id).disabled = false;
    renderResearchCalendar(months.at(-1));
  } catch {
    document.getElementById('research-availability').textContent = 'No se pudo cargar el calendario.';
    document.getElementById('research-status').textContent = 'Recarga la página para reintentar.';
  }
}

// Research temporarily disabled.
// document.addEventListener('DOMContentLoaded', initializeResearch);
