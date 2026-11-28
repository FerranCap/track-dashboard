'use strict';

let updateWatchlistTradeStats = () => {};

function initializeWatchlist() {
  const storageKey = 'track-watchlist-v1';
  const maxTickers = 20;
  const fields = [
    ['country', 'Country', 'select'],
    ['float', 'Float (M)', 'number'],
    ['marketCap', 'Mk (M)', 'number'],
    ['news', 'News', 'textarea'],
    ['institutionalOwnership', 'IO (%)', 'number'],
    ['dilutionHistory', 'Dilution Hist', 'select'],
    ['dilutiveShares', 'Dilutive Shares', 'text'],
    ['overheadVolume', 'OH Volume (TView)', 'textarea'],
    ['underheadVolume', 'UH Volume (TView)', 'textarea'],
    ['zeroZone', 'Zero Zone', 'select'],
    ['extension', 'Ext (%)', 'number'],
    ['previousRuns', 'Prev Runs (Quant)', 'textarea']
  ];
  const body = document.getElementById('watchlist-rows');
  const form = document.getElementById('watchlist-add-form');
  const symbolInput = document.getElementById('watchlist-symbol');
  const status = document.getElementById('watchlist-status');
  const table = body.closest('table');
  const columns = [...table.querySelectorAll('col')];
  const headers = [...table.tHead.rows[0].cells];
  const layoutKey = 'track-watchlist-columns-v4';
  const tradeDetails = new Map();
  const countryControls = [];
  const similarityPanels = new Map();
  const similaritySettingsKey = 'track-watchlist-similarity-v1';
  const defaultSimilaritySettings = { country: true, float: { enabled: true, below: 30, above: 30 }, marketCap: { enabled: true, below: 30, above: 30 } };
  let similaritySettings = structuredClone(defaultSimilaritySettings);
  try {
    const saved = JSON.parse(localStorage.getItem(similaritySettingsKey));
    for (const key of ['float', 'marketCap']) {
      const item = saved?.[key];
      if (typeof item?.enabled === 'boolean' && Number.isFinite(item.below) && item.below >= 0 && item.below <= 100 && Number.isFinite(item.above) && item.above >= 0) similaritySettings[key] = item;
    }
    if (typeof saved?.country === 'boolean') similaritySettings.country = saved.country;
  } catch {}
  const settingsPanel = document.querySelector('.watchlist-settings');
  const countrySetting = settingsPanel.querySelector('[data-similar-country]');
  const priceSourceSetting = document.getElementById('watchlist-price-source');
  fetchPriceFile('data/prices/index.json').then(index => {
    const sources = new Map();
    for (const sessions of Object.values(index.tickers || {})) for (const session of Object.values(sessions)) for (const source of session.sources || []) sources.set(source.id, source);
    if (!sources.has(watchlistPriceSource)) sources.set(watchlistPriceSource, { id: watchlistPriceSource, label: watchlistPriceSource, dataset: '' });
    priceSourceSetting.replaceChildren();
    for (const source of sources.values()) {
      const option = document.createElement('option');
      option.value = source.id;
      option.textContent = [source.label, source.dataset].filter(Boolean).join(' \u00b7 ');
      priceSourceSetting.append(option);
    }
    priceSourceSetting.value = watchlistPriceSource;
    priceSourceSetting.disabled = false;
  }).catch(() => { priceSourceSetting.options[0].textContent = 'Fuentes no disponibles'; });
  priceSourceSetting.addEventListener('change', () => {
    watchlistPriceSource = priceSourceSetting.value;
    try { localStorage.setItem('track-watchlist-price-source', watchlistPriceSource); } catch {}
    for (const panel of body.querySelectorAll('.calendar-ticker-price')) {
      panel.priceResizeObserver?.disconnect();
      panel.priceRequest = null;
      if (panel.closest('details')?.open && panel.isConnected && panel.refreshWatchlistPrice) panel.refreshWatchlistPrice();
    }
  });

  countrySetting.checked = similaritySettings.country;
  for (const key of ['float', 'marketCap']) {
    settingsPanel.querySelector(`[data-similar-enabled="${key}"]`).checked = similaritySettings[key].enabled;
    for (const direction of ['below', 'above']) settingsPanel.querySelector(`[data-similar-${direction}="${key}"]`).value = similaritySettings[key][direction];
  }
  settingsPanel.addEventListener('input', event => {
    const control = event.target;
    if (!control.validity.valid || (control.type === 'number' && control.value === '')) return;
    if (control === countrySetting) similaritySettings.country = control.checked;
    for (const key of ['float', 'marketCap']) {
      if (control.dataset.similarEnabled === key) similaritySettings[key].enabled = control.checked;
      for (const direction of ['below', 'above']) if (control.dataset[`similar${direction[0].toUpperCase()}${direction.slice(1)}`] === key) similaritySettings[key][direction] = Number(control.value);
    }
    try { localStorage.setItem(similaritySettingsKey, JSON.stringify(similaritySettings)); } catch {}
    for (const panel of similarityPanels.values()) panel.refresh();
  });

  let similaritySource;
  let similarityRecords = [];
  let webPanel = null;
  let activeWebLink = null;
  let entries = [];
  let storageReadable = true;

  function getSimilarityRecords() {
    if (similaritySource !== dataset) {
      similaritySource = dataset;
      similarityRecords = buildWatchlistSimilarityIndex(dataset, secCapitalIssuers, secCapitalTrades);
    }
    return similarityRecords;
  }

  function applyColumnWidths(widths) {
    const total = widths.reduce((sum, width) => sum + width, 0);
    widths.forEach((width, index) => { columns[index].style.width = `${width / total * 100}%`; });
  }

  function saveColumnWidths() {
    try {
      localStorage.setItem(layoutKey, JSON.stringify(headers.map(header => header.getBoundingClientRect().width)));
    } catch {}
  }

  try {
    const widths = JSON.parse(localStorage.getItem(layoutKey) || 'null');
    if (Array.isArray(widths) && widths.length === columns.length && widths.every(width => Number.isFinite(width) && width > 0)) {
      applyColumnWidths(widths);
    }
  } catch {}

  headers.slice(0, -1).forEach((header, index) => {
    const handle = document.createElement('span');
    handle.className = 'watchlist-column-resizer';
    handle.tabIndex = 0;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-label', `Ajustar ancho: ${header.textContent.trim()}`);
    handle.title = 'Arrastra para ajustar el ancho';
    let drag = null;

    function resize(widths, delta) {
      const next = widths.slice();
      const pairWidth = widths[index] + widths[index + 1];
      const minimum = Math.min(24, pairWidth / 2);
      next[index] = Math.max(minimum, Math.min(pairWidth - minimum, widths[index] + delta));
      next[index + 1] = pairWidth - next[index];
      applyColumnWidths(next);
    }

    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      drag = { x: event.clientX, widths: headers.map(cell => cell.getBoundingClientRect().width) };
      handle.setPointerCapture(event.pointerId);
      document.body.classList.add('watchlist-resizing');
    });
    handle.addEventListener('pointermove', event => {
      if (drag) resize(drag.widths, event.clientX - drag.x);
    });
    const finish = () => {
      if (!drag) return;
      drag = null;
      document.body.classList.remove('watchlist-resizing');
      saveColumnWidths();
    };
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
    handle.addEventListener('lostpointercapture', finish);
    handle.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      resize(headers.map(cell => cell.getBoundingClientRect().width), event.key === 'ArrowRight' ? 4 : -4);
      saveColumnWidths();
    });
    header.append(handle);
  });
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (!Array.isArray(saved) || saved.some(entry => !entry || typeof entry.ticker !== 'string' || !entry.ticker.trim())) {
      throw new Error('Invalid watchlist data');
    }
    entries = saved;
  } catch {
    storageReadable = false;
    status.textContent = 'No se pudo leer la lista guardada. Recarga antes de editarla.';
  }

  function save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(entries));
      status.textContent = '';
    } catch {
      status.textContent = 'No se pudo guardar. Mantén esta pestaña abierta para conservar los cambios.';
    }
  }

  function updateFieldHighlight(control, key) {
    const value = control.value.trim();
    const number = Number(value);
    const numeric = value !== '' && Number.isFinite(number);
    const highlighted = (key === 'marketCap' && numeric && number > 90)
      || (key === 'institutionalOwnership' && numeric && number >= 50)
      || (key === 'extension' && numeric && number < 45)
      || (key === 'dilutionHistory' && value === 'Growth');
    control.classList.toggle('watchlist-field-warning', highlighted);
  }

  function countryOptions() {
    const counts = new Map();
    for (const trade of dataset?.trades || []) {
      const country = incorporationCountry(dataset?.tickerProfiles?.[trade.symbol]);
      if (country) counts.set(country, (counts.get(country) || 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([country]) => [country, country]);
  }

  function populateOptions(control, options, savedValue) {
    const value = String(savedValue ?? '');
    const choices = [['', 'Sin definir'], ...options];
    if (value && !choices.some(([key]) => key === value)) choices.push([value, value]);
    const signature = JSON.stringify(choices);
    if (control.dataset.options !== signature) {
      control.replaceChildren();
      for (const [key, label] of choices) {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = label;
        control.append(option);
      }
      control.dataset.options = signature;
    }
    control.value = value;
  }

  function closeWebPanel(restoreFocus = false) {
    const previousLink = activeWebLink;
    webPanel?.remove();
    webPanel = null;
    activeWebLink = null;
    previousLink?.setAttribute('aria-expanded', 'false');
    previousLink?.removeAttribute('aria-controls');
    document.body.classList.remove('watchlist-web-open');
    if (restoreFocus && previousLink?.isConnected) previousLink.focus();
    requestAnimationFrame(fitRows);
  }

  function openWebPanel(link, linksRow, ticker) {
    if (activeWebLink === link) {
      closeWebPanel(true);
      return;
    }
    closeWebPanel();
    activeWebLink = link;
    webPanel = document.createElement('tr');
    webPanel.className = 'watchlist-web-row';
    const cell = document.createElement('td');
    cell.colSpan = fields.length + 2;
    const panel = document.createElement('section');
    panel.className = 'watchlist-web-panel';
    panel.id = 'watchlist-web-panel';
    panel.setAttribute('aria-label', `${link.textContent}: ${ticker}`);
    const toolbar = document.createElement('div');
    toolbar.className = 'watchlist-web-toolbar';
    const title = document.createElement('strong');
    title.textContent = `${ticker} \u00b7 ${link.textContent}`;
    const externalLink = document.createElement('a');
    externalLink.className = 'watchlist-link';
    externalLink.href = link.href;
    externalLink.target = '_blank';
    externalLink.rel = 'noopener noreferrer';
    externalLink.textContent = 'Abrir fuera';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'secondary';
    close.textContent = 'Cerrar';
    close.addEventListener('click', () => closeWebPanel(true));
    toolbar.append(title, externalLink, close);
    const hint = document.createElement('p');
    hint.className = 'watchlist-web-hint';
    hint.textContent = 'Si la web no se muestra, usa \u00abAbrir fuera\u00bb.';
    const frame = document.createElement('iframe');
    frame.className = 'watchlist-web-frame';
    frame.title = `${link.textContent}: ${ticker}`;
    frame.src = link.href;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.allowFullscreen = true;
    panel.append(toolbar, hint, frame);
    cell.append(panel);
    webPanel.append(cell);
    linksRow.after(webPanel);
    link.setAttribute('aria-expanded', 'true');
    link.setAttribute('aria-controls', panel.id);
    document.body.classList.add('watchlist-web-open');
    requestAnimationFrame(() => {
      if (panel.isConnected) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function fitRows() {
    const view = document.getElementById('view-watchlist');
    if (view.hidden) return;
    view.style.setProperty('--watchlist-row-height', '42px');
  }

  function render() {
    closeWebPanel();
    tradeDetails.clear();
    const previousSimilarityPanels = new Map(similarityPanels);
    similarityPanels.clear();
    countryControls.length = 0;
    body.replaceChildren();
    document.getElementById('watchlist-add').disabled = !storageReadable || entries.length >= maxTickers;
    entries.forEach((entry, index) => {
      const row = document.createElement('tr');
      row.className = 'watchlist-entry';
      const tickerCell = document.createElement('th');
      tickerCell.scope = 'row';
      tickerCell.title = entry.ticker;
      const expand = document.createElement('button');
      expand.type = 'button';
      expand.className = 'watchlist-trades-toggle';
      const tickerLabel = document.createElement('span');
      tickerLabel.textContent = entry.ticker;
      const arrow = document.createElement('span');
      arrow.className = 'watchlist-toggle-arrow';
      arrow.textContent = '\u25b8';
      arrow.setAttribute('aria-hidden', 'true');
      expand.append(tickerLabel, arrow);
      expand.hidden = true;
      expand.setAttribute('aria-expanded', 'false');
      expand.setAttribute('aria-label', `Ver estad\u00edsticas de ${entry.ticker}`);
      tickerCell.append(expand);
      row.append(tickerCell);
      fields.forEach(([key, label, type]) => {
        const cell = document.createElement('td');
        const control = document.createElement(type === 'textarea' ? 'textarea' : type === 'select' ? 'select' : 'input');
        control.setAttribute('aria-label', `${entry.ticker}: ${label}`);
        if (key === 'zeroZone') control.classList.add('watchlist-zero-zone');
        if (type === 'select') {
          const options = key === 'country' ? countryOptions()
            : key === 'dilutionHistory' ? ['Dilutive hist', 'Holding', 'Growth'].map(value => [value, value])
              : [['near', 'Cerca'], ['far', 'Lejos']];
          populateOptions(control, options, entry[key]);
          if (key === 'country') countryControls.push({ control, entry });
        } else if (type === 'textarea') {
          const multiline = ['news', 'overheadVolume', 'underheadVolume', 'previousRuns'].includes(key);
          control.rows = multiline ? 2 : 1;
          if (multiline) control.classList.add('watchlist-two-lines');
        } else {
          control.type = type;
          if (type === 'number') {
            control.step = 'any';
            if (key !== 'extension') control.min = '0';
            if (key === 'institutionalOwnership') control.max = '100';
          }
        }
        control.value = String(entry[key] ?? '');
        control.disabled = !storageReadable;
        updateFieldHighlight(control, key);
        control.addEventListener('input', () => {
          entry[key] = control.value;
          updateFieldHighlight(control, key);
          save();
          similarityPanels.get(entry.ticker)?.refresh();
        });
        cell.append(control);
        row.append(cell);
      });
      const actionCell = document.createElement('td');
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'watchlist-remove';
      remove.textContent = '\u2212';
      remove.setAttribute('aria-label', `Eliminar ${entry.ticker}`);
      remove.disabled = !storageReadable;
      remove.addEventListener('click', () => {
        entries.splice(index, 1);
        save();
        render();
      });
      actionCell.append(remove);
      row.append(actionCell);
      body.append(row);
      const linksRow = document.createElement('tr');
      linksRow.className = 'watchlist-links-row';
      const tickerSpacer = document.createElement('td');
      tickerSpacer.setAttribute('aria-hidden', 'true');
      const linksCell = document.createElement('td');
      linksCell.colSpan = fields.length + 1;
      const dilutionLink = document.createElement('a');
      dilutionLink.className = 'watchlist-link';
      dilutionLink.textContent = 'DilutionTracker';
      dilutionLink.href = `https://dilutiontracker.com/app/search/${encodeURIComponent(entry.ticker)}`;
      dilutionLink.target = '_blank';
      dilutionLink.rel = 'noopener noreferrer';
      dilutionLink.setAttribute('aria-label', `Abrir ${entry.ticker} en DilutionTracker (nueva pesta\u00f1a)`);
      const finvizLink = document.createElement('a');
      finvizLink.className = 'watchlist-link';
      finvizLink.textContent = 'Finviz';
      finvizLink.href = `https://elite.finviz.com/stock?t=${encodeURIComponent(entry.ticker)}&p=d`;
      finvizLink.target = '_blank';
      finvizLink.rel = 'noopener noreferrer';
      finvizLink.setAttribute('aria-label', `Abrir ${entry.ticker} en Finviz (nueva pesta\u00f1a)`);
      const yahooLink = document.createElement('a');
      yahooLink.className = 'watchlist-link';
      yahooLink.textContent = 'Yahoo';
      yahooLink.href = `https://finance.yahoo.com/quote/${encodeURIComponent(entry.ticker)}/key-statistics/`;
      yahooLink.target = '_blank';
      yahooLink.rel = 'noopener noreferrer';
      yahooLink.setAttribute('aria-label', `Abrir ${entry.ticker} en Yahoo Finance (nueva pesta\u00f1a)`);
      const quantLink = document.createElement('a');
      quantLink.className = 'watchlist-link';
      quantLink.textContent = 'Quant';
      quantLink.href = `https://quantyouredge.com/chart/${encodeURIComponent(entry.ticker)}`;
      quantLink.target = '_blank';
      quantLink.rel = 'noopener noreferrer';
      quantLink.setAttribute('aria-label', `Abrir ${entry.ticker} en Quant (nueva pesta\u00f1a)`);
      for (const link of [dilutionLink]) {
        link.setAttribute('aria-label', `Ver ${entry.ticker} en ${link.textContent} dentro de Watchlist`);
        link.setAttribute('aria-expanded', 'false');
        link.addEventListener('click', event => {
          if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          openWebPanel(link, linksRow, entry.ticker);
        });
      }
      linksCell.append(dilutionLink, document.createTextNode(' '), finvizLink, document.createTextNode(' '), yahooLink, document.createTextNode(' '), quantLink);
      linksRow.append(tickerSpacer, linksCell);
      body.append(linksRow);
      const similar = previousSimilarityPanels.get(entry.ticker) || createWatchlistSimilarPanel(entry, {
        columnCount: fields.length + 2,
        getSettings: () => similaritySettings,
        getSource: () => dataset,
        getRecords: getSimilarityRecords,
        onLayout: () => requestAnimationFrame(fitRows)
      });
      similarityPanels.set(entry.ticker, similar);
      const detailRow = document.createElement('tr');
      detailRow.className = 'watchlist-trade-details';
      detailRow.id = `watchlist-trades-${index}`;
      detailRow.hidden = true;
      const detailCell = document.createElement('td');
      detailCell.colSpan = fields.length + 2;
      detailRow.append(detailCell);
      body.append(detailRow);
      const separator = document.createElement('tr');
      separator.className = 'watchlist-ticker-separator';
      separator.setAttribute('aria-hidden', 'true');
      const separatorCell = document.createElement('td');
      separatorCell.colSpan = fields.length + 2;
      separator.append(separatorCell);
      body.append(separator);
      expand.setAttribute('aria-controls', detailRow.id);
      expand.addEventListener('click', () => {
        const opening = detailRow.hidden;
        for (const item of tradeDetails.values()) {
          item.row.hidden = true;
          item.button.setAttribute('aria-expanded', 'false');
        }
        detailRow.hidden = !opening;
        expand.setAttribute('aria-expanded', String(opening));
        if (opening) updateWatchlistTradeStats();
        requestAnimationFrame(fitRows);
      });
      tradeDetails.set(entry.ticker, { row: detailRow, cell: detailCell, button: expand, index, signature: '' });
    });
    updateWatchlistTradeStats();
    requestAnimationFrame(fitRows);
  }

  updateWatchlistTradeStats = () => {
    const options = countryOptions();
    for (const { control, entry } of countryControls) populateOptions(control, options, entry.country);
    for (const item of similarityPanels.values()) item.refresh();
    for (const [ticker, item] of tradeDetails) {
      const history = dataset && typeof indexedTickerTrades === 'function' ? indexedTickerTrades(ticker, dataset) : (dataset?.trades || []).filter(trade => trade.symbol.toUpperCase() === ticker.toUpperCase());
      item.button.hidden = false;
      if (item.preparedDataset !== dataset) {
        item.preparedDataset = dataset;
        item.preparedRequested = false;
        item.prepared = null;
      }
      if (!history.length) {
        const html = '<p class="watchlist-history-label">Sin trades realizados en este ticker.</p><div class="watchlist-similar-host"></div>';
        if (item.signature !== html) {
          item.cell.innerHTML = html;
          item.cell.querySelector('.watchlist-similar-host').append(similarityPanels.get(ticker).disclosure);
          item.signature = html;
        }
        continue;
      }
      if (!item.row.hidden && !item.preparedRequested && typeof fetchGenerated === 'function') {
        item.preparedRequested = true;
        const originalDataset = dataset;
        fetchGenerated(`tickers/${ticker}.json`).then(prepared => {
          if (dataset !== originalDataset || tradeDetails.get(ticker) !== item) return;
          if (prepared?.schemaVersion === 1 && prepared.symbol === ticker && typeof queryTradeIndex !== 'undefined' && queryTradeIndex?.tickerSignatures?.[ticker] === prepared.tradeSignature) item.prepared = prepared;
          if (!item.row.hidden) updateWatchlistTradeStats();
        });
      }
      const rows = displayPnlRows(history);
      const preparedStats = typeof queryTradeIndex !== 'undefined' && queryTradeIndex && item.prepared
        ? (pnlDisplayUnit === 'r' ? item.prepared.statisticsR : item.prepared.statistics) : null;
      const usePrepared = preparedStats && preparedStats.trades === rows.length && item.prepared.tradeIds.length === history.length;
      const stats = usePrepared ? null : statistics(rows);
      const values = [
        ['Trades', String(history.length)],
        ['PnL', signed(usePrepared ? preparedStats.pnl : stats.pnl)],
        ['Win rate', pct(usePrepared ? preparedStats.wins : stats.wins.length, rows.length)],
        ['Profit factor', usePrepared ? preparedStats.profitFactorUnbounded ? '\u221e' : num(preparedStats.profitFactor) : stats.pf === Infinity ? '\u221e' : num(stats.pf)],
        ['PnL medio', money(usePrepared ? preparedStats.meanPnl ?? 0 : stats.expectancy)],
        ['Mejor trade', rows.length ? signed(usePrepared ? preparedStats.bestPnl : Math.max(...stats.values)) : '\u2014'],
        ['Peor trade', rows.length ? signed(usePrepared ? preparedStats.worstPnl : Math.min(...stats.values)) : '\u2014']
      ];
      const missing = history.length - rows.length;

      const latestDate = history.map(trade => tradePriceDate(trade)).sort().at(-1);
      const latest = history.filter(trade => tradePriceDate(trade) === latestDate).sort((a, b) => Date.parse(a.opened) - Date.parse(b.opened));
      const latestRows = displayPnlRows(latest);
      const lastRecord = getSimilarityRecords().find(record => record.trade.id === latest.at(-1).id);
      const country = incorporationCountry(dataset?.tickerProfiles?.[ticker]) || 'Sin confirmar';
      const historicalFloat = lastRecord?.float;
      const marketCap = lastRecord?.marketCap;
      const formatMillions = value => Number.isFinite(value) ? `${num(value / 1e6, 2)} M` : 'Sin dato revisado';
      const referenceValues = [['País de incorporación', country], ['Float histórico', formatMillions(historicalFloat?.value)], ['Capitalización estimada', formatMillions(marketCap?.value)]];
      const dates = [...new Set(history.map(tradePriceDate))].sort().reverse();
      const sessions = dates.map((date, index) => `<details class="watchlist-last-session"><summary>${esc(date.split('-').reverse().join('/'))}</summary>${calendarPriceMarkup(`watchlist-${item.index}-${index}`)}</details>`).join('');
      const markupValues = entries => entries.map(([name, value]) => `<div><dt>${esc(name)}</dt><dd>${esc(value)}</dd></div>`).join('');
      const referenceNote = `Referencias hist\u00f3ricas de la sesi\u00f3n ${latestDate}.${historicalFloat ? ` Float: ${historicalFloat.asOf}.` : ''}${marketCap ? ' Capitalizaci\u00f3n calculada para la entrada.' : ''}`;
      const html = `<dl class="watchlist-history-stats" title="${esc(referenceNote)}">${markupValues(referenceValues)}</dl><dl class="watchlist-history-stats watchlist-trade-stats">${markupValues(values)}</dl>${missing ? `<p class="watchlist-history-label">${missing} trades sin R excluidos de los resultados.</p>` : ''}<div class="watchlist-similar-host"></div>${sessions}`;
      if (item.signature !== html) {
        item.cell.innerHTML = html;
        item.cell.querySelector('.watchlist-similar-host').append(similarityPanels.get(ticker).disclosure);
        item.signature = html;
      }
      if (!item.row.hidden) item.cell.querySelectorAll('.calendar-ticker-price').forEach((panel, index) => {
        const session = panel.closest('details');
        if (session.availabilityRequested) return;
        session.availabilityRequested = true;
        const summary = session.querySelector('summary');
        const sessionTrades = history.filter(trade => tradePriceDate(trade) === dates[index]);
        const converted = new Map(displayPnlRows(sessionTrades).map(trade => [trade.id, trade]));
        const chartTrades = sessionTrades.map(trade => converted.get(trade.id) || { ...trade, pnl: NaN });
        let availability = 'loading';
        summary.setAttribute('aria-disabled', 'true');
        summary.addEventListener('click', event => { if (availability !== 'available' && availability !== 'unknown') event.preventDefault(); });
        session.addEventListener('toggle', () => {
          if (session.open && !panel.priceRequest) renderWatchlistPriceChart(panel, chartTrades);
        });
        fetchPriceFile('data/prices/index.json').then(indexData => {
          if (!session.isConnected) return;
          const sources = indexData.tickers?.[ticker]?.[dates[index]]?.sources || [];
          availability = sources.some(source => source.barCount === undefined || source.barCount > 0) ? 'available' : 'unavailable';
          summary.setAttribute('aria-disabled', String(availability !== 'available'));
          if (availability === 'unavailable') summary.title = 'Sin datos de precios para esta sesi\u00f3n';
        }).catch(() => {
          if (!session.isConnected) return;
          availability = 'unknown';
          summary.removeAttribute('aria-disabled');
          summary.title = 'No se ha podido comprobar la disponibilidad de precios';
        });
      });
    }
    requestAnimationFrame(fitRows);
  };

  document.getElementById('watchlist-add').disabled = !storageReadable;
  document.getElementById('watchlist-add').addEventListener('click', () => {
    if (!storageReadable || entries.length >= maxTickers) return;
    form.hidden = false;
    symbolInput.focus();
  });
  document.getElementById('watchlist-cancel').addEventListener('click', () => {
    form.reset();
    symbolInput.setCustomValidity('');
    form.hidden = true;
    document.getElementById('watchlist-add').focus();
  });
  symbolInput.addEventListener('input', () => symbolInput.setCustomValidity(''));
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!storageReadable || entries.length >= maxTickers) return;
    const ticker = symbolInput.value.trim().toUpperCase();
    if (!ticker || entries.some(entry => entry.ticker.toUpperCase() === ticker)) {
      symbolInput.setCustomValidity(ticker ? 'Este ticker ya está en la watchlist.' : 'Introduce un ticker.');
      symbolInput.reportValidity();
      return;
    }
    entries.push({ ticker });
    save();
    render();
    form.reset();
    form.hidden = true;
    const addedRow = body.querySelectorAll('.watchlist-entry')[entries.length - 1];
    const historyButton = addedRow.querySelector('.watchlist-trades-toggle');
    if (!historyButton.hidden) historyButton.click();
    addedRow.querySelector('input').focus();
  });
  window.addEventListener('resize', fitRows);
  window.addEventListener('hashchange', () => requestAnimationFrame(fitRows));
  render();
}
