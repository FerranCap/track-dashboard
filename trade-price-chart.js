'use strict';

const tradePriceCache = new Map();
const tradePriceClock = new Intl.DateTimeFormat('es-ES', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
let tradePriceRequest = 0;
let tradePriceSelection = '';
let tradePriceSource = 'databento:XNAS.BASIC';
let tradePriceMargin = 5;
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

function tradePriceWindow(trade, minutes = 5) {
  const opened = Date.parse(trade.opened) / 1000, closed = Date.parse(trade.closed) / 1000;
  if (!Number.isFinite(opened) || !Number.isFinite(closed) || closed < opened) throw new Error('Invalid trade interval');
  return { start: Math.floor(opened / 60) * 60 - minutes * 60, end: Math.floor(closed / 60) * 60 + (minutes + 1) * 60, opened, closed };
}

function tradePriceBars(payload, trade, minutes = 5) {
  if (payload.schemaVersion !== 1 || payload.interval !== '1m' || payload.symbol !== trade.symbol || payload.date !== tradePriceDate(trade) || !Array.isArray(payload.bars)) throw new Error('Price series does not match the trade');
  const window = tradePriceWindow(trade, minutes);
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
  const width = 1000, height = 410, left = 72, right = 970, top = 46, bottom = 285, volumeTop = 318, volumeBottom = 365;
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
  let svg = `<svg class="trade-candle-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><rect x="${left}" y="${top}" width="${right-left}" height="${volumeBottom-top}" fill="#101b2b"/><rect x="${x(window.opened)}" y="${top}" width="${Math.max(1,x(window.closed)-x(window.opened))}" height="${bottom-top}" fill="#7caaff" opacity=".07"/>`;
  for (let i = 0; i <= 4; i++) {
    const value = low + (high - low) * i / 4;
    svg += `<line x1="${left}" x2="${right}" y1="${y(value)}" y2="${y(value)}" stroke="#26354a"/><text x="${left-10}" y="${y(value)+4}" text-anchor="end" fill="#a6b9ce" font-size="11">${price(value)}</text>`;
  }
  svg += `<text x="${left}" y="23" fill="#a6b9ce" font-size="12">Precio · USD</text><text x="${left}" y="${volumeTop-9}" fill="#a6b9ce" font-size="11">Volumen por minuto · acciones</text>`;
  for (let i = 0; i <= 5; i++) {
    const time = window.start + (window.end - window.start) * i / 5;
    svg += `<text x="${x(time)}" y="391" text-anchor="${i===0?'start':i===5?'end':'middle'}" fill="#a6b9ce" font-size="11">${clock(time)}</text>`;
  }
  for (const bar of bars) {
    const cx = x(bar.time + 30), color = bar.close >= bar.open ? '#36d49b' : '#ff6c81';
    const tip = `${clock(bar.time)} NY · O ${price(bar.open)} · H ${price(bar.high)} · L ${price(bar.low)} · C ${price(bar.close)} · Vol ${bar.volume.toLocaleString('es-ES')}`;
    const volumeHeight = bar.volume / maxVolume * (volumeBottom-volumeTop);
    svg += `<g><title>${esc(tip)}</title><line x1="${cx}" x2="${cx}" y1="${y(bar.high)}" y2="${y(bar.low)}" stroke="${color}" stroke-width="1.3"/><rect x="${cx-candleWidth/2}" y="${Math.min(y(bar.open),y(bar.close))}" width="${candleWidth}" height="${Math.max(1.3,Math.abs(y(bar.open)-y(bar.close)))}" fill="${color}"/><rect x="${cx-candleWidth/2}" y="${volumeBottom-volumeHeight}" width="${candleWidth}" height="${Math.max(.5,volumeHeight)}" fill="${color}" opacity=".5"/></g>`;
  }
  for (const [time, color] of [[window.opened, '#f6c66b'], [window.closed, '#87b8ff']]) svg += `<line x1="${x(time)}" x2="${x(time)}" y1="${top}" y2="${volumeBottom}" stroke="${color}" stroke-dasharray="4 5" opacity=".65"/>`;
  for (const fill of fills) {
    const cx = x(fill.time), cy = y(Number(fill.price)), entry = fill.role === 'entry', color = entry ? '#f6c66b' : '#87b8ff';
    const direction = fill.side === 'BUY' ? 1 : -1;
    const tip = `${entry?'Entrada':'Salida'} · ${fill.side==='BUY'?'Compra':'Venta'} · ${new Date(fill.time*1000).toLocaleTimeString('es-ES',{timeZone:'America/New_York',hourCycle:'h23'})} NY · ${fill.quantity} acciones · $${fill.price}`;
    svg += `<path class="trade-fill-marker" d="M ${cx} ${cy} l -6 ${direction*10} h 12 Z" fill="${color}" stroke="#0b1320" stroke-width="1.3"><title>${esc(tip)}</title></path>`;
  }
  svg += `<line class="trade-price-crosshair" x1="0" x2="0" y1="${top}" y2="${volumeBottom}" stroke="#b8cce8" stroke-dasharray="3 4" visibility="hidden"/></svg>`;
  return svg;
}

function bindPriceReadout(host, bars, window) {
  const svg = host.querySelector('svg'), crosshair = host.querySelector('.trade-price-crosshair');
  const output = document.getElementById('calendar-price-readout');
  svg.addEventListener('pointermove', event => {
    const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    const x = point.matrixTransform(svg.getScreenCTM().inverse()).x;
    const time = window.start + (x - 72) / 898 * (window.end - window.start);
    const minute = Math.floor(time/60)*60, bar = bars.find(item => item.time === minute);
    if (x < 72 || x > 970) return;
    crosshair.setAttribute('x1', x); crosshair.setAttribute('x2', x); crosshair.setAttribute('visibility', 'visible');
    output.textContent = `${tradePriceClock.format(new Date(minute*1000))} NY · ${bar ? `O ${bar.open} · H ${bar.high} · L ${bar.low} · C ${bar.close} USD · Vol ${bar.volume.toLocaleString('es-ES')}` : 'Sin vela disponible en esta fuente'}`;
  });
  svg.addEventListener('pointerleave', () => crosshair.setAttribute('visibility', 'hidden'));
}

async function renderCalendarTradeChart(rows = tradePriceRows) {
  const panel = document.getElementById('calendar-price-panel');
  if (!panel) return;
  tradePriceRows = rows;
  const request = ++tradePriceRequest;
  panel.hidden = !rows.length;
  if (!rows.length) return;
  const select = document.getElementById('calendar-price-trade'), sourceSelect = document.getElementById('calendar-price-source');
  const status = document.getElementById('calendar-price-status'), host = document.getElementById('calendar-price-chart');
  status.textContent = 'Cargando datos de precios…';
  host.replaceChildren();
  sourceSelect.replaceChildren(); sourceSelect.disabled = true;
  document.getElementById('calendar-price-readout').textContent = '';
  try {
    const index = await fetchPriceFile('data/prices/index.json');
    if (request !== tradePriceRequest) return;
    if (index.schemaVersion !== 1 || index.interval !== '1m') throw new Error('Invalid price index');
    if (!rows.some(trade => trade.id === tradePriceSelection)) tradePriceSelection = (rows.find(trade => index.tickers?.[trade.symbol]?.[tradePriceDate(trade)]) || rows[0]).id;
    select.innerHTML = rows.map(trade => `<option value="${esc(trade.id)}"${trade.id === tradePriceSelection?' selected':''}>${esc(trade.symbol)} · ${trade.side === 'BUY'?'Long':'Short'} · ${esc(trade.opened.slice(11,19))}–${esc(trade.closed.slice(11,19))} NY</option>`).join('');
    const trade = rows.find(item => item.id === tradePriceSelection);
    const date = tradePriceDate(trade), session = index.tickers?.[trade.symbol]?.[date];
    document.getElementById('calendar-price-summary').textContent = `${trade.symbol} · ${date.split('-').reverse().join('/')} · ${trade.side === 'BUY'?'Long':'Short'} · ${signed(trade.pnl)} · ${tradePriceMargin} min de margen a cada lado`;
    if (!session?.sources?.length) {
      sourceSelect.innerHTML = '<option>Sin fuentes disponibles</option>';
      status.textContent = `No hay velas de 1 minuto guardadas para ${trade.symbol} el ${date.split('-').reverse().join('/')}.`;
      return;
    }
    if (!session.sources.some(source => source.id === tradePriceSource)) tradePriceSource = session.sources[0].id;
    sourceSelect.innerHTML = session.sources.map(source => `<option value="${esc(source.id)}"${source.id === tradePriceSource?' selected':''}>${esc(source.label)} · ${esc(source.dataset)}</option>`).join('');
    sourceSelect.disabled = false;
    const source = session.sources.find(item => item.id === tradePriceSource);
    const [payload, executionPayload] = await Promise.all([fetchPriceFile(source.file), fetchPriceFile(session.executionsFile).catch(() => null)]);
    if (request !== tradePriceRequest) return;
    if (payload.dataset !== source.dataset || payload.provider !== source.provider) throw new Error('Price source mismatch');
    const { bars, window } = tradePriceBars(payload, trade, tradePriceMargin);
    const { fills, complete } = tradePriceFills(executionPayload, trade);
    if (!bars.length) { status.textContent = 'Esta fuente no tiene velas en el intervalo del trade. Prueba otra fuente.'; return; }
    const title = `${trade.symbol}, ${source.label}, velas de 1 minuto, ${tradePriceClock.format(new Date(window.start*1000))} a ${tradePriceClock.format(new Date(window.end*1000))}, hora de Nueva York`;
    host.innerHTML = priceChartSvg(bars, window, fills, title);
    const available = bars.filter(bar => bar.time >= Math.floor(window.opened/60)*60 && bar.time <= Math.floor(window.closed/60)*60).length;
    const expected = Math.floor(window.closed/60)-Math.floor(window.opened/60)+1;
    status.textContent = `${bars.length} velas visibles · ${available}/${expected} minutos del trade con vela. ${complete ? `${fills.length} ejecuciones reales marcadas.` : 'Ejecuciones incompletas o no disponibles; no se estiman precios de salida.'} Los huecos no se rellenan. Fuentes separadas, precios USD sin ajustar.`;
    document.getElementById('calendar-price-readout').textContent = 'Pasa el cursor sobre las velas para ver OHLC y volumen. Horario de Nueva York.';
    bindPriceReadout(host, bars, window);
  } catch (error) {
    if (request !== tradePriceRequest) return;
    status.textContent = 'No se pudieron cargar los precios. Pulsa Reintentar.';
    console.error('Trade price chart:', error);
  }
}

function initializeTradePriceChart() {
  document.getElementById('calendar-price-trade').addEventListener('change', event => { tradePriceSelection = event.target.value; renderCalendarTradeChart(); });
  document.getElementById('calendar-price-source').addEventListener('change', event => { tradePriceSource = event.target.value; renderCalendarTradeChart(); });
  document.getElementById('calendar-price-margin').addEventListener('change', event => { tradePriceMargin = Number(event.target.value); renderCalendarTradeChart(); });
  document.getElementById('calendar-price-retry').addEventListener('click', () => { tradePriceCache.clear(); renderCalendarTradeChart(); });
}
