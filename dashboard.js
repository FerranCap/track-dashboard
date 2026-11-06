'use strict';

const $ = id => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing HTML element #${id}. Upload index.html and dashboard.js from the same release.`);
  return element;
};
const moneyFormat = new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'});
const integerFormat = new Intl.NumberFormat('es-ES');
const num = (v,d=2) => Number.isFinite(v) ? v.toFixed(d) : '—';
const money = v => Number.isFinite(v) ? moneyFormat.format(v) : '—';
const signed = v => Number.isFinite(v) ? `${v>0?'+':''}${money(v)}` : '—';
const sum = rows => rows.reduce((s,t)=>s+t.pnl,0);
const cssSign = v => v>0?'positive':v<0?'negative':'';
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const mean = a => a.length ? a.reduce((s,n)=>s+n,0)/a.length : 0;
const standardDeviation = a => a.length>1 ? Math.sqrt(a.reduce((s,n)=>s+(n-mean(a))**2,0)/(a.length-1)) : 0;
const pct = (a,b) => b ? `${num(a/b*100,1)}%` : '—';
let dataset=null, filtered=[], page=0;
let tradeTableSort = null;
const pageSize=50;
const EPSILON=0.000001;
function classify(t){return t.pnl>EPSILON?'win':t.pnl<-EPSILON?'loss':'scratch';}
function group(rows,fn){const m=new Map();for(const t of rows){const k=fn(t);m.set(k,(m.get(k)||0)+t.pnl);}return [...m].sort((a,b)=>String(a[0]).localeCompare(String(b[0])));}
function dates(rows){return [...new Set(rows.map(t=>t.date))].sort();}
function metric(label,value,kind='',detail=''){
  return `<div class="metric" tabindex="0" ${helpAttributes(helpText(label))}><div class="metric-label">${esc(label)}<span class="help-mark" aria-hidden="true">ⓘ</span></div><div class="metric-value ${kind}">${esc(value)}</div>${detail?`<div class="metric-detail">${esc(detail)}</div>`:''}</div>`;
}
function statistics(rows){
  const wins=rows.filter(t=>classify(t)==='win'),losses=rows.filter(t=>classify(t)==='loss'),scratches=rows.filter(t=>classify(t)==='scratch');
  const grossWin=sum(wins),grossLoss=Math.abs(sum(losses)),pnl=sum(rows);
  const daily=group(rows,t=>t.date),values=rows.map(t=>t.pnl),winAvg=mean(wins.map(t=>t.pnl)),lossAvg=mean(losses.map(t=>t.pnl));
  const winningRatio=rows.length?wins.length/rows.length:0;
  const payOff=lossAvg?winAvg/Math.abs(lossAvg):null;
  const expectancy=mean(values),sd=standardDeviation(values);
  const tradeStats=drawdownStats(rows);
  const netByDate=daily.map(x=>x[1]);
  const winLossChance=binomialPValue(wins.length,wins.length+losses.length);
  const kelly=payOff&&Number.isFinite(payOff)?(winningRatio-(1-winningRatio)/payOff)*100:null;
  const entryVolumes=rows.filter(t=>t.entryQty>0).reduce((s,t)=>s+t.entryQty,0);
  const fees=rows.reduce((s,t)=>s+(t.fees||0),0);
  const holds=category=>mean(rows.filter(t=>classify(t)===category).map(t=>t.holdMinutes).filter(Number.isFinite));
  const regressionK=kRatio(rows);
  return {wins,losses,scratches,pnl,grossWin,grossLoss,daily,values,winAvg,lossAvg,winningRatio,payOff,expectancy,sd,tradeStats,netByDate,winLossChance,kelly,entryVolumes,fees,holds,kRatio:regressionK,
    pf:grossLoss?grossWin/grossLoss:(grossWin?Infinity:null),sqn:sd?Math.sqrt(rows.length)*expectancy/sd:null};
}
function binomialPValue(k,n){
  if(!n)return null;
  // Two-sided exact binomial tail under the null hypothesis p=0.5.
  const target=Math.min(k,n-k);
  let probability=Math.pow(0.5,n),cumulative=probability;
  for(let i=1;i<=target;i++){
    probability*= (n-i+1)/i;
    cumulative+=probability;
  }
  // Avoid floating point underflow for large samples with log-gamma recurrence.
  if(n>1020){
    let logTerm=-n*Math.LN2,terms=[];
    for(let i=0;i<=target;i++){terms.push(logTerm);logTerm+=Math.log(n-i)-Math.log(i+1);}
    const m=Math.max(...terms);
    return Math.min(1,2*Math.exp(m)*terms.reduce((s,v)=>s+Math.exp(v-m),0));
  }
  return Math.min(1,2*cumulative);
}
function kRatio(rows){
  // Linear regression slope divided by its standard error on the trade-by-trade equity curve.
  const n=rows.length;
  if(n<4)return null;
  let equity=0,sumY=0,sumXY=0;
  const ys=rows.map((t,i)=>{equity+=t.pnl;sumY+=equity;sumXY+=(i+1)*equity;return equity;});
  const sumX=n*(n+1)/2,sumXX=n*(n+1)*(2*n+1)/6;
  const sxx=sumXX-sumX*sumX/n;
  const slope=(sumXY-sumX*sumY/n)/sxx;
  const intercept=(sumY-slope*sumX)/n;
  const error=ys.reduce((s,y,i)=>s+(y-intercept-slope*(i+1))**2,0);
  const se=Math.sqrt(error/(n-2)/sxx);
  return se?slope/se:null;
}
function drawdownStats(rows){
  let equity=0,peak=0,biggest=0,periods=0,daysInDrawdown=new Set(),lengths=[],tradeLengths=[],currentTradeCount=0,currentStart=null,currentDates=new Set();
  const points=[];
  for(const t of rows){
    equity+=t.pnl;
    peak=Math.max(peak,equity);
    const dd=Math.max(0,peak-equity);
    biggest=Math.max(biggest,dd);
    points.push([t.closed, -dd]);
    if(dd>EPSILON){
      daysInDrawdown.add(t.date);
      currentDates.add(t.date);currentTradeCount++;
      if(currentStart===null){periods++;currentStart=t.date;}
    }else if(currentStart!==null){lengths.push(currentDates.size);tradeLengths.push(currentTradeCount);currentTradeCount=0;currentStart=null;currentDates=new Set();}
  }
  if(currentStart!==null){lengths.push(currentDates.size);tradeLengths.push(currentTradeCount);}
  return {biggest,average:mean(points.filter(x=>x[1]<-EPSILON).map(x=>-x[1])),periods,days:daysInDrawdown.size,avgDays:mean(lengths),avgTrades:mean(tradeLengths),points};
}
function streaks(rows){
  const out={win:{max:0,runs:[],current:0},loss:{max:0,runs:[],current:0}};
  let current=null,count=0;
  const finish=()=>{if(current){out[current].runs.push(count);out[current].max=Math.max(out[current].max,count);}};
  for(const t of rows){const type=classify(t);if(type==='scratch'){finish();current=null;count=0;continue;}if(current===type){count++;}else{finish();current=type;count=1;}}
  finish();return out;
}
function renderMetrics(rows){
  const s=statistics(rows),st=streaks(rows),dd=s.tradeStats;
  const risk=[
    ['Biggest Drawdown',money(dd.biggest),'negative'],['Average Drawdown',money(dd.average),'negative'],['Win Rate',pct(s.wins.length,rows.length),'positive'],['Win/Loss Ratio',num(s.losses.length?s.wins.length/s.losses.length:null),'warning'],
    ['Max Racha Ganadora',`${st.win.max} trades`,'positive'],['Max Racha Perdedora',`${st.loss.max} trades`,'negative'],['Rachas Ganadoras',`${st.win.runs.length} (avg ${num(mean(st.win.runs),1)})`,'positive'],
    ['Rachas Perdedoras',`${st.loss.runs.length} (avg ${num(mean(st.loss.runs),1)})`,'negative'],['Días en Drawdown',`${dd.days} días`],['Avg Días en Drawdown',`${num(dd.avgDays,1)} días`],['Períodos Drawdown',String(dd.periods)]
  ];
  $('risk-stats').innerHTML=risk.map(a=>metric(...a)).join('');
  $('consistency-stats').innerHTML=[
    ['SQN (System Quality Number)',num(s.sqn),'accent'],['K-Ratio',num(s.kRatio)],['Kelly %',s.kelly===null?'—':`${num(s.kelly)}%`,'accent'],
    ['P&L Std Deviation',money(s.sd)],['Prob. Random Chance',s.winLossChance===null?'—':`${num(s.winLossChance*100)}%`],['Profit Factor',num(s.pf)],
    ['Avg Trades in Drawdown',dd.periods?num(dd.avgTrades,1):'—']
  ].map(a=>metric(...a)).join('');
}
const chartConfigs = new Map();
function renderChart(id, series, opts = {}) {
  const element = $(id);
  chartConfigs.set(id, { series, opts });
  const explanation = opts.explanation || chartHelp(id, opts);
  element.setAttribute('data-help', explanation);
  element.setAttribute('tabindex', '0');
  element.innerHTML = svgChart(series, { ...opts, explanation, width: element.clientWidth || 800, height: element.clientHeight || 265 });
}
function refreshCharts() {
  for (const [id, { series, opts }] of chartConfigs) {
    if ($(id).clientWidth > 0) renderChart(id, series, opts);
  }
}
function chartLabel(value) {
  const label = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(label)) return `${label.slice(8,10)}/${label.slice(5,7)}/${label.slice(2,4)}`;
  return label.length > 19 ? `${label.slice(0,18)}…` : label;
}
function svgChart(series,opts={}){
  series = series.map(s => ({ ...s, values: s.values.filter(p => Number.isFinite(p[1])) }));
  if(!series.length || !series.some(s=>s.values.length))return `<span>${esc(opts.empty || 'Sin operaciones para estos filtros')}</span>`;
  const W=Math.max(240,opts.width||800),H=Math.max(160,opts.height||265),l=78,r=22,t=18,b=40,plotW=W-l-r,plotH=H-t-b;
  const all=series.flatMap(s=>s.values.map(p=>p[1]));
  let low=Math.min(0,...all),high=Math.max(0,...all);
  if(Number.isFinite(opts.max))high=Math.max(high,opts.max);
  if(high===low){high+=1;low-=1;}
  const count=Math.max(...series.map(s=>s.values.length));
  const X=i=>opts.bar?l+(i+.5)*plotW/count:l+(count===1?.5:i/(count-1))*plotW;
  const Y=v=>t+(high-v)/(high-low)*plotH;
  const pad=v=>Number(v.toFixed(2)).toLocaleString('en-US');
  const valueLabel=v=>opts.currency?moneyFormat.format(v):`${pad(v)}${opts.unit||''}`;
  const pointHelp = point => {
    const meaning = opts.unit === 'x' ? ` Por cada $1 de pérdida media, la ganancia media fue de ${money(point[1])}.` : '';
    return `${point[0]}: ${valueLabel(point[1])}.${meaning}${point[2] ? ` ${point[2]}` : ''}\n\n${opts.explanation || chartHelp('', opts)}`;
  };
  let shapes='';
  for(let i=0;i<=4;i++){
    const v=low+(high-low)*i/4,y=Y(v);
    shapes+=`<line x1="${l}" y1="${y}" x2="${W-r}" y2="${y}" stroke="#304058" stroke-width="1" vector-effect="non-scaling-stroke" stroke-dasharray="3 5" opacity=".6"/><text x="${l-8}" y="${y+4}" fill="#9bb3cd" font-size="11" text-anchor="end">${esc(valueLabel(v))}</text>`;
  }
  shapes+=`<line x1="${l}" x2="${W-r}" y1="${Y(0)}" y2="${Y(0)}" stroke="#688099" stroke-width="1" vector-effect="non-scaling-stroke" stroke-dasharray="4 4"/>`;
  for(const s of series){
    const arr=s.values;if(!arr.length)continue;
    if(opts.bar){
      const step=plotW/count,width=Math.max(.75,Math.min(45,step*.73));
      shapes+=arr.map((p,i)=>{const v=p[1],x=X(i)-width/2;return `<rect x="${x}" y="${Math.min(Y(v),Y(0))}" width="${width}" height="${Math.max(1,Math.abs(Y(v)-Y(0)))}" fill="${v>=0?(s.color||'#24c86a'):'#fb4f61'}" ${helpAttributes(pointHelp(p))}></rect>`;}).join('');
    }else{
      const segments=[];
      for(let i=0;i<arr.length;i++){
        const v=arr[i][1];
        segments.push(`${i?'L':'M'}${X(i).toFixed(2)},${Y(v).toFixed(2)}`);
      }
      shapes+=`<path d="${segments.join(' ')}" stroke="${s.color||'#29d17e'}" stroke-width="1.3" vector-effect="non-scaling-stroke" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`;
      if(arr.length===1)shapes+=`<circle cx="${X(0)}" cy="${Y(arr[0][1])}" r="4" fill="${s.color||'#29d17e'}"/>`;
      const every=Math.max(1,Math.floor(arr.length/70));
      for(let i=0;i<arr.length;i+=every){shapes+=`<circle cx="${X(i)}" cy="${Y(arr[i][1])}" r="7" fill="transparent" ${helpAttributes(pointHelp(arr[i]))}></circle>`;}
    }
  }
  const labels=series.find(s=>s.values.length===count).values;
  const labelWidth=Math.max(65,...labels.map((p,i)=>chartLabel(opts.labels?.[i]||p[0]).length*6.5+18));
  const ticks=Math.min(8,labels.length,Math.max(1,Math.floor(plotW/(labelWidth*1.5))+1));
  for(let j=0;j<ticks;j++){
    const index=ticks===1?0:Math.round(j*(labels.length-1)/(ticks-1));
    const full=opts.labels?.[index]||labels[index][0],shown=chartLabel(full);
    const anchor=ticks===1?'middle':j===0?'start':j===ticks-1?'end':'middle';
    shapes+=`<text x="${X(index)}" y="${H-12}" fill="#97aec8" font-size="11" text-anchor="${anchor}" ${helpAttributes(`${full}. ${opts.explanation || chartHelp('',opts)}`)}>${esc(shown)}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(opts.title||'Trading chart')}">${shapes}</svg>`;
}
function equity(rows){let p=0;return rows.map(t=>[t.date,+(p+=t.pnl).toFixed(4)]);}
function alignedEquity(rows,axis){
  const daily=new Map(group(rows,t=>t.date));let total=0;
  return axis.map(day=>[day,+(total+=(daily.get(day)||0)).toFixed(4)]);
}
function renderCharts(rows){
  const long=rows.filter(t=>t.side==='BUY'),short=rows.filter(t=>t.side==='SELL');
  const dd=drawdownStats(rows);
  renderChart('equity-chart',[{values:equity(rows),color:'#20d075'}],{currency:true});
  renderChart('drawdown-chart',[{values:dd.points,color:'#f4485b'}],{currency:true});
  renderChart('long-equity',[{values:equity(long),color:'#24d578'}],{currency:true});
  renderChart('short-equity',[{values:equity(short),color:'#24d578'}],{currency:true});
  renderChart('long-daily',[{values:group(long,t=>t.date),color:'#27c873'}],{bar:true,currency:true});
  renderChart('short-daily',[{values:group(short,t=>t.date),color:'#27c873'}],{bar:true,currency:true});
  const axis=dates(rows);
  renderChart('comparison-chart',[{values:alignedEquity(long,axis),color:'#20d07a'},{values:alignedEquity(short,axis),color:'#ff4e62'}],{currency:true});
  renderChart('months-chart',[{values:group(rows,t=>t.date.slice(0,7)),color:'#5c9bff'}],{bar:true,currency:true});
  const popular=[...rows.reduce((m,t)=>m.set(t.symbol,(m.get(t.symbol)||0)+1),new Map())].sort((a,b)=>b[1]-a[1]).slice(0,12).map(x=>x[0]);
  renderChart('symbols-chart',[{values:group(rows.filter(t=>popular.includes(t.symbol)),t=>t.symbol),color:'#37cfe9'}],{bar:true,currency:true});
  renderSide('long-stats',long,'Long','long');renderSide('short-stats',short,'Short','short');
  renderTime(rows);renderPrice(rows);renderWeekdays(rows);
}
function renderSide(id,rows,title,kind){
  const s=statistics(rows),daily=s.daily,sorted=daily.map(x=>x[1]);
  const items=[
    ['Trades',String(rows.length)],['Wins / Losses',`${s.wins.length} / ${s.losses.length}`],['Win Rate',pct(s.wins.length,rows.length)],
    ['PnL Total',money(s.pnl),cssSign(s.pnl)],['PnL Medio',money(s.expectancy),cssSign(s.expectancy)],['Avg Win',money(s.winAvg),'positive'],
    ['Avg Loss',money(s.lossAvg),'negative'],['Profit Factor',num(s.pf)],['Trading Days',String(daily.length)],
    ['Best Day',money(sorted.length?Math.max(...sorted):null),'positive'],['Worst Day',money(sorted.length?Math.min(...sorted):null),'negative']
  ];
  $(id).innerHTML=`<div class="side-title ${kind}">${title}</div><div class="side-grid">${items.map(([label,value,cls])=>`<div tabindex="0" ${helpAttributes(helpText(label))}><div class="side-cell-label">${esc(label)}<span class="help-mark" aria-hidden="true">ⓘ</span></div><div class="side-cell-value ${cls||''}">${esc(value)}</div></div>`).join('')}</div>`;
}
function timeBand(trade, interval = 5) {
  const time = (trade.opened || '').slice(11, 16);
  if (!/^\d{2}:\d{2}$/.test(time)) return null;
  const hour = Number(time.slice(0, 2)), minute = Number(time.slice(3));
  if (hour > 23 || minute > 59) return null;
  const start = Math.floor((hour * 60 + minute) / interval) * interval;
  const format = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  return `${format(start)}–${format(start + interval)}`;
}
function renderTime(rows){
  const bands=group(rows,trade=>timeBand(trade)).filter(p=>p[0]!==null);
  renderChart('time-chart',[{values:bands,color:'#25c7dd'}],{bar:true,currency:true});
}
const PRICE_BANDS=[['$0–2',0,2],['$2–5',2,5],['$5–10',5,10],['$10–20',10,20],['$20+',20,Infinity]];
function priceGroups(rows){return PRICE_BANDS.map(([name,min,max])=>({name,rows:rows.filter(t=>Number.isFinite(t.entryPrice)&&t.entryPrice>=min&&t.entryPrice<max)}));}
function renderPrice(rows){
  const bands=priceGroups(rows);const values=bands.map(x=>[x.name,sum(x.rows)]);
  renderChart('price-chart',[{values,color:'#a68afb'}],{bar:true,currency:true});
  const populated=bands.filter(x=>x.rows.length);
  const best=populated.length?[...populated].sort((a,b)=>sum(b.rows)-sum(a.rows))[0]:null;
  const worst=populated.length?[...populated].sort((a,b)=>sum(a.rows)-sum(b.rows))[0]:null;
  $('price-caption').textContent=best&&worst?`Mejor: ${best.name} (${money(sum(best.rows))}) · Peor: ${worst.name} (${money(sum(worst.rows))})`:'Sin precios de entrada disponibles';
  $('price-table').innerHTML=tableMarkup(['Rango','Trades','Win Rate','PnL Total','PnL Medio'],bands.map(b=>[b.name,b.rows.length,pct(b.rows.filter(t=>classify(t)==='win').length,b.rows.length),signed(sum(b.rows)),b.rows.length?money(sum(b.rows)/b.rows.length):'—']));
}
function tableMarkup(headers,rows){return `<table><thead><tr>${headers.map(x=>`<th tabindex="0" ${helpAttributes(helpText(x))}>${esc(x)}<span class="help-mark" aria-hidden="true">ⓘ</span></th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map((v,i)=>`<td ${helpAttributes(`${headers[i]}: ${v}. ${helpText(headers[0]==='Métrica'?row[0]:headers[i])}`)} class="${i>=3&&String(v).startsWith('-')?'negative':i>=3&&String(v).startsWith('+')?'positive':''}">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;}
function renderWeekdays(rows){
  const names=['Lunes','Martes','Miércoles','Jueves','Viernes'];
  const groups=names.map((name,i)=>({name,rows:rows.filter(t=>{const [y,m,d]=t.date.split('-').map(Number);return (new Date(Date.UTC(y,m-1,d)).getUTCDay()+6)%7===i;})}));
  renderChart('weekday-chart',[{values:groups.map(x=>[x.name,sum(x.rows)]),color:'#25c56c'}],{bar:true,currency:true});
  const present=groups.filter(x=>x.rows.length);
  const best=present.length?[...present].sort((a,b)=>sum(b.rows)-sum(a.rows))[0]:null;
  const worst=present.length?[...present].sort((a,b)=>sum(a.rows)-sum(b.rows))[0]:null;
  $('weekday-highlights').innerHTML=best&&worst?`<div class="highlight">Mejor día<strong class="positive">${esc(best.name)} · ${esc(money(sum(best.rows)))} (${best.rows.length} trades)</strong></div><div class="highlight worst">Peor día<strong class="negative">${esc(worst.name)} · ${esc(money(sum(worst.rows)))} (${worst.rows.length} trades)</strong></div>`:'';
  $('weekday-table').innerHTML=tableMarkup(['Día','Trades','Win Rate','PnL Total','PnL Medio / Trade'],groups.map(g=>[g.name,g.rows.length,pct(g.rows.filter(t=>classify(t)==='win').length,g.rows.length),signed(sum(g.rows)),g.rows.length?money(sum(g.rows)/g.rows.length):'—']));
}
function renderBest(){
  const from=$('best-from').value,to=$('best-to').value;
  if(!from||!to){$('best-results').textContent='Selecciona un rango de fechas y pulsa Buscar.';return;}
  if(from>to){$('best-results').textContent='La fecha Desde debe ser anterior a Hasta.';return;}
  const rows=filtered.filter(t=>t.date>=from&&t.date<=to);
  if(!rows.length){$('best-results').textContent='No hay operaciones en ese rango.';return;}
  const ordered=[...rows].sort((a,b)=>b.pnl-a.pnl);
  const content=(t,title)=>`<div class="best-card" tabindex="0" ${helpAttributes(`Se ordenan las operaciones del intervalo por su PnL: se muestra el mayor o el menor resultado individual. ${HELP_PNL}`)}><h4>${esc(title)}<span class="help-mark" aria-hidden="true">ⓘ</span></h4><div class="big ${cssSign(t.pnl)}">${esc(signed(t.pnl))}</div><small>${esc(t.date)} · ${esc(t.symbol)} · ${t.side==='BUY'?'Long':'Short'} · Entrada: ${esc(t.entryPrice===null?'N/D':money(t.entryPrice))}</small></div>`;
  $('best-results').innerHTML=`<div class="best-columns">${content(ordered[0],'Mejor trade')}${content(ordered[ordered.length-1],'Peor trade')}</div>`;
}
function populateFilters(rows, preserve = false){
  for (const panel of tradeFilterPanels.values()) panel.populate(rows, dataset.tickerProfiles, preserve);
}
function applyFilters(){
  if(!dataset)return;
  filtered=tradeFilterPanels.get('general').matchingRows();
  page=0;renderMetrics(filtered);renderCharts(filtered);renderTable();renderWorkspace(filtered);
  if($('best-from').value&&$('best-to').value)renderBest();
}
function setTradeTableSort(state) {
  tradeTableSort = state;
  page = 0;
  renderTable();
}
function sortedTradeRows(rows) {
  if (!tradeTableSort) return rows.slice().reverse();
  const values = [t => t.date, t => t.symbol, t => t.side, t => t.opened.slice(11,19),
    t => t.closed.slice(11,19), t => t.entryPrice, t => t.entryQty, t => t.holdMinutes, t => t.pnl];
  const value = values[tradeTableSort.column];
  return rows.slice().sort((a, b) => compareTableValues(value(a) ?? null, value(b) ?? null, tradeTableSort.direction));
}
function renderTable(){
  const query=$('search').value.toLowerCase().trim();
  const matches=query?filtered.filter(t=>t.symbol.toLowerCase().includes(query)):filtered;
  const maxPage=Math.max(0,Math.ceil(matches.length/pageSize)-1);page=Math.max(0,Math.min(page,maxPage));
  const current=sortedTradeRows(matches).slice(page*pageSize,(page+1)*pageSize);
  const columns=['Fecha','Símbolo','Dirección','Apertura NY','Cierre NY','Entrada','Shares','Duración','PnL'];
  $('trade-rows').innerHTML=current.length?current.map(t=>{
    const cells=[esc(t.date),`<strong>${esc(t.symbol)}</strong>`,`<span class="pill ${t.side==='SELL'?'short':''}">${t.side==='BUY'?'Long':'Short'}</span>`,esc(t.opened.slice(11,19)),esc(t.closed.slice(11,19)),esc(t.entryPrice===null?'—':money(t.entryPrice)),esc(t.entryQty===null?'—':num(t.entryQty,0)),`${esc(num(t.holdMinutes,1))} min`,esc(signed(t.pnl))];
    return `<tr>${cells.map((content,index)=>`<td ${helpAttributes(helpText(columns[index]))} class="${index===8?`number ${cssSign(t.pnl)}`:''}">${content}</td>`).join('')}</tr>`;
  }).join(''):'<tr><td colspan="9">Sin operaciones</td></tr>';
  $('table-count').textContent=`${integerFormat.format(matches.length)} operaciones`;
  $('pagination-info').textContent=matches.length?`${page*pageSize+1}–${Math.min((page+1)*pageSize,matches.length)} de ${matches.length}`:'0 operaciones';
  $('prev').disabled=page===0;$('next').disabled=page>=maxPage;
}
async function loadData(options = {}){
  const previousSearch = options.preserveFilters ? $('search').value : '';
  $('source-status').textContent='Actualizando…';$('refresh').disabled=true;$('error').hidden=true;
  try{
    const response=await fetch(`data/trades.json?v=${Date.now()}`,{cache:'no-store'});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const next=await response.json();
    if(!Array.isArray(next.trades)||next.schemaVersion!==2)throw new Error('The JSON format is outdated. Upload the matching data/trades.json or regenerate it via GitHub Actions.');
    dataset=next;populateFilters(dataset.trades, Boolean(options.preserveFilters));
    $('search').value=previousSearch;
    $('last-updated').textContent=`Datos generados: ${new Date(next.generatedAt).toLocaleString('es-ES')}`;
    $('dataset-info').textContent=`${next.tradeCount} trades · ${next.uniqueExecutionRows} ejecuciones únicas · ${next.sourceFiles.length} CSV Quant compatibles`;
    $('source-status').textContent='Datos cargados';
    if(next.unsupportedFiles.length||next.inconsistentIds){$('error').hidden=false;$('error').textContent=`Aviso: ${next.unsupportedFiles.length?`CSV de otro formato (no combinados): ${next.unsupportedFiles.join(', ')}. `:''}${next.inconsistentIds?`${next.inconsistentIds} IDs contradictorios entre exportaciones.`:''}`;}
    applyFilters();
    renderDataAudit();
    return true;
  }catch(err){
    console.error('Dashboard error:', err);
    $('source-status').textContent='Error';
    $('error').hidden=false;
    $('error').textContent=err.message.startsWith('Missing HTML element')
      ? `Versiones incompatibles: ${err.message}`
      : `Error al cargar o procesar datos: ${err.message}. Comprueba los archivos publicados y GitHub Actions.`;
    return false;
  }
  finally{$('refresh').disabled=false;}
}
$('search').addEventListener('input',()=>{page=0;renderTable();});
$('prev').addEventListener('click',()=>{page--;renderTable();});
$('next').addEventListener('click',()=>{page++;renderTable();});
$('refresh').addEventListener('click',()=>loadData({preserveFilters:true}));
$('best-search').addEventListener('click',renderBest);
initializeTradeFilters();
initializeHelp();
initializeWorkspace();
initializeCalendarOverview();
initializeConsistencyStudies();
initializeTableSorting();
window.addEventListener('resize', refreshCharts);
if (typeof ResizeObserver !== 'undefined') {
  const chartObserver = new ResizeObserver(entries => {
    for (const { target } of entries) {
      const config = chartConfigs.get(target.id);
      if (config && target.clientWidth > 0) renderChart(target.id, config.series, config.opts);
    }
  });
  document.querySelectorAll('.chart').forEach(element => chartObserver.observe(element));
}
loadData();
