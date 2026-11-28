'use strict';

const tradePriceCache = new Map();
const tradePriceClock = new Intl.DateTimeFormat('es-ES', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
let tradePriceRequest = 0;
const tradePriceSources = new Map();
let watchlistPriceSource = 'databento:XNAS.BASIC';
try { watchlistPriceSource = localStorage.getItem('track-watchlist-price-source') || watchlistPriceSource; } catch {}
const tradePriceMargin = 15;
let tradePriceRows = [];

function resetTradePriceData() {
  tradePriceRequest++;
  tradePriceCache.clear();
}

function fetchPriceFile(path) {
  if (!tradePriceCache.has(path)) {
    const request = fetch(path).then(response => {
      if (!response.ok) throw new Error(`Price data HTTP ${response.status}`);
      return response.json();
    }).catch(error => { tradePriceCache.delete(path); throw error; });
    tradePriceCache.set(path, request);
  }
  return tradePriceCache.get(path);
}

function tradePriceDate(trade) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(trade.opened));
}

function tradePriceWindow(input) {
  const trades = Array.isArray(input) ? input : [input];
  if (!trades.length) throw new Error('Empty trade interval');
  const intervals = trades.map(trade => {
    const opened = Date.parse(trade.opened) / 1000, closed = Date.parse(trade.closed) / 1000;
    if (!Number.isFinite(opened) || !Number.isFinite(closed) || closed < opened) throw new Error('Invalid trade interval');
    return { opened, closed };
  });
  const opened = Math.min(...intervals.map(item => item.opened));
  const closed = Math.max(...intervals.map(item => item.closed));
  return { start: Math.floor(opened / 60) * 60 - tradePriceMargin * 60, end: Math.floor(closed / 60) * 60 + (tradePriceMargin + 1) * 60, opened, closed, intervals };
}

function tradePriceBars(payload, input, fullSession = false) {
  const trades = Array.isArray(input) ? input : [input];
  if (!trades.length || payload.schemaVersion !== 1 || payload.interval !== '1m' || !Array.isArray(payload.bars) || trades.some(trade => payload.symbol !== trade.symbol || payload.date !== tradePriceDate(trade))) throw new Error('Price series does not match the trades');
  const window = tradePriceWindow(trades);
  let previous = -Infinity;
  const bars = payload.bars.map(bar => {
    const value = { time: bar.time, volume: bar.volume, ...Object.fromEntries(['open', 'high', 'low', 'close'].map(key => [key, Number(bar[key])])) };
    if (!Number.isInteger(value.time) || value.time % 60 || value.time <= previous || !Number.isSafeInteger(value.volume) || value.volume < 0 || !['open', 'high', 'low', 'close'].every(key => Number.isFinite(value[key]) && value[key] > 0) || value.low > Math.min(value.open, value.close) || value.high < Math.max(value.open, value.close)) throw new Error('Invalid chart bar');
    previous = value.time;
    return value;
  });
  if (fullSession && bars.length) {
    window.start = Math.min(window.start, bars[0].time);
    window.end = Math.max(window.end, bars.at(-1).time + 60);
  }
  return { bars: bars.filter(bar => bar.time >= window.start && bar.time < window.end), window };
}

function tradePriceFills(payload, trade) {
  const entry = payload?.trades?.[trade.id];
  if (!entry || entry.opened !== trade.opened || entry.closed !== trade.closed || entry.symbol !== trade.symbol) return { complete: false, fills: [] };
  const fills = entry.fills.filter(fill => ['entry', 'exit'].includes(fill.role) && ['BUY', 'SELL'].includes(fill.side) && Number.isFinite(Number(fill.price)) && Number(fill.price) > 0 && Number(fill.quantity) > 0 && fill.time >= Date.parse(trade.opened) / 1000 && fill.time <= Date.parse(trade.closed) / 1000);
  return { complete: entry.complete && fills.length === entry.fills.length, fills };
}

function priceChartSvg(bars, window, fills, title, trades = [], compactWidth = 0) {
  const compact = compactWidth > 0;
  const width = compact ? Math.max(600, Math.round(compactWidth)) : 1000, left = compact ? 60 : 107, right = width - (compact ? 20 : 42);
  const x = time => left + (time - window.start) / (window.end - window.start) * (right - left);
  const lanes = [];
  const labels = trades.map(trade => {
    const label = signed(trade.pnl);
    const halfWidth = Math.max(30, label.length * 6.5);
    const center = Math.max(left + halfWidth, Math.min(right - halfWidth, x((Date.parse(trade.opened) + Date.parse(trade.closed)) / 2000)));
    return { trade, label, center, halfWidth };
  }).sort((a, b) => a.center - b.center).map(item => {
    let lane = lanes.findIndex(end => end + 8 <= item.center - item.halfWidth);
    if (lane < 0) lane = lanes.length;
    lanes[lane] = item.center + item.halfWidth;
    return { ...item, lane };
  });
  const laneHeight = compact ? 13 : 26;
  const offset = lanes.length * laneHeight;
  const height = (compact ? 350 : 500) + offset, top = (compact ? 14 : 36) + offset, bottom = (compact ? 238 : 360) + offset, volumeTop = (compact ? 255 : 385) + offset, volumeBottom = (compact ? 320 : 450) + offset;
  const prices = [...bars.flatMap(bar => [bar.low, bar.high]), ...fills.map(fill => Number(fill.price))];
  const minimum = Math.min(...prices), maximum = Math.max(...prices);
  const padding = Math.max((maximum - minimum) * .15, maximum * .001, .00001);
  const low = minimum - padding, high = maximum + padding;
  const y = price => bottom - (price - low) / (high - low) * (bottom - top);
  const candleWidth = Math.min(18, (right - left) / ((window.end - window.start) / 60) * .68);
  const price = value => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  const clock = time => tradePriceClock.format(new Date(time * 1000));
  const maxVolume = Math.max(1, ...bars.map(bar => bar.volume));
  let svg = `<svg class="trade-candle-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><rect x="${left}" y="${top}" width="${right-left}" height="${volumeBottom-top}" fill="#101b2b"/>`;
  for (const item of labels) {
    const color = item.trade.pnl > 0 ? '#36d49b' : item.trade.pnl < 0 ? '#ff8190' : '#a6b9ce';
    svg += `<text class="trade-pnl-label" x="${item.center}" y="${top - 8 - item.lane * laneHeight}" text-anchor="middle" fill="${color}" font-size="21"><title>${esc(`Resultado del trade: ${item.label}`)}</title>${esc(item.label)}</text>`;
  }
  for (const interval of window.intervals) svg += `<rect x="${x(interval.opened)}" y="${top}" width="${Math.max(1,x(interval.closed)-x(interval.opened))}" height="${bottom-top}" fill="#7caaff" opacity=".07"/>`;
  for (let i = 0; i <= 4; i++) {
    const value = low + (high - low) * i / 4;
    svg += `<line x1="${left}" x2="${right}" y1="${y(value)}" y2="${y(value)}" stroke="#26354a"/><text x="17" y="${y(value)+7}" text-anchor="start" fill="#a6b9ce" font-size="21">${price(value)}</text>`;
  }
  for (let i = 0; i <= 5; i++) {
    const time = window.start + (window.end - window.start) * i / 5;
    svg += `<text x="${x(time)}" y="${(compact ? 340 : 480) + offset}" text-anchor="${i===0?'start':i===5?'end':'middle'}" fill="#a6b9ce" font-size="21">${clock(time)}</text>`;
  }
  for (const bar of bars) {
    const cx = x(bar.time + 30), color = bar.close >= bar.open ? '#36d49b' : '#ff6c81';
    const tip = `${clock(bar.time)} NY · O ${price(bar.open)} · H ${price(bar.high)} · L ${price(bar.low)} · C ${price(bar.close)} · Vol ${bar.volume.toLocaleString('es-ES')}`;
    const volumeHeight = bar.volume / maxVolume * (volumeBottom-volumeTop);
    svg += `<g><title>${esc(tip)}</title><line x1="${cx}" x2="${cx}" y1="${y(bar.high)}" y2="${y(bar.low)}" stroke="${color}" stroke-width="1.3"/><rect x="${cx-candleWidth/2}" y="${Math.min(y(bar.open),y(bar.close))}" width="${candleWidth}" height="${Math.max(1.3,Math.abs(y(bar.open)-y(bar.close)))}" fill="${color}"/><rect x="${cx-candleWidth/2}" y="${volumeBottom-volumeHeight}" width="${candleWidth}" height="${Math.max(.5,volumeHeight)}" fill="${color}" opacity=".5"/></g>`;
  }
  for (const interval of window.intervals) for (const [time, color] of [[interval.opened, '#f6c66b'], [interval.closed, '#87b8ff']]) svg += `<line x1="${x(time)}" x2="${x(time)}" y1="${top}" y2="${volumeBottom}" stroke="${color}" stroke-dasharray="4 5" opacity=".65"/>`;
  for (const fill of fills) {
    const cx = x(fill.time), cy = y(Number(fill.price)), entry = fill.role === 'entry', color = fill.side === 'BUY' ? '#baff45' : '#ff5252';
    const direction = fill.side === 'BUY' ? 1 : -1;
    const tip = `${entry?'Entrada':'Salida'} · ${fill.side==='BUY'?'Compra':'Venta'} · ${new Date(fill.time*1000).toLocaleTimeString('es-ES',{timeZone:'America/New_York',hourCycle:'h23'})} NY · ${fill.quantity} acciones · $${fill.price}`;
    const markerHalfWidth = compact ? 3 : 6, markerHeight = compact ? 5 : 10;
    svg += `<path class="trade-fill-marker" d="M ${cx} ${cy} l -${markerHalfWidth} ${direction*markerHeight} h ${markerHalfWidth*2} Z" fill="${color}" stroke="#ffffff" stroke-width="${compact ? .75 : 1.5}"><title>${esc(tip)}</title></path>`;
  }
  svg += `<line class="trade-price-crosshair" x1="0" x2="0" y1="${top}" y2="${volumeBottom}" stroke="#b8cce8" stroke-dasharray="3 4" visibility="hidden"/></svg>`;
  return svg;
}

function calendarPriceMarkup(index) {
  const controls = `<div class="trade-price-heading"><label>Fuente<select class="trade-price-source" disabled></select></label><button class="trade-price-retry secondary" type="button" aria-label="Recargar precios" title="Recargar precios"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M20 7v5h-5M20 12a8 8 0 1 0-2.3 5.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>`;
  const settings = String(index).startsWith('watchlist-') ? controls : `<details class="calendar-price-settings"><summary aria-label="Configuración del gráfico" title="Configuración del gráfico"><svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v2m0 15v2M2.5 12h2m15 0h2M5.3 5.3l1.4 1.4m10.6 10.6 1.4 1.4m0-13.4-1.4 1.4M6.7 17.3l-1.4 1.4"/><circle cx="12" cy="12" r="7.5"/></g></svg></summary><div class="calendar-price-settings-panel">${controls}</div></details>`;
  return `<section id="calendar-ticker-price-${index}" class="calendar-ticker-price" aria-label="Velas y ejecuciones del ticker"><div class="trade-price-chart" tabindex="0" role="region" aria-label="Velas de un minuto y todas las ejecuciones del ticker"></div><p class="trade-price-status mini-caption" role="status"></p>${settings}</section>`;
}

async function renderWatchlistPriceChart(panel, trades) {
  if (!panel || !trades.length) return;
  const select = panel.querySelector('.trade-price-source');
  const status = panel.querySelector('.trade-price-status');
  const host = panel.querySelector('.trade-price-chart');
  const symbol = trades[0].symbol, date = tradePriceDate(trades[0]);
  panel.refreshWatchlistPrice = () => renderWatchlistPriceChart(panel, trades);
  const token = Symbol('watchlist chart');
  panel.priceRequest = token;
  const current = () => panel.isConnected && panel.priceRequest === token;
  panel.querySelector('.trade-price-retry').onclick = () => { tradePriceCache.clear(); renderWatchlistPriceChart(panel, trades); };
  status.textContent = 'Cargando datos de precios…';
  host.replaceChildren();
  host.ondblclick = null;
  host.title = '';
  select.disabled = true;
  try {
    const index = await fetchPriceFile('data/prices/index.json');
    if (!current()) return;
    if (index.schemaVersion !== 1 || index.interval !== '1m') throw new Error('Invalid price index');
    const session = index.tickers?.[symbol]?.[date];
    const sources = session?.sources || [];
    if (!sources.length) {
      select.innerHTML = '<option>Sin fuentes disponibles</option>';
      status.textContent = 'No hay velas de un minuto guardadas para esta sesión.';
      return;
    }
    const preferredSource = panel.priceSourceOverride || watchlistPriceSource;
    let sourceId = preferredSource;
    if (!sources.some(source => source.id === sourceId)) sourceId = sources[0].id;
    select.innerHTML = sources.map(source => `<option value="${esc(source.id)}"${source.id === sourceId ? ' selected' : ''}>${esc(source.label)} · ${esc(source.dataset)}</option>`).join('');
    select.disabled = sources.length === 1;
    select.onchange = () => { panel.priceSourceOverride = select.value; return renderWatchlistPriceChart(panel, trades); };
    host.ondblclick = () => {
      if (select.disabled) return;
      select.value = sources[(sources.findIndex(item => item.id === sourceId) + 1) % sources.length].id;
      return select.onchange();
    };
    host.title = sources.length > 1 ? 'Doble clic para cambiar de fuente' : '';
    const source = sources.find(item => item.id === sourceId);
    const [payload, executionPayload] = await Promise.all([fetchPriceFile(source.file), fetchPriceFile(session.executionsFile).catch(() => null)]);
    if (!current()) return;
    if (payload.dataset !== source.dataset || payload.provider !== source.provider) throw new Error('Price source mismatch');
    const { bars, window } = tradePriceBars(payload, trades, true);
    const executions = trades.map(trade => tradePriceFills(executionPayload, trade));
    if (!bars.length) { status.textContent = 'Esta fuente no tiene velas en el intervalo de los trades.'; return; }
    let range = panel.querySelector('.watchlist-chart-range');
    if (!range) {
      range = document.createElement('div');
      range.className = 'watchlist-chart-range';
      range.innerHTML = '<span class="watchlist-chart-range-fill"></span><span class="watchlist-chart-range-time" hidden></span><input type="range" min="0" max="1000" value="0" aria-label="Inicio del intervalo del gráfico"><input type="range" min="0" max="1000" value="1000" aria-label="Final del intervalo del gráfico">';
      host.after(range);
    }
    const [lower, upper] = range.querySelectorAll('input');
    const fill = range.querySelector('.watchlist-chart-range-fill');
    const timeLabel = range.querySelector('.watchlist-chart-range-time');
    lower.value = '0';
    upper.value = '1000';
    let selectedStart = window.start, selectedEnd = window.end;
    const draw = () => {
      const width = host.clientWidth || panel.clientWidth;
      if (!current() || !width) return;
      panel.priceChartWidth = width;
      const visibleBars = bars.filter(bar => bar.time >= selectedStart && bar.time < selectedEnd);
      const visibleFills = executions.flatMap(item => item.fills).filter(item => item.time >= selectedStart && item.time < selectedEnd);
      const visibleTrades = trades.filter(trade => Date.parse(trade.opened) / 1000 < selectedEnd && Date.parse(trade.closed) / 1000 >= selectedStart);
      const visibleWindow = { ...window, start: selectedStart, end: selectedEnd, intervals: window.intervals.filter(interval => interval.opened < selectedEnd && interval.closed >= selectedStart).map(interval => ({ opened: Math.max(interval.opened, selectedStart), closed: Math.min(interval.closed, selectedEnd) })) };
      if (!visibleBars.length) { host.innerHTML = '<p class="mini-caption">Sin velas en este intervalo.</p>'; return; }
      host.innerHTML = priceChartSvg(visibleBars, visibleWindow, visibleFills, `${symbol} · ${date} · velas de un minuto`, visibleTrades, width);
    };
    const updateRange = (event, redraw = true) => {
      let start = Number(lower.value), end = Number(upper.value);
      if (start >= end) {
        if (event?.target === lower) start = end - 1;
        else end = start + 1;
      }
      lower.value = String(start); upper.value = String(end);
      fill.style.left = `${start / 10}%`;
      fill.style.right = `${100 - end / 10}%`;
      selectedStart = window.start + (window.end - window.start) * start / 1000;
      selectedEnd = window.start + (window.end - window.start) * end / 1000;
      if (event?.target === lower || event?.target === upper) {
        const value = event.target === lower ? start : end;
        const time = event.target === lower ? selectedStart : selectedEnd;
        const formatted = tradePriceClock.format(new Date(time * 1000));
        timeLabel.textContent = formatted;
        timeLabel.style.left = `${value / 10}%`;
        timeLabel.hidden = false;
        event.target.setAttribute('aria-valuetext', `${formatted} Nueva York`);
      }
      if (redraw) draw();
    };
    lower.oninput = upper.oninput = event => updateRange(event, false);
    lower.onpointerdown = upper.onpointerdown = event => updateRange(event, false);
    lower.onchange = upper.onchange = event => { updateRange(event); timeLabel.hidden = true; };
    lower.onpointerup = upper.onpointerup = lower.onblur = upper.onblur = () => { timeLabel.hidden = true; };
    panel.priceChartWidth = 0;
    panel.priceResizeObserver?.disconnect();
    panel.priceResizeObserver = new ResizeObserver(() => { if (host.clientWidth !== panel.priceChartWidth) draw(); });
    panel.priceResizeObserver.observe(host);
    updateRange();
    const minutes = new Set();
    for (const interval of window.intervals) for (let time = Math.floor(interval.opened / 60) * 60; time <= Math.floor(interval.closed / 60) * 60; time += 60) minutes.add(time);
    const available = bars.filter(bar => minutes.has(bar.time)).length;
    const fallback = sourceId !== preferredSource ? `Fuente elegida no disponible; se usa ${source.label} · ${source.dataset}.` : '';
    const incomplete = available < minutes.size || !executions.every(item => item.complete) ? `Datos incompletos: ${available}/${minutes.size} minutos operados con vela${executions.every(item => item.complete) ? '' : '; faltan ejecuciones'}.` : '';
    status.textContent = [fallback, incomplete].filter(Boolean).join(' ');
  } catch (error) {
    if (!current()) return;
    status.textContent = 'No se pudieron cargar los precios. Pulsa Reintentar.';
    console.error('Watchlist price chart:', error);
  }
}

function minutePnlCurve(trades, bars, executionGroups) {
  if (!executionGroups.every(group => group.complete)) return null;
  const entries = trades.map((trade, index) => ({ trade, fills: executionGroups[index].fills.slice().sort((a, b) => a.time - b.time) }));
  if (entries.some(({ trade }) => pnlDisplayUnit === 'r' && !sessionRiskAt(tradePriceDate(trade)))) return null;
  const start = Math.min(...trades.map(trade => Date.parse(trade.opened) / 1000));
  const end = Math.max(...trades.map(trade => Date.parse(trade.closed) / 1000));
  const times = [...new Set([start, end, ...bars.map(bar => bar.time + 60).filter(time => time > start && time < end), ...trades.map(trade => Date.parse(trade.closed) / 1000)])].sort((a, b) => a - b);
  return times.map(time => {
    const bar = bars.filter(item => item.time + 60 <= time).at(-1);
    let total = 0;
    for (const { trade, fills } of entries) {
      const opened = Date.parse(trade.opened) / 1000, closed = Date.parse(trade.closed) / 1000;
      if (time < opened) continue;
      if (time >= closed) { total += trade.pnl; continue; }
      if (!bar || bar.time + 60 < opened) continue;
      let cash = 0, quantity = 0;
      for (const fill of fills) if (fill.time <= time) {
        const signedQuantity = Number(fill.quantity) * (fill.side === 'BUY' ? 1 : -1);
        quantity += signedQuantity;
        cash -= signedQuantity * Number(fill.price);
      }
      const risk = pnlDisplayUnit === 'r' ? sessionRiskAt(tradePriceDate(trade)).risk : 1;
      total += (cash + quantity * bar.close) / risk;
    }
    return [new Date(time * 1000).toISOString(), total];
  });
}

async function renderCalendarTradeChart(rows = tradePriceRows) {
  tradePriceRows = rows;
  const request = ++tradePriceRequest;
  const groups = groupedStatistics(rows, trade => trade.symbol);
  const groupResults = await Promise.all(groups.map(async ([symbol, trades], index) => {
    const panel = document.getElementById(`calendar-ticker-price-${index}`);
    if (!panel) return;
    const settings = panel.closest('.calendar-symbol-card');
    const select = settings.querySelector('.trade-price-source');
    const status = panel.querySelector('.trade-price-status'), host = panel.querySelector('.trade-price-chart');
    const current = () => request === tradePriceRequest && panel.isConnected;
    const retry = settings.querySelector('.trade-price-retry');
    select.onchange = () => { tradePriceSources.set(symbol, select.value); return renderCalendarTradeChart(); };
    retry.onclick = () => { tradePriceCache.clear(); renderCalendarTradeChart(); };
    status.textContent = 'Cargando datos de precios…';
    host.replaceChildren();
    host.ondblclick = null;
    host.title = '';
    select.replaceChildren(); select.disabled = true;
    try {
      const priceIndex = await fetchPriceFile('data/prices/index.json');
      if (!current()) return;
      if (priceIndex.schemaVersion !== 1 || priceIndex.interval !== '1m') throw new Error('Invalid price index');
      const dates = [...new Set(trades.map(tradePriceDate))];
      const sessions = dates.map(date => priceIndex.tickers?.[symbol]?.[date]);
      const sources = (sessions[0]?.sources || []).filter(source => sessions.every(session => session?.sources?.some(item => item.id === source.id)));
      if (!sources.length) {
        select.innerHTML = '<option>Sin fuentes disponibles</option>';
        status.textContent = `No hay velas de 1 minuto guardadas para todos los trades de ${symbol} de este día.`;
        return;
      }
      let sourceId = tradePriceSources.get(symbol) || 'databento:XNAS.BASIC';
      if (!sources.some(source => source.id === sourceId)) sourceId = sources[0].id;
      tradePriceSources.set(symbol, sourceId);
      select.innerHTML = sources.map(source => `<option value="${esc(source.id)}"${source.id === sourceId ? ' selected' : ''}>${esc(source.label)} · ${esc(source.dataset)}</option>`).join('');
      select.disabled = sources.length === 1;
      host.ondblclick = () => {
        if (select.disabled) return;
        select.value = sources[(sources.findIndex(item => item.id === sourceId) + 1) % sources.length].id;
        return select.onchange();
      };
      host.title = sources.length > 1 ? 'Doble clic para cambiar de fuente' : '';
      const source = sources.find(item => item.id === sourceId);
      const results = await Promise.all(sessions.map(async (session, i) => {
        const dailySource = session.sources.find(item => item.id === sourceId);
        const [payload, executions] = await Promise.all([fetchPriceFile(dailySource.file), fetchPriceFile(session.executionsFile).catch(() => null)]);
        if (payload.dataset !== source.dataset || payload.provider !== source.provider) throw new Error('Price source mismatch');
        const dailyTrades = trades.filter(trade => tradePriceDate(trade) === dates[i]);
        const data = tradePriceBars(payload, dailyTrades);
        return { bars: data.bars, executions: dailyTrades.map(trade => tradePriceFills(executions, trade)) };
      }));
      if (!current()) return;
      const window = tradePriceWindow(trades);
      const bars = results.flatMap(result => result.bars).sort((a, b) => a.time - b.time);
      const executions = results.flatMap(result => result.executions);
      const fills = executions.flatMap(result => result.fills);
      if (!bars.length) { status.textContent = 'Esta fuente no tiene velas en el intervalo de los trades.'; return; }
      const title = `${symbol}, ${trades.length} trades, ${source.label}, velas de 1 minuto, ${tradePriceClock.format(new Date(window.start * 1000))} a ${tradePriceClock.format(new Date(window.end * 1000))}, hora de Nueva York`;
      host.innerHTML = priceChartSvg(bars, window, fills, title, trades);
      const minutes = new Set();
      for (const interval of window.intervals) for (let time = Math.floor(interval.opened / 60) * 60; time <= Math.floor(interval.closed / 60) * 60; time += 60) minutes.add(time);
      const available = bars.filter(bar => minutes.has(bar.time)).length;
      const incomplete = available < minutes.size || !executions.every(item => item.complete) ? `Datos incompletos: ${available}/${minutes.size} minutos operados con vela${executions.every(item => item.complete) ? '' : '; faltan ejecuciones'}.` : '';
      status.textContent = incomplete;
      const points = minutePnlCurve(trades, bars, executions);
      if (points) renderChart(`calendar-ticker-chart-${index}`, [{ values: points, color: '#29d17e' }], { currency: true, axisLeftRatio: 0.107, axisLabelStart: true, timeAxis: true, labels: points.map(point => tradePriceClock.format(new Date(point[0]))), explanation: 'Estimación intratrade con ejecuciones y cierres de velas de un minuto; costes y PnL registrados se reflejan al cerrar cada operación. No se rellenan velas ausentes.' });
      return points;
    } catch (error) {
      if (!current()) return;
      status.textContent = 'No se pudieron cargar los precios. Pulsa Reintentar.';
      console.error('Ticker price chart:', error);
    }
  }));
  if (request !== tradePriceRequest || !rows.length || !groupResults.some(Boolean)) return;
  const curves = groups.map(([, trades], index) => groupResults[index] || calendarPnlCurve(trades));
  const times = [...new Set(curves.flatMap(curve => curve.map(point => Date.parse(point[0]))))].sort((a, b) => a - b);
  const positions = curves.map(() => 0), values = curves.map(() => 0);
  const points = times.map(time => {
    for (let i = 0; i < curves.length; i++) {
      while (positions[i] < curves[i].length && Date.parse(curves[i][positions[i]][0]) <= time) values[i] = curves[i][positions[i]++][1];
    }
    return [new Date(time).toISOString(), values.reduce((sum, value) => sum + value, 0)];
  });
  renderChart('calendar-day-chart', [{ values: points, color: '#29d17e' }], { currency: true, timeAxis: true, timeTicks: true, explanation: 'PnL acumulado de la sesión. Donde hay velas y ejecuciones completas se estima el resultado intratrade; en los demás casos se muestra el PnL al cierre. Los costes y el resultado registrados se reflejan al cerrar cada operación.' });
}
