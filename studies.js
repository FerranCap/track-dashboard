'use strict';

function enrichedStudyGroup(name, rows, unknown = false) {
  const prices = rows.map(trade => trade.entryPrice).filter(value => Number.isFinite(value) && value >= 0);
  const durations = rows.filter(trade => Number.isFinite(trade.holdMinutes) && trade.holdMinutes >= 0);
  return { name, rows, unknown, ...durationSummary(rows), durationCount: durations.length,
    priceCount: prices.length, priceMean: prices.length ? mean(prices) : null,
    priceMedian: sampleQuantile(prices, 0.5), pnlMedian: sampleQuantile(rows.map(trade => trade.pnl), 0.5) };
}

function priceStudyGroups(rows, width) {
  const groups = priceGroups(rows, width).map(group => enrichedStudyGroup(group.name, group.rows));
  const unknown = rows.filter(trade => !Number.isFinite(trade.entryPrice) || trade.entryPrice < 0);
  if (unknown.length) groups.push(enrichedStudyGroup('Sin precio', unknown, true));
  return groups;
}

function countryStudyGroups(rows) {
  return groupedStatistics(rows, trade => tradeCountry(trade) || 'Sin clasificar')
    .map(([name, sample]) => enrichedStudyGroup(name, sample, name === 'Sin clasificar'))
    .sort((left, right) => Number(left.unknown) - Number(right.unknown) || left.name.localeCompare(right.name));
}

function renderStudyCharts(prefix, groups, explanation) {
  const charts = [
    ['count', 'count', 'Operaciones', {}, 'Número de operaciones cerradas únicas.'],
    ['pnl', 'pnl', 'PnL total', { currency: true }, 'Suma del PnL registrado.'],
    ['average', 'average', 'PnL medio por operación', { currency: true }, 'PnL total ÷ operaciones; incluye los resultados a cero.'],
    ['winrate', 'winRate', 'Win rate', { unit: '%', max: 100 }, 'Ganadoras ÷ todas las operaciones del grupo × 100.'],
    ['rr', 'rr', 'Ganancia / pérdida media', { unit: 'x' }, 'Ganancia media ÷ valor absoluto de pérdida media. Requiere ambas clases de resultados; no es riesgo planificado.'],
    ['pf', 'pf', 'Profit factor', { unit: 'x', suppressRatioMeaning: true }, 'Suma de ganancias ÷ valor absoluto de pérdidas. Los valores infinitos o indefinidos se muestran solo en la tabla.'],
    ['quantity', 'quantity', 'Acciones totales', { unit: ' acciones' }, 'Suma de cantidades de entrada (entryQty) conocidas y positivas; sin duplicar las salidas.'],
    ['average-quantity', 'averageQuantity', 'Acciones medias', { unit: ' acciones' }, 'Acciones de entrada totales ÷ operaciones con cantidad conocida y positiva.'],
    ['per-share', 'pnlPerShare', 'PnL por acción', { currency: true }, 'PnL de los trades con cantidad válida ÷ sus acciones totales. Se excluyen los trades sin cantidad de ambos términos.'],
    ['duration-mean', 'mean', 'Duración media', { unit: ' min' }, 'Media de minutos entre apertura y cierre, solo con duración conocida y no negativa.'],
    ['duration-median', 'median', 'Duración mediana', { unit: ' min' }, 'Mediana de minutos entre apertura y cierre; excluye duraciones desconocidas o inválidas.']
  ];
  if (prefix === 'country') charts.push(['price-median', 'priceMedian', 'Precio mediano de entrada', { currency: true, currencyUnit: 'usd' }, 'Mediana del precio de entrada por operación. Solo precios conocidos y no negativos.']);
  for (const [id, field, title, options, meaning] of charts) {
    const chartId = id === 'pnl' ? `${prefix}-chart` : `${prefix}-${id}-chart`;
    const chartGroups = groups.filter(group => Number.isFinite(group[field]));
    if (prefix === 'country') chartGroups.sort((left, right) => right[field] - left[field] || left.name.localeCompare(right.name));
    renderChart(chartId, [{ color: '#5c9bff', values: chartGroups.map(group => [
      group.name, group[field], `${group.count} operaciones; ${group.quantityCount} con acciones, ${group.durationCount} con duración.${group.count < 20 ? ' Muestra reducida (<20).' : ''}`
    ]) }], { bar: true, ...options, title, explanation: `${meaning} ${prefix === 'country' ? 'Países ordenados de mayor a menor valor, de izquierda a derecha. ' : ''}${explanation}`, empty: 'Sin valores calculables para estos filtros. Consulta la tabla detallada.' });
  }
}

function renderStudyDetail(prefix, groups, label) {
  $(`${prefix}-table`).innerHTML = groups.length ? tableMarkup([
    label, 'Operaciones', 'Ganadoras', 'Perdedoras', 'A cero', 'Win rate', 'PnL', 'PnL medio', 'PnL mediano', 'Ganancia media', 'Pérdida media', 'RR realizado', 'Profit factor',
    'Comisiones', 'Acciones totales', 'Acciones medias', 'Trades con acciones', 'PnL / acción', 'Duración media (min)', 'Duración mediana (min)', 'Trades con duración', 'Precio mediano', 'Trades con precio', 'Muestra'
  ], groups.map(group => [group.name, group.count, group.wins, group.losses, group.scratches, `${num(group.winRate, 1)}%`, signed(group.pnl), money(group.average), money(group.pnlMedian),
    money(group.winAverage), group.lossAverage === null ? '—' : money(-group.lossAverage), group.rr === null ? '—' : `${num(group.rr)} : 1`, ratioValue(group.pf), usdMoney(group.fees),
    num(group.quantity, 0), num(group.averageQuantity, 1), group.quantityCount, money(group.pnlPerShare), num(group.mean, 2), num(group.median, 2), group.durationCount,
    usdMoney(group.priceMedian), group.priceCount, group.count < 20 ? 'Reducida (<20)' : '20 o más'
  ])) : '<p class="muted">Sin operaciones para estos filtros.</p>';
}

function renderStudyScatter(id, rows, xValue, yField, title, explanation, options = {}) {
  const available = rows.filter(trade => Number.isFinite(xValue(trade)) && Number.isFinite(trade[yField]) && (yField !== 'entryQty' || trade.entryQty > 0));
  renderChart(id, [['win', '#29d17e'], ['loss', '#fb4f61'], ['scratch', '#98adc8']].map(([kind, color]) => ({
    color, values: available.filter(trade => classify(trade) === kind).map(trade => [xValue(trade), trade[yField],
      `${trade.symbol} · ${trade.date} · ${trade.id}: ${tradeCountry(trade) || 'Sin clasificar'}; precio ${usdMoney(trade.entryPrice)}; PnL ${signed(trade.pnl)}; acciones ${Number.isFinite(trade.entryQty) && trade.entryQty > 0 ? num(trade.entryQty, 0) : 'sin confirmar'}; duración ${Number.isFinite(trade.holdMinutes) && trade.holdMinutes >= 0 ? `${num(trade.holdMinutes, 2)} min` : 'sin confirmar'}.`
    ])
  })), { scatter: true, title, ...options, explanation: `Cada punto es una operación, sin muestreo. Verde: ganadora; rojo: perdedora; gris: a cero. ${available.length} puntos con ambos datos disponibles. ${explanation}` });
}

function renderPriceStudies(rows) {
  const selected = Number($('price-range-width').value);
  const width = [0.1, 0.25, 0.5, 1, 2, 5, 10].includes(selected) ? selected : 1;
  const groups = priceStudyGroups(rows, width), known = groups.filter(group => !group.unknown);
  const available = rows.filter(trade => Number.isFinite(trade.entryPrice) && trade.entryPrice >= 0);
  const prices = available.map(trade => trade.entryPrice);
  const explanation = `Precio medio de entrada por acción. Rangos de ${usdMoney(width)} desde $0, límite inferior incluido y superior excluido. Sin rangos vacíos. Filtros actuales; muestras menores de 20 trades indicadas. ${HELP_PNL}`;
  $('price-caption').textContent = `${available.length} operaciones con precio válido; ${rows.length - available.length} sin precio, conservadas en la tabla. Rangos de ${usdMoney(width)}: límite inferior incluido y superior excluido. Se omiten rangos vacíos. Todos los estudios respetan los filtros actuales.`;
  const cards = [
    ['Precio medio de entrada', usdMoney(prices.length ? mean(prices) : null), 'Media de los precios de entrada por operación, sin ponderar por cantidad de acciones. Solo precios válidos.'],
    ['Precio mediano de entrada', usdMoney(sampleQuantile(prices, 0.5)), 'Mediana de los precios de entrada por operación. Solo precios conocidos y no negativos.'],
    ['Precio · percentil 90', usdMoney(sampleQuantile(prices, 0.9)), 'Percentil 90 de los precios de entrada, con interpolación lineal.']
  ];
  for (const [kind, label] of [['win', 'Ganadoras'], ['loss', 'Perdedoras'], ['scratch', 'A cero']]) {
    const sample = available.filter(trade => classify(trade) === kind).map(trade => trade.entryPrice);
    cards.push([`Precio medio · ${label}`, usdMoney(sample.length ? mean(sample) : null), `Media del precio de entrada de ${sample.length} operaciones ${label.toLowerCase()}, sin ponderar por acciones.`],
      [`Precio mediano · ${label}`, usdMoney(sampleQuantile(sample, 0.5)), `Mediana del precio de entrada de ${sample.length} operaciones ${label.toLowerCase()}.`]);
  }
  $('price-stats').innerHTML = cards.map(args => consistencyMetric(...args)).join('');
  renderStudyCharts('price', known, explanation);
  $('price-distribution-table').innerHTML = tableMarkup(['Resultado', 'Operaciones', 'Precio medio', 'Precio P25', 'Precio mediano', 'Precio P75', 'Precio P90'],
    [['Todos', available], ['Ganadoras', available.filter(trade => classify(trade) === 'win')], ['Perdedoras', available.filter(trade => classify(trade) === 'loss')], ['A cero', available.filter(trade => classify(trade) === 'scratch')]].map(([label, sample]) => {
      const values = sample.map(trade => trade.entryPrice);
      return [label, sample.length, usdMoney(values.length ? mean(values) : null), ...[0.25, 0.5, 0.75, 0.9].map(probability => usdMoney(sampleQuantile(values, probability)))];
    }));
  const xValue = trade => trade.entryPrice;
  renderStudyScatter('price-scatter-pnl', available, xValue, 'pnl', 'Precio frente a PnL por operación', explanation, { currency: true, xCurrency: true, xLabel: 'Precio de entrada (USD)' });
  renderStudyScatter('price-scatter-quantity', available, xValue, 'entryQty', 'Precio frente a acciones por operación', explanation, { xCurrency: true, xLabel: 'Precio de entrada (USD)' });
  renderStudyScatter('price-scatter-duration', available.filter(trade => Number.isFinite(trade.holdMinutes) && trade.holdMinutes >= 0), xValue, 'holdMinutes', 'Precio frente a duración por operación', explanation, { xCurrency: true, xLabel: 'Precio de entrada (USD)', yDecimals: 1 });
  renderStudyDetail('price', groups, 'Rango de precio');
}

function renderCountryStudies(rows) {
  const groups = countryStudyGroups(rows);
  const explanation = `Agrupación exclusivamente por país de constitución (incorporation_country). Solo la ausencia de ese país genera Sin clasificar. No se utiliza país de operación, sede, ADR ni VIE para reasignar grupos. Filtros actuales; muestras menores de 20 trades indicadas. ${HELP_PNL}`;
  $('country-study-note').textContent = 'Estudios por país de constitución, con los filtros actuales. Cada gráfico de barras ordena los países de mayor a menor según su propia métrica, de izquierda a derecha. Las operaciones sin ese país permanecen en Sin clasificar. Las cantidades, precios y duraciones desconocidas se excluyen únicamente de las métricas que los necesitan.';
  const summary = enrichedStudyGroup('Todos', rows);
  $('country-study-stats').innerHTML = [
    ['Operaciones', String(rows.length), 'Operaciones cerradas únicas dentro de los filtros actuales.'],
    ['PnL total', signed(summary.pnl), HELP_PNL],
    ['Win rate', rows.length ? `${num(summary.winRate, 1)}%` : '—', HELP_WINRATE],
    ['Acciones medias', num(summary.averageQuantity, 1), `Media de cantidades de entrada de ${summary.quantityCount} operaciones con cantidad válida; las ausentes no se convierten en cero.`],
    ['Duración mediana', summary.median === null ? '—' : `${num(summary.median, 1)} min`, `Mediana de duración de ${summary.durationCount} operaciones con duración válida.`],
    ['Precio mediano de entrada', usdMoney(summary.priceMedian), `Mediana del precio de entrada de ${summary.priceCount} operaciones con precio válido, sin ponderar por acciones.`]
  ].map(args => consistencyMetric(...args)).join('');
  renderStudyCharts('country', groups, explanation);
  const categories = groups.map(group => group.name);
  const indices = new Map(categories.map((name, index) => [name, index]));
  const xValue = trade => indices.get(tradeCountry(trade) || 'Sin clasificar');
  renderStudyScatter('country-scatter-pnl', rows, xValue, 'pnl', 'PnL individual por país de constitución', explanation, { currency: true, xCategories: categories, xLabel: 'País de constitución' });
  renderStudyScatter('country-scatter-quantity', rows, xValue, 'entryQty', 'Acciones por operación y país de constitución', explanation, { xCategories: categories, xLabel: 'País de constitución' });
  renderStudyDetail('country', groups, 'País de constitución');
}
