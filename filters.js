'use strict';

const tradeFilterPanels = new Map();
const UNKNOWN_FILTER_COUNTRY = '__unknown__';
const entryTimeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function entryMinute(trade) {
  const stamp = new Date(trade.opened);
  if (!Number.isFinite(stamp.getTime())) return null;
  const parts = entryTimeFormat.formatToParts(stamp);
  return Number(parts.find(part => part.type === 'hour').value) * 60 + Number(parts.find(part => part.type === 'minute').value);
}

function selectFilteredTrades(rows, profiles, criteria) {
  if ((criteria.from && criteria.to && criteria.from > criteria.to) || criteria.timeMin > criteria.timeMax || criteria.priceMin > criteria.priceMax) return [];
  return rows.filter(trade => {
    if ((criteria.from && trade.date < criteria.from) || (criteria.to && trade.date > criteria.to)) return false;
    if (criteria.symbol && trade.symbol !== criteria.symbol) return false;
    if (criteria.side !== 'all' && trade.side !== criteria.side) return false;
    if (criteria.timeMin > 0 || criteria.timeMax < 1439) {
      const minute = entryMinute(trade);
      if (minute === null || minute < criteria.timeMin || minute > criteria.timeMax) return false;
    }
    if (criteria.priceMin > 0 || criteria.priceMax < Infinity) {
      if (!Number.isFinite(trade.entryPrice) || trade.entryPrice < criteria.priceMin || trade.entryPrice > criteria.priceMax) return false;
    }
    const country = incorporationCountry(profiles?.[trade.symbol]) || UNKNOWN_FILTER_COUNTRY;
    return !criteria.countries.size || criteria.countries.has(country);
  });
}

function filterRangeMarkup(prefix, kind, label, time = false) {
  const max = time ? 1439 : 1000;
  return `<div class="filter-row"><span class="filter-label" id="${prefix}-${kind}-label">${label}</span>
    <div class="filter-range" role="group" aria-labelledby="${prefix}-${kind}-label">
      <div class="range-values"><label><span class="sr-only">${label}: mínimo</span><input data-bound="min" data-kind="${kind}" type="${time ? 'time' : 'number'}" ${time ? 'step="60" value="00:00"' : 'min="0" step="0.01" value="0"'}></label><span>—</span><label><span class="sr-only">${label}: máximo</span><input data-bound="max" data-kind="${kind}" type="${time ? 'time' : 'number'}" ${time ? 'step="60" value="23:59"' : 'min="0" step="0.01" placeholder="Sin límite"'}></label></div>
      <div class="dual-range" style="--range-start:0%;--range-end:100%"><div class="range-track"></div>
        <input type="range" min="0" max="${max}" value="0" data-slider="${kind}" data-bound="min" aria-label="${label}: mínimo">
        <input type="range" min="0" max="${max}" value="${max}" data-slider="${kind}" data-bound="max" aria-label="${label}: máximo">
      </div><small>${time ? 'Hora de entrada · Nueva York' : 'Precio de entrada en USD · escala ampliada en precios bajos'}</small>
    </div></div>`;
}

class TradeFilterPanel {
  constructor(key, host, onChange, defaultSide = 'all') {
    this.key = key;
    this.host = host;
    this.onChange = onChange;
    this.priceCeiling = 1;
    this.countries = new Set();
    this.rows = [];
    this.profiles = {};
    this.initialSide = defaultSide;
    this.pending = false;
    this.validationMessage = '';
    this.appliedCount = 0;
    const prefix = `filter-${key}`;
    host.classList.add('trade-filter-panel');
    host.innerHTML = `<div class="filter-row"><label class="filter-label" for="${prefix}-period">Fechas</label><div class="filter-date-controls"><select id="${prefix}-period" data-field="period" aria-label="Periodo"><option value="all">Todo el historial</option><option value="custom">Rango personalizado</option></select><div class="filter-date-range" hidden><label>Desde<input type="date" data-field="from"></label><label>Hasta<input type="date" data-field="to"></label></div></div></div>
      ${filterRangeMarkup(prefix, 'time', 'Hora de entrada', true)}
      <div class="filter-row"><label class="filter-label" for="${prefix}-symbol">Símbolo</label><input id="${prefix}-symbol" type="text" data-field="symbol" placeholder="Escribe el ticker · vacío: todos" autocomplete="off" spellcheck="false" autocapitalize="characters"></div>
      <div class="filter-row"><label class="filter-label" for="${prefix}-side">Dirección</label><select id="${prefix}-side" data-field="side"><option value="all">Todas</option><option value="BUY">Long</option><option value="SELL">Short</option></select></div>
      ${filterRangeMarkup(prefix, 'price', 'Precio de entrada')}
      <div class="filter-row country-filter-row"><span class="filter-label" id="${prefix}-countries-label">País de constitución</span><div><div class="country-toggles" role="group" aria-labelledby="${prefix}-countries-label"></div><small>Sin selección: todos los países. Puedes activar varios.</small></div></div>
      <div class="filter-footer"><span class="filter-count" role="status" aria-live="polite"></span><div class="filter-actions"><button type="button" class="secondary" data-clear>Limpiar filtros</button><button type="button" data-apply>Aplicar filtros</button></div></div>`;
    this.field('side').value = defaultSide;
    this.appliedCriteria = this.snapshot();
    host.addEventListener('input', event => this.handleInput(event));
    host.addEventListener('change', event => {
      if (event.target.dataset.field === 'period') {
        this.setPeriod();
        this.changed();
      }
    });
    host.addEventListener('click', event => {
      const toggle = event.target.closest('[data-country]');
      if (toggle) {
        const country = toggle.dataset.country;
        if (this.countries.has(country)) this.countries.delete(country); else this.countries.add(country);
        toggle.setAttribute('aria-pressed', String(this.countries.has(country)));
        this.changed();
      }
      if (event.target.closest('[data-clear]')) this.reset();
      if (event.target.closest('[data-apply]')) this.apply();
    });
  }

  field(name) { return this.host.querySelector(`[data-field="${name}"]`); }
  bound(kind, bound) { return this.host.querySelector(`[data-kind="${kind}"][data-bound="${bound}"]`); }
  slider(kind, bound) { return this.host.querySelector(`[data-slider="${kind}"][data-bound="${bound}"]`); }

  populate(rows, profiles, preserve = true) {
    this.rows = rows;
    this.profiles = profiles;
    this.priceCeiling = Math.max(1, ...rows.map(trade => trade.entryPrice).filter(Number.isFinite));
    const period = this.field('period'), previous = preserve ? period.value : 'all';
    const years = [...new Set(rows.map(trade => trade.date.slice(0, 4)))].sort().reverse();
    const months = [...new Set(rows.map(trade => trade.date.slice(0, 7)))].sort().reverse();
    period.innerHTML = '<option value="all">Todo el historial</option><option value="custom">Rango personalizado</option>' +
      `<optgroup label="Años">${years.map(year => `<option value="year:${year}">${year}</option>`).join('')}</optgroup>` +
      `<optgroup label="Meses">${months.map(month => `<option value="month:${month}">${esc(new Date(`${month}-01T12:00:00Z`).toLocaleDateString('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' }))}</option>`).join('')}</optgroup>`;
    period.value = [...period.options].some(option => option.value === previous) ? previous : 'all';
    const countries = [...new Set(rows.map(trade => incorporationCountry(profiles?.[trade.symbol])).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const available = new Set([...countries, UNKNOWN_FILTER_COUNTRY]);
    this.countries = new Set([...this.countries].filter(country => available.has(country)));
    this.host.querySelector('.country-toggles').innerHTML = [...countries, UNKNOWN_FILTER_COUNTRY].map(country => `<button type="button" data-country="${esc(country)}" aria-pressed="${this.countries.has(country)}">${esc(country === UNKNOWN_FILTER_COUNTRY ? 'Sin identificar' : country)}</button>`).join('');
    if (!preserve) {
      this.reset(false);
      this.appliedCriteria = this.snapshot();
      this.pending = false;
      this.validationMessage = '';
    }
    this.syncRange('price');
  }

  setPeriod() {
    const value = this.field('period').value;
    this.host.querySelector('.filter-date-range').hidden = value !== 'custom';
    if (value === 'custom') return;
    let from = '', to = '';
    if (value.startsWith('year:')) { const year = value.slice(5); from = `${year}-01-01`; to = `${year}-12-31`; }
    if (value.startsWith('month:')) {
      const month = value.slice(6), [year, number] = month.split('-').map(Number);
      from = `${month}-01`; to = new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
    }
    this.field('from').value = from;
    this.field('to').value = to;
  }

  syncRange(kind) {
    const isTime = kind === 'time', maximum = isTime ? 1439 : 1000;
    for (const bound of ['min', 'max']) {
      const input = this.bound(kind, bound), slider = this.slider(kind, bound);
      let value;
      if (isTime) { const [hour, minute] = (input.value || (bound === 'min' ? '00:00' : '23:59')).split(':').map(Number); value = hour * 60 + minute; }
      else value = input.value === '' ? (bound === 'max' ? maximum : 0) : Math.log1p(Number(input.value)) / Math.log1p(this.priceCeiling) * maximum;
      slider.value = Math.max(0, Math.min(maximum, value));
      slider.setAttribute('aria-valuetext', isTime ? input.value : input.value === '' ? 'Sin límite' : `$${input.value}`);
    }
    const low = Number(this.slider(kind, 'min').value), high = Number(this.slider(kind, 'max').value);
    const track = this.slider(kind, 'min').parentElement;
    track.style.setProperty('--range-start', `${low / maximum * 100}%`);
    track.style.setProperty('--range-end', `${high / maximum * 100}%`);
    this.slider(kind, 'min').style.zIndex = low >= maximum - 1 ? '4' : '2';
  }

  handleInput(event) {
    const input = event.target;
    if (input.dataset.field === 'period') return;
    if (input.dataset.slider) {
      const kind = input.dataset.slider, bound = input.dataset.bound;
      const other = this.slider(kind, bound === 'min' ? 'max' : 'min');
      input.value = bound === 'min' ? Math.min(Number(input.value), Number(other.value)) : Math.max(Number(input.value), Number(other.value));
      const value = Number(input.value);
      this.bound(kind, bound).value = kind === 'time' ? `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}` : bound === 'max' && value === 1000 ? '' : (Math.expm1(value / 1000 * Math.log1p(this.priceCeiling))).toFixed(2);
      this.syncRange(kind);
    } else if (input.dataset.kind) this.syncRange(input.dataset.kind);
    this.changed();
  }

  criteria() {
    const minutes = value => { const [hour, minute] = value.split(':').map(Number); return hour * 60 + minute; };
    return { from: this.field('from').value, to: this.field('to').value, symbol: this.field('symbol').value.trim().toUpperCase(), side: this.field('side').value,
      timeMin: minutes(this.bound('time', 'min').value || '00:00'), timeMax: minutes(this.bound('time', 'max').value || '23:59'),
      priceMin: Number(this.bound('price', 'min').value || 0), priceMax: this.bound('price', 'max').value === '' ? Infinity : Number(this.bound('price', 'max').value), countries: this.countries };
  }

  snapshot() {
    const criteria = this.criteria();
    return { ...criteria, countries: new Set(criteria.countries) };
  }

  apply() {
    const criteria = this.snapshot();
    const invalid = [...this.host.querySelectorAll('input')].some(input => !input.validity.valid) ||
      (criteria.from && criteria.to && criteria.from > criteria.to) || criteria.timeMin > criteria.timeMax || criteria.priceMin > criteria.priceMax;
    if (invalid) {
      this.validationMessage = 'Revisa los rangos: el mínimo debe ser menor o igual al máximo.';
      this.updateStatus();
      return;
    }
    this.appliedCriteria = criteria;
    this.pending = false;
    this.validationMessage = '';
    this.onChange();
  }

  matchingRows() {
    const rows = selectFilteredTrades(this.rows, this.profiles, this.appliedCriteria);
    this.appliedCount = rows.length;
    this.updateStatus();
    return rows;
  }

  updateStatus() {
    const status = this.host.querySelector('.filter-count');
    status.textContent = this.validationMessage || `${integerFormat.format(this.appliedCount)} operaciones${this.pending ? ' · Cambios sin aplicar' : ''}`;
    status.classList.toggle('warning', this.pending || Boolean(this.validationMessage));
  }

  changed() {
    this.pending = true;
    this.validationMessage = '';
    this.updateStatus();
  }

  reset(notify = true) {
    this.field('period').value = 'all'; this.setPeriod();
    this.field('symbol').value = ''; this.field('side').value = 'all';
    this.bound('time', 'min').value = '00:00'; this.bound('time', 'max').value = '23:59';
    this.bound('price', 'min').value = '0'; this.bound('price', 'max').value = '';
    this.countries.clear();
    this.host.querySelectorAll('[data-country]').forEach(button => button.setAttribute('aria-pressed', 'false'));
    this.syncRange('time'); this.syncRange('price');
    if (!notify) this.field('side').value = this.initialSide;
    if (notify) this.changed();
  }
}

function initializeTradeFilters() {
  tradeFilterPanels.set('general', new TradeFilterPanel('general', $('global-filters'), applyFilters));
  for (const key of ['a', 'b']) tradeFilterPanels.set(key, new TradeFilterPanel(key, $(`compare-${key}-filters`), renderComparisons, key === 'a' ? 'BUY' : 'SELL'));
}
