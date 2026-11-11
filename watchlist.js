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
  const table = body.closest('table');
  const columns = [...table.querySelectorAll('col')];
  const headers = [...table.tHead.rows[0].cells];
  const layoutKey = 'track-watchlist-columns-v3';
  const tradeDetails = new Map();
  let webPanel = null;
  let activeWebLink = null;
  let entries = [];
  let storageReadable = true;

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

  function updateMarketCap(control) {
    const exceedsLimit = control.value !== '' && Number(control.value) > 90;
    control.classList.toggle('watchlist-market-cap-high', exceedsLimit);
    control.title = exceedsLimit ? 'Market cap superior a 90 millones USD' : '';
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
    const table = body.closest('table');
    const toolbar = view.querySelector('.watchlist-toolbar');
    const expandedHeight = [...tradeDetails.values()].reduce((total, item) => total + (item.row.hidden ? 0 : item.row.offsetHeight), 0);
    const linksHeight = [...body.querySelectorAll('.watchlist-links-row')].reduce((total, row) => total + row.offsetHeight, 0);
    const available = window.innerHeight - table.getBoundingClientRect().top - table.tHead.offsetHeight - toolbar.offsetHeight - expandedHeight - linksHeight - 28;
    view.style.setProperty('--watchlist-row-height', `${Math.min(42, Math.max(10, Math.floor(available / Math.max(1, entries.length))))}px`);
  }

  function render() {
    closeWebPanel();
    tradeDetails.clear();
    body.replaceChildren();
    document.getElementById('watchlist-add').disabled = !storageReadable || entries.length >= maxTickers;
    entries.forEach((entry, index) => {
      const row = document.createElement('tr');
      row.className = 'watchlist-entry';
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
        if (key === 'zeroZone') control.classList.add('watchlist-zero-zone');
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
      const quantLink = document.createElement('a');
      quantLink.className = 'watchlist-link';
      quantLink.textContent = 'Quant';
      quantLink.href = `https://quantyouredge.com/chart/${encodeURIComponent(entry.ticker)}`;
      quantLink.target = '_blank';
      quantLink.rel = 'noopener noreferrer';
      quantLink.setAttribute('aria-label', `Abrir ${entry.ticker} en Quant (nueva pesta\u00f1a)`);
      for (const link of [dilutionLink, finvizLink, quantLink]) {
        link.setAttribute('aria-label', `Ver ${entry.ticker} en ${link.textContent} dentro de Watchlist`);
        link.setAttribute('aria-expanded', 'false');
        link.addEventListener('click', event => {
          if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          openWebPanel(link, linksRow, entry.ticker);
        });
      }
      linksCell.append(dilutionLink, document.createTextNode(' '), finvizLink, document.createTextNode(' '), quantLink);
      linksRow.append(tickerSpacer, linksCell);
      body.append(linksRow);
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
    body.querySelectorAll('.watchlist-entry')[entries.length - 1].querySelector('input').focus();
  });
  window.addEventListener('resize', fitRows);
  window.addEventListener('hashchange', () => requestAnimationFrame(fitRows));
  render();
}
