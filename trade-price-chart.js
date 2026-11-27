'use strict';

const tradePriceCache = new Map();
const tradePriceClock = new Intl.DateTimeFormat('es-ES', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
let tradePriceRequest = 0;
const tradePriceSources = new Map();
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

function tradePriceBars(payload, input) {
  const trades = Array.isArray(input) ? input : [input];
  if (!trades.length || payload.schemaVersion !== 1 || payload.interval !== '1m' || !Array.isArray(payload.bars) || trades.some(trade => payload.symbol !== trade.symbol || payload.date !== tradePriceDate(trade))) throw new Error('Price series does not match the trades');
  const window = tradePriceWindow(trades);
  let previous = -Infinity;
  const bars = payload.bars.map(bar => {
    const value = { time: bar.time, volume: bar.volume, ...Object.fromEntries(['open', 'high', 'low', 'close'].map(key => [key, Number(bar[key])])) };
    if (!Number.isInteger(value.time) || value.time % 60 || value.time <= previous || !Number.isSafeInteger(value.volume) || value.volume < 0 || !['open', 'high', 'low', 'close'].every(key => Number.isFinite(value[key]) && value[key] > 0) || value.low > Math.min(value.open, value.close) || value.high < Math.max(value.open, value.close)) throw new Error('Invalid chart bar');
    previous = value.time;
    return value;
  }).filter(bar => bar.time >= window.start && bar.time < window.end);
  return { bars, window };
}

function tradePriceFills(payload, trade) {
  const entry = payload?.trades?.[trade.id];
  if (!entry || entry.opened !== trade.opened || entry.closed !== trade.closed || entry.symbol !== trade.symbol) return { complete: false, fills: [] };
  const fills = entry.fills.filter(fill => ['entry', 'exit'].includes(fill.role) && ['BUY', 'SELL'].includes(fill.side) && Number.isFinite(Number(fill.price)) && Number(fill.price) > 0 && Number(fill.quantity) > 0 && fill.time >= Date.parse(trade.opened) / 1000 && fill.time <= Date.parse(trade.closed) / 1000);
  return { complete: entry.complete && fills.length === entry.fills.length, fills };
}

function priceChartSvg(bars, window, fills, title) {
  const width = 1000, height = 500, left = 72, right = 970, top = 36, bottom = 360, volumeTop = 385, volumeBottom = 450;
  const prices = [...bars.flatMap(bar => [bar.low, bar.high]), ...fills.map(fill => Number(fill.price))];
  const minimum = Math.min(...prices), maximum = Math.max(...prices);
  const padding = Math.max((maximum - minimum) * .15, maximum * .001, .00001);
  const low = minimum - padding, high = maximum + padding;
  const x = time => left + (time - window.start) / (window.end - window.start) * (right - left);
  const y = price => bottom - (price - low) / (high - low) * (bottom - top);
  const candleWidth = Math.min(18, (right - left) / ((window.end - window.start) / 60) * .68);
  const price = value => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 5 }).format(value);
  const clock = time => tradePriceClock.format(new Date(time * 1000));
  const maxVolume = Math.max(1, ...bars.map(bar => bar.volume));
  let svg = `<svg class="trade-candle-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><rect x="${left}" y="${top}" width="${right-left}" height="${volumeBottom-top}" fill="#101b2b"/>`;
  for (const interval of window.intervals) svg += `<rect x="${x(interval.opened)}" y="${top}" width="${Math.max(1,x(interval.closed)-x(interval.opened))}" height="${bottom-top}" fill="#7caaff" opacity=".07"/>`;
  for (let i = 0; i <= 4; i++) {
    const value = low + (high - low) * i / 4;
    svg += `<line x1="${left}" x2="${right}" y1="${y(value)}" y2="${y(value)}" stroke="#26354a"/><text x="${left-10}" y="${y(value)+4}" text-anchor="end" fill="#a6b9ce" font-size="11">${price(value)}</text>`;
  }
  svg += `<text x="${left}" y="23" fill="#a6b9ce" font-size="12">Precio · USD</text>`;
  for (let i = 0; i <= 5; i++) {
    const time = window.start + (window.end - window.start) * i / 5;
    svg += `<text x="${x(time)}" y="480" text-anchor="${i===0?'start':i===5?'end':'middle'}" fill="#a6b9ce" font-size="11">${clock(time)}</text>`;
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
    svg += `<path class="trade-fill-marker" d="M ${cx} ${cy} l -6 ${direction*10} h 12 Z" fill="${color}" stroke="#ffffff" stroke-width="1.5"><title>${esc(tip)}</title></path>`;
  }
  svg += `<line class="trade-price-crosshair" x1="0" x2="0" y1="${top}" y2="${volumeBottom}" stroke="#b8cce8" stroke-dasharray="3 4" visibility="hidden"/></svg>`;
  return svg;
}

function calendarPriceMarkup(index) {
  return `<section id="calendar-ticker-price-${index}" class="calendar-ticker-price" aria-label="Velas y ejecuciones del ticker"><div class="trade-price-heading"><p class="trade-price-summary mini-caption"></p><label>Fuente<select class="trade-price-source" disabled></select></label><button class="trade-price-retry secondary" type="button" aria-label="Reintentar" title="Reintentar"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M20 7v5h-5M20 12a8 8 0 1 0-2.3 5.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div><div class="trade-price-chart" tabindex="0" role="region" aria-label="Velas de un minuto y todas las ejecuciones del ticker"></div><p class="trade-price-status mini-caption" role="status"></p></section>`;
}

async function renderCalendarTradeChart(rows = tradePriceRows) {
  tradePriceRows = rows;
  const request = ++tradePriceRequest;
  const groups = groupedStatistics(rows, trade => trade.symbol);
  await Promise.all(groups.map(async ([symbol, trades], index) => {
    const panel = document.getElementById(`calendar-ticker-price-${index}`);
    if (!panel) return;
    const select = panel.querySelector('.trade-price-source');
    const status = panel.querySelector('.trade-price-status'), host = panel.querySelector('.trade-price-chart');
    const current = () => request === tradePriceRequest && panel.isConnected;
    const retry = panel.querySelector('.trade-price-retry');
    select.onchange = () => { tradePriceSources.set(symbol, select.value); renderCalendarTradeChart(); };
    retry.onclick = () => { tradePriceCache.clear(); renderCalendarTradeChart(); };
    status.textContent = 'Cargando datos de precios…';
    host.replaceChildren();
    select.replaceChildren(); select.disabled = true;
    panel.querySelector('.trade-price-summary').textContent = `${symbol} · ${trades.length} ${trades.length === 1 ? 'trade' : 'trades'} · ${signed(trades.reduce((total, trade) => total + trade.pnl, 0))}`;
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
      host.innerHTML = priceChartSvg(bars, window, fills, title);
      const minutes = new Set();
      for (const interval of window.intervals) for (let time = Math.floor(interval.opened / 60) * 60; time <= Math.floor(interval.closed / 60) * 60; time += 60) minutes.add(time);
      const available = bars.filter(bar => minutes.has(bar.time)).length;
      status.textContent = `${bars.length} velas · ${available}/${minutes.size} minutos operados con vela. ${executions.every(item => item.complete) ? `${fills.length} ejecuciones reales.` : 'Ejecuciones incompletas o no disponibles.'} Los huecos no se rellenan. Precios sin ajustar.`;
      readout.textContent = 'Pasa el cursor para ver OHLC y volumen.';
      bindPriceReadout(host, bars, window);
    } catch (error) {
      if (!current()) return;
      status.textContent = 'No se pudieron cargar los precios. Pulsa Reintentar.';
      console.error('Ticker price chart:', error);
    }
  }));
}
