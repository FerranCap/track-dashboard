'use strict';

const $ = id => document.getElementById(id);
const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const numberFormatter = new Intl.NumberFormat('es-ES');
let dataset = null;
let filtered = [];
let page = 0;
const pageSize = 50;

function money(value) { return formatter.format(value || 0); }
function signed(value) { return `${value > 0 ? '+' : ''}${money(value)}`; }
function sum(rows) { return rows.reduce((total, row) => total + row.pnl, 0); }
function cssSign(value) { return value > 0 ? 'positive' : value < 0 ? 'negative' : ''; }
function xmlEscape(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function aggregate(rows, getKey) {
  const grouped = new Map();
  for (const trade of rows) grouped.set(getKey(trade), (grouped.get(getKey(trade)) || 0) + trade.pnl);
  return [...grouped].sort((a,b) => a[0].localeCompare(b[0]));
}
function renderStats(rows) {
  const positive = rows.filter(t => t.pnl > 0);
  const negative = rows.filter(t => t.pnl < 0);
  const total = sum(rows);
  const wins = sum(positive);
  const losses = Math.abs(sum(negative));
  const daily = aggregate(rows, t => t.date);
  const best = daily.length ? Math.max(...daily.map(x => x[1])) : 0;
  const worst = daily.length ? Math.min(...daily.map(x => x[1])) : 0;
  const info = [
    ['PnL total',signed(total),`${daily.length} días con operaciones`,cssSign(total)],
    ['Operaciones',numberFormatter.format(rows.length),'Operaciones únicas',''],
    ['Win rate',`${rows.length ? (positive.length / rows.length * 100).toFixed(1) : '0.0'}%`,`${positive.length} ganadoras · ${negative.length} perdedoras`,''],
    ['Media por trade',signed(rows.length ? total / rows.length : 0),'Expectativa realizada',cssSign(total)],
    ['Profit factor',losses ? (wins/losses).toFixed(2) : (wins ? '∞' : '—'),'Ganancias / pérdidas brutas',''],
    ['Mejor / peor día',`${money(best)} / ${money(worst)}`,'PnL diario','']
  ];
  $('stats').innerHTML = info.map(([label,value,detail,style]) => `<div class="stat"><div class="label">${label}</div><div class="value ${style}">${xmlEscape(value)}</div><div class="detail">${xmlEscape(detail)}</div></div>`).join('');
}
function svgPlot(data, mode = 'line') {
  if (!data.length) return '<span>Sin operaciones para los filtros seleccionados</span>';
  const W = 760, H = 265, l = 75, r = 18, t = 17, b = 34;
  const values = data.map(x => x[1]);
  const minV = Math.min(0,...values), maxV = Math.max(0,...values);
  const extent = maxV - minV || 1;
  const x = i => l + (i+.5) * (W-l-r)/data.length;
  const y = v => t + (maxV-v)/extent*(H-t-b);
  const steps = Array.from({length:5},(_,i) => minV + extent*i/4);
  let shapes = `<line x1="${l}" y1="${y(0)}" x2="${W-r}" y2="${y(0)}" stroke="#58708a" stroke-width="1"/>`;
  shapes += steps.map(v => `<line x1="${l}" x2="${W-r}" y1="${y(v)}" y2="${y(v)}" stroke="#2a3748" stroke-dasharray="3 5"/><text x="${l-10}" y="${y(v)+4}" fill="#8192a8" text-anchor="end" font-size="11">${xmlEscape(Number(v.toFixed(0)).toLocaleString('en-US'))}</text>`).join('');
  if (mode === 'line') {
    const pts = data.map((p,i) => `${x(i)},${y(p[1])}`).join(' ');
    shapes += `<polyline fill="none" stroke="#5397ff" stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round" points="${pts}"/>`;
    if (data.length === 1) shapes += `<circle cx="${x(0)}" cy="${y(values[0])}" r="4" fill="#5397ff"/>`;
  } else {
    const width = Math.max(1, (W-l-r)/data.length*.7);
    shapes += data.map((p,i) => `<rect x="${x(i)-width/2}" y="${Math.min(y(p[1]),y(0))}" width="${width}" height="${Math.max(1,Math.abs(y(p[1])-y(0)))}" fill="${p[1]>=0 ? '#30bd8c' : '#e5677b'}"><title>${xmlEscape(p[0])}: ${xmlEscape(money(p[1]))}</title></rect>`).join('');
  }
  const n = Math.min(data.length, 7);
  for (let i=0;i<n;i++) {
    const idx = n===1 ? 0 : Math.round(i*(data.length-1)/(n-1));
    shapes += `<text x="${x(idx)}" y="${H-9}" fill="#8597ab" font-size="11" text-anchor="middle">${xmlEscape(data[idx][0].slice(0,10))}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${mode === 'line' ? 'Gráfico acumulado' : 'Gráfico de barras'}" preserveAspectRatio="none">${shapes}</svg>`;
}
function renderCharts(rows) {
  const daily = aggregate(rows, t => t.date);
  let running = 0;
  $('equity-chart').innerHTML = svgPlot(daily.map(([date,value]) => [date, +(running += value).toFixed(4)]));
  $('daily-chart').innerHTML = svgPlot(daily.slice(-45), 'bar');
  $('months-chart').innerHTML = svgPlot(aggregate(rows, t => t.date.slice(0,7)), 'bar');
  const count = new Map();
  for (const t of rows) count.set(t.symbol, (count.get(t.symbol) || 0)+1);
  const top = [...count].sort((a,b) => b[1]-a[1]).slice(0,12).map(x=>x[0]);
  const symbols = aggregate(rows.filter(t => top.includes(t.symbol)), t => t.symbol);
  $('symbols-chart').innerHTML = svgPlot(symbols, 'bar');
}
function populateFilters(rows) {
  const years = [...new Set(rows.map(t => t.date.slice(0,4)))].sort().reverse();
  const symbols = [...new Set(rows.map(t => t.symbol))].sort();
  $('year').innerHTML = '<option value="all">Todos</option>'+years.map(x=>`<option value="${xmlEscape(x)}">${xmlEscape(x)}</option>`).join('');
  $('symbol').innerHTML = '<option value="all">Todos</option>'+symbols.map(x=>`<option value="${xmlEscape(x)}">${xmlEscape(x)}</option>`).join('');
}
function applyFilters() {
  if (!dataset) return;
  const year = $('year').value, symbol = $('symbol').value, side = $('side').value;
  const from = $('date-from').value, to = $('date-to').value;
  filtered = dataset.trades.filter(t => (year==='all'||t.date.startsWith(year)) && (symbol==='all'||t.symbol===symbol) && (side==='all'||t.side===side) && (!from||t.date>=from) && (!to||t.date<=to));
  page=0;
  renderStats(filtered);
  renderCharts(filtered);
  renderTable();
}
function renderTable() {
  const query = $('search').value.trim().toLowerCase();
  const matches = query ? filtered.filter(t => t.symbol.toLowerCase().includes(query)) : filtered;
  const maxPage = Math.max(0,Math.ceil(matches.length/pageSize)-1);
  page=Math.min(page,maxPage);
  const rows=matches.slice().reverse().slice(page*pageSize,(page+1)*pageSize);
  $('trade-rows').innerHTML=rows.length ? rows.map(t=>`<tr><td>${xmlEscape(t.date)}</td><td><strong>${xmlEscape(t.symbol)}</strong></td><td><span class="pill ${t.side==='SELL'?'short':''}">${t.side==='BUY'?'LONG':t.side==='SELL'?'SHORT':xmlEscape(t.side)}</span></td><td>${xmlEscape(t.opened.slice(11,19))}</td><td>${xmlEscape(t.closed.slice(11,19))}</td><td class="number ${cssSign(t.pnl)}">${xmlEscape(signed(t.pnl))}</td></tr>`).join('') : '<tr><td colspan="6">No hay operaciones</td></tr>';
  $('table-count').textContent=`${numberFormatter.format(matches.length)} operaciones`;
  $('pagination-info').textContent= matches.length ? `${page*pageSize+1}–${Math.min((page+1)*pageSize,matches.length)} de ${matches.length}` : '0 operaciones';
  $('prev').disabled=page<=0;
  $('next').disabled=page>=maxPage;
}
async function loadData() {
  $('source-status').textContent='Actualizando…';
  $('refresh').disabled=true;
  $('error').hidden=true;
  try {
    const response=await fetch(`data/trades.json?v=${Date.now()}`, {cache:'no-store'});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const next=await response.json();
    if (!Array.isArray(next.trades)) throw new Error('Formato de datos incorrecto');
    dataset=next;
    populateFilters(dataset.trades);
    $('search').value='';
    $('year').value='all'; $('side').value='all';
    $('date-from').value=''; $('date-to').value='';
    $('last-updated').textContent=`Datos generados: ${new Date(next.generatedAt).toLocaleString('es-ES')}`;
    $('dataset-info').textContent=`${next.tradeCount} operaciones · ${next.executionRows} ejecuciones · ${next.sourceFiles.length} CSV compatibles`;
    $('source-status').textContent='Datos cargados';
    if (next.unsupportedFiles.length || next.inconsistentIds) {
      $('error').hidden=false;
      $('error').textContent=`Aviso: ${next.unsupportedFiles.length ? 'CSV ignorados por formato incompatible: '+next.unsupportedFiles.join(', ')+'. ' : ''}${next.inconsistentIds ? next.inconsistentIds+' IDs con valores contradictorios entre exportaciones.' : ''}`;
    }
    applyFilters();
  } catch(error) {
    $('source-status').textContent='Error de carga';
    $('error').hidden=false;
    $('error').textContent=`No se pudo cargar data/trades.json (${error.message}). Ejecuta scripts/build_data.py o comprueba que GitHub Actions haya terminado.`;
  } finally { $('refresh').disabled=false; }
}
for (const id of ['year','symbol','side','date-from','date-to']) $(id).addEventListener('change',applyFilters);
$('clear').addEventListener('click',()=> { $('year').value='all';$('symbol').value='all';$('side').value='all';$('date-from').value='';$('date-to').value='';applyFilters(); });
$('search').addEventListener('input',()=>{page=0;renderTable();});
$('prev').addEventListener('click',()=>{page--;renderTable();});
$('next').addEventListener('click',()=>{page++;renderTable();});
$('refresh').addEventListener('click',loadData);
loadData();
