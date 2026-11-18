'use strict';

const RESEARCH_DATE = '2026-10-01';
const researchTime = new Intl.DateTimeFormat('es-ES', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
let researchData = null;
let researchLoading = false;
let researchStart = 0;
let researchWindow = 0;
let researchSpan = 0;
let researchHover = null;

function researchClock(time) {
  return researchTime.format(new Date(time * 1000));
}

function drawResearchChart() {
  const canvas = document.getElementById('research-canvas');
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width) return;
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(bounds.width * scale);
  canvas.height = Math.round(bounds.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  const width = bounds.width, height = bounds.height;
  ctx.fillStyle = '#101b2a';
  ctx.fillRect(0, 0, width, height);
  ctx.font = '11px system-ui';
  if (!researchData) {
    ctx.fillStyle = '#96a9c1';
    ctx.fillText('Selecciona una sesión en el calendario', 20, 35);
    return;
  }
  const first = researchData.bars[0].time + researchStart * 60;
  const last = first + researchWindow * 60;
  const bars = researchData.bars.filter(bar => bar.time >= first && bar.time < last);
  const left = 12, right = width - 65, top = 20, bottom = height * .71;
  const volumeTop = height * .77, volumeBottom = height - 32;
  const priceBars = bars.length ? bars : researchData.bars;
  const min = Math.min(...priceBars.map(bar => Number(bar.low)));
  const max = Math.max(...priceBars.map(bar => Number(bar.high)));
  const padding = Math.max((max - min) * .07, .02);
  const low = min - padding, high = max + padding;
  const x = time => left + ((time - first) / 60 + .5) / researchWindow * (right - left);
  const y = price => bottom - (price - low) / (high - low) * (bottom - top);
  const bodyWidth = Math.max(.7, Math.min(12, (right - left) / researchWindow * .72));
  const maxVolume = Math.max(1, ...bars.map(bar => bar.volume));
  ctx.save();
  ctx.beginPath(); ctx.rect(left, top, right - left, volumeBottom - top); ctx.clip();
  for (const bar of bars) {
    const clock = researchClock(bar.time);
    if (clock < '09:30' || clock >= '16:00') {
      ctx.fillStyle = '#19263b';
      ctx.fillRect(x(bar.time) - (right - left) / researchWindow / 2, top, (right - left) / researchWindow + 1, volumeBottom - top);
    }
  }
  ctx.strokeStyle = '#29374b'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const py = top + i * (bottom - top) / 4;
    ctx.beginPath(); ctx.moveTo(left, py); ctx.lineTo(right, py); ctx.stroke();
  }
  for (const bar of bars) {
    const color = Number(bar.close) >= Number(bar.open) ? '#35ebb3' : '#ff6b7d';
    ctx.strokeStyle = color; ctx.fillStyle = color;
    const px = x(bar.time);
    ctx.beginPath(); ctx.moveTo(px, y(Number(bar.high))); ctx.lineTo(px, y(Number(bar.low))); ctx.stroke();
    ctx.fillRect(px - bodyWidth / 2, Math.min(y(Number(bar.open)), y(Number(bar.close))), bodyWidth, Math.max(1, Math.abs(y(Number(bar.open)) - y(Number(bar.close)))));
    ctx.globalAlpha = .65;
    const volumeHeight = bar.volume / maxVolume * (volumeBottom - volumeTop);
    ctx.fillRect(px - bodyWidth / 2, volumeBottom - volumeHeight, bodyWidth, volumeHeight);
    ctx.globalAlpha = 1;
  }
  if (researchHover !== null) {
    const target = first + Math.floor(researchHover * researchWindow) * 60;
    const bar = bars.find(bar => bar.time === target);
    ctx.strokeStyle = '#9bb4d0'; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x(target), top); ctx.lineTo(x(target), volumeBottom); ctx.stroke();
    document.getElementById('research-bar-details').textContent = bar
      ? `${researchClock(bar.time)} NY · O ${Number(bar.open).toFixed(2)} · H ${Number(bar.high).toFixed(2)} · L ${Number(bar.low).toFixed(2)} · C ${Number(bar.close).toFixed(2)} USD · Vol ${bar.volume.toLocaleString('es-ES')}`
      : `${researchClock(target)} NY · Sin operaciones`;
  }
  ctx.restore(); ctx.fillStyle = '#a6bad2';
  for (let i = 0; i <= 4; i++) ctx.fillText((high - i * (high - low) / 4).toFixed(2), right + 7, top + i * (bottom - top) / 4 + 4);
  ctx.fillText('Vol', left + 4, volumeTop - 5);
  const ticks = Math.max(2, Math.floor((right - left) / 85));
  for (let i = 0; i < ticks; i++) {
    const offset = Math.floor(i * researchWindow / (ticks - 1));
    const px = left + offset / researchWindow * (right - left);
    ctx.fillText(researchClock(first + offset * 60), Math.min(px, right - 32), height - 10);
  }
  const slider = document.getElementById('research-position');
  slider.max = Math.max(0, researchSpan - researchWindow);
  slider.value = researchStart;
  slider.disabled = researchWindow >= researchSpan;
}

async function loadResearchSession() {
  if (researchLoading) return;
  const status = document.getElementById('research-status');
  researchLoading = true;
  status.textContent = 'Cargando sesión…';
  try {
    if (!researchData) {
      const response = await fetch(`data/research/nvda-${RESEARCH_DATE}-1m.json`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.date !== RESEARCH_DATE || data.timezone !== 'America/New_York' || !data.bars?.length) throw new Error('Invalid session');
      researchData = data;
    }
    researchStart = 0;
    researchSpan = (researchData.bars.at(-1).time - researchData.bars[0].time) / 60 + 1;
    researchWindow = researchSpan;
    document.getElementById('research-session-day').setAttribute('aria-pressed', 'true');
    document.getElementById('research-chart-title').textContent = 'NVDA · 01/10/2026 · 1 minuto';
    status.textContent = `${researchClock(researchData.bars[0].time)}–${researchClock(researchData.bars.at(-1).time)} NY · ${researchData.bars.length} velas`;
    for (const id of ['research-zoom-in', 'research-zoom-out', 'research-reset']) document.getElementById(id).disabled = false;
    drawResearchChart();
  } catch {
    status.textContent = 'No se pudo cargar la sesión. Pulsa el día para reintentar.';
  } finally {
    researchLoading = false;
  }
}

function zoomResearch(factor) {
  if (!researchData) return;
  const next = Math.min(researchSpan, Math.max(Math.min(30, researchSpan), Math.round(researchWindow * factor)));
  researchStart = Math.max(0, Math.min(researchSpan - next, Math.round(researchStart + (researchWindow - next) / 2)));
  researchWindow = next;
  researchHover = null;
  drawResearchChart();
}

function initializeResearch() {
  const calendar = document.getElementById('research-calendar');
  for (const label of ['L', 'M', 'X', 'J', 'V', 'S', 'D']) {
    const weekday = document.createElement('span'); weekday.textContent = label; calendar.append(weekday);
  }
  for (let i = 0; i < 3; i++) { const blank = document.createElement('span'); blank.setAttribute('aria-hidden', 'true'); calendar.append(blank); }
  for (let day = 1; day <= 31; day++) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = day; button.disabled = day !== 1;
    button.setAttribute('aria-label', `${String(day).padStart(2, '0')}/10/2026${day === 1 ? ' · Datos disponibles' : ' · Sin datos cargados'}`);
    if (day === 1) {
      button.id = 'research-session-day'; button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', loadResearchSession);
    }
    calendar.append(button);
  }
  document.getElementById('research-zoom-in').addEventListener('click', () => zoomResearch(.5));
  document.getElementById('research-zoom-out').addEventListener('click', () => zoomResearch(2));
  document.getElementById('research-reset').addEventListener('click', () => { researchStart = 0; researchWindow = researchSpan; researchHover = null; drawResearchChart(); });
  document.getElementById('research-position').addEventListener('input', event => { researchStart = Number(event.target.value); researchHover = null; drawResearchChart(); });
  const canvas = document.getElementById('research-canvas');
  canvas.addEventListener('pointermove', event => {
    const bounds = canvas.getBoundingClientRect();
    researchHover = Math.max(0, Math.min(.999999, (event.clientX - bounds.left - 12) / (bounds.width - 77)));
    drawResearchChart();
  });
  canvas.addEventListener('pointerleave', () => { researchHover = null; drawResearchChart(); });
  canvas.addEventListener('keydown', event => {
    if (!researchData || !['ArrowLeft', 'ArrowRight', '+', '-'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === '+' || event.key === '-') zoomResearch(event.key === '+' ? .5 : 2);
    else { researchStart = Math.max(0, Math.min(researchSpan - researchWindow, researchStart + (event.key === 'ArrowRight' ? 1 : -1) * Math.max(1, Math.round(researchWindow / 10)))); drawResearchChart(); }
  });
  new ResizeObserver(drawResearchChart).observe(document.getElementById('research-chart'));
}
