'use strict';

let updateWatchlistTradeStats = () => {};

function initializeWatchlist() {
  const storageKey = 'track-watchlist-v1';
  const maxTickers = 20;
  const fields = [
    ['country', 'Country', 'text'],
    ['float', 'Float (M)', 'number'],
    ['marketCap', 'Mk (M USD)', 'number'],
    ['news', 'News', 'textarea'],
    ['institutionalOwnership', 'IO (%)', 'number'],
    ['dilutionHistory', 'Dilution Hist', 'textarea'],
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
  const tradeDetails = new Map();
  let entries = [];
  let storageReadable = true;
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

  function updateMarketCap(control) {
    const exceedsLimit = control.value !== '' && Number(control.value) > 90;
    control.classList.toggle('watchlist-market-cap-high', exceedsLimit);
    control.title = exceedsLimit ? 'Market cap superior a 90 millones USD' : '';
  }

  function fitRows() {
    const view = document.getElementById('view-watchlist');
    if (view.hidden) return;
    const table = body.closest('table');
    const toolbar = view.querySelector('.watchlist-toolbar');
    const expandedHeight = [...tradeDetails.values()].reduce((total, item) => total + (item.row.hidden ? 0 : item.row.offsetHeight), 0);
    const available = window.innerHeight - table.getBoundingClientRect().top - table.tHead.offsetHeight - toolbar.offsetHeight - expandedHeight - 28;
    view.style.setProperty('--watchlist-row-height', `${Math.min(30, Math.max(10, Math.floor(available / maxTickers)))}px`);
  }

  function render() {
    tradeDetails.clear();
    body.replaceChildren();
    document.getElementById('watchlist-add').disabled = !storageReadable || entries.length >= maxTickers;
    entries.forEach((entry, index) => {
      const row = document.createElement('tr');
      const tickerCell = document.createElement('th');
      tickerCell.scope = 'row';
      const tickerLabel = document.createElement('span');
      tickerLabel.textContent = entry.ticker;
      tickerCell.append(tickerLabel);
      tickerCell.title = entry.ticker;
      const expand = document.createElement('button');
      expand.type = 'button';
      expand.className = 'watchlist-trades-toggle';
      expand.textContent = '\u25be';
      expand.hidden = true;
      expand.setAttribute('aria-expanded', 'false');
      expand.setAttribute('aria-label', `Ver estad\u00edsticas de ${entry.ticker}`);
      tickerCell.append(expand);
      row.append(tickerCell);
      fields.forEach(([key, label, type]) => {
        const cell = document.createElement('td');
        const control = document.createElement(type === 'textarea' ? 'textarea' : type === 'select' ? 'select' : 'input');
        control.setAttribute('aria-label', `${entry.ticker}: ${label}`);
        if (type === 'select') {
          for (const [value, text] of [['', 'Sin definir'], ['near', 'Cerca'], ['far', 'Lejos']]) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = text;
            control.append(option);
          }
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
        if (key === 'marketCap') updateMarketCap(control);
        control.addEventListener('input', () => {
          entry[key] = control.value;
          if (key === 'marketCap') updateMarketCap(control);
          save();
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
      const detailRow = document.createElement('tr');
      detailRow.className = 'watchlist-trade-details';
      detailRow.id = `watchlist-trades-${index}`;
      detailRow.hidden = true;
      const detailCell = document.createElement('td');
      detailCell.colSpan = fields.length + 2;
      detailRow.append(detailCell);
      body.append(detailRow);
      expand.setAttribute('aria-controls', detailRow.id);
      expand.addEventListener('click', () => {
        const opening = detailRow.hidden;
        for (const item of tradeDetails.values()) {
          item.row.hidden = true;
          item.button.setAttribute('aria-expanded', 'false');
        }
        detailRow.hidden = !opening;
        expand.setAttribute('aria-expanded', String(opening));
        requestAnimationFrame(fitRows);
      });
      tradeDetails.set(entry.ticker, { row: detailRow, cell: detailCell, button: expand });
    });
    updateWatchlistTradeStats();
    requestAnimationFrame(fitRows);
  }

  updateWatchlistTradeStats = () => {
    for (const [ticker, item] of tradeDetails) {
      const history = (dataset?.trades || []).filter(trade => trade.symbol.toUpperCase() === ticker.toUpperCase());
      item.button.hidden = history.length === 0;
      if (!history.length) {
        item.row.hidden = true;
        item.button.setAttribute('aria-expanded', 'false');
        continue;
      }
      const rows = displayPnlRows(history);
      const stats = statistics(rows);
      const values = [
        ['Trades', String(history.length)],
        ['PnL', signed(stats.pnl)],
        ['Win rate', pct(stats.wins.length, rows.length)],
        ['Profit factor', stats.pf === Infinity ? '\u221e' : num(stats.pf)],
        ['PnL medio', money(stats.expectancy)],
        ['Mejor trade', rows.length ? signed(Math.max(...stats.values)) : '\u2014'],
        ['Peor trade', rows.length ? signed(Math.min(...stats.values)) : '\u2014']
      ];
      const missing = history.length - rows.length;
      const label = `${ticker} \u00b7 Historial completo \u00b7 ${pnlDisplayUnit === 'r' ? 'R' : 'USD'}${missing ? ` \u00b7 ${missing} trades sin R excluidos de los resultados` : ''}`;
      const html = `<div class="watchlist-history-label">${esc(label)}</div><dl class="watchlist-history-stats">${values.map(([name, value]) => `<div><dt>${esc(name)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`;
      if (item.cell.innerHTML !== html) item.cell.innerHTML = html;
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
    body.lastElementChild.previousElementSibling.querySelector('input').focus();
  });
  window.addEventListener('resize', fitRows);
  window.addEventListener('hashchange', () => requestAnimationFrame(fitRows));
  render();
}
