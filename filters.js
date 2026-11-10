'use strict';

const tradeFilterPanels = new Map();
const comparisonGroups = new Map();
const COMPARISON_COLORS = [
  { name: 'Azul', value: '#6AA9FF' },
  { name: 'Naranja', value: '#FFAD66' },
  { name: 'Turquesa', value: '#42D6C4' },
  { name: 'Violeta', value: '#B79AFF' },
  { name: 'Rosa', value: '#F483B5' },
  { name: 'Amarillo', value: '#E7CF70' }
];
const UNKNOWN_FILTER_COUNTRY = '__unknown__';
const entryTimeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function entryMinute(trade) {
  const stamp = new Date(trade.opened);
  if (!Number.isFinite(stamp.getTime())) return null;
  const parts = entryTimeFormat.formatToParts(stamp);
  return Number(parts.find(part => part.type === 'hour').value) * 60 + Number(parts.find(part => part.type === 'minute').value);
}

function selectFilteredTrades(rows, profiles, criteria) {
  const durationMin = criteria.durationMin ?? 0, durationMax = criteria.durationMax ?? Infinity;
  if ((criteria.from && criteria.to && criteria.from > criteria.to) || criteria.timeMin > criteria.timeMax || criteria.priceMin > criteria.priceMax || durationMin > durationMax) return [];
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
    if (durationMin > 0 || durationMax < Infinity) {
      if (!Number.isFinite(trade.holdMinutes) || trade.holdMinutes < 0 || trade.holdMinutes < durationMin || trade.holdMinutes > durationMax) return false;
    }
    if (criteria.newsHours > 0 && !tradeHasNewsWithin(trade, criteria.newsHours)) return false;
    const country = incorporationCountry(profiles?.[trade.symbol]) || UNKNOWN_FILTER_COUNTRY;
    if (!criteria.countries.size) return true;
    return criteria.countryMode === 'exclude' ? !criteria.countries.has(country) : criteria.countries.has(country);
  });
}

function filterRangeMarkup(prefix, kind, label, time = false) {
  const max = time ? 1439 : 1000;
  return `<div class="filter-row"><span class="filter-label" id="${prefix}-${kind}-label">${label}</span>
    <div class="filter-range" role="group" aria-labelledby="${prefix}-${kind}-label">
      <div class="range-values"><label><span class="sr-only">${label}: mínimo${time ? ' (HH:mm)' : ''}</span><input data-bound="min" data-kind="${kind}" type="${time ? 'text' : 'number'}" ${time ? 'value="00:00" placeholder="HH:mm" maxlength="5" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" autocomplete="off" spellcheck="false"' : 'min="0" step="0.01" value="0"'}></label><span>—</span><label><span class="sr-only">${label}: máximo${time ? ' (HH:mm)' : ''}</span><input data-bound="max" data-kind="${kind}" type="${time ? 'text' : 'number'}" ${time ? 'value="23:59" placeholder="HH:mm" maxlength="5" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" autocomplete="off" spellcheck="false"' : 'min="0" step="0.01" placeholder="Sin límite"'}></label></div>
      <div class="dual-range" style="--range-start:0%;--range-end:100%"><div class="range-track"></div>
        <input type="range" min="0" max="${max}" value="0" data-slider="${kind}" data-bound="min" aria-label="${label}: mínimo">
        <input type="range" min="0" max="${max}" value="${max}" data-slider="${kind}" data-bound="max" aria-label="${label}: máximo">
      </div><small>${time ? 'Hora de entrada · Nueva York · 24 h (HH:mm)' : 'Precio de entrada en USD · escala ampliada en precios bajos'}</small>
    </div></div>`;
}

class TradeFilterPanel {
  constructor(key, host, onChange, defaultSide = 'all') {
    this.key = key;
    this.host = host;
    this.onChange = onChange;
    this.priceCeiling = 1;
    this.countries = new Set();
    this.countryMode = 'include';
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
      <div class="filter-row"><span class="filter-label" id="${prefix}-duration-label">Duración (min)</span>
        <div class="filter-range" role="group" aria-labelledby="${prefix}-duration-label">
          <div class="range-values"><label><span class="sr-only">Duración mínima en minutos</span><input type="number" min="0" step="any" value="0" data-kind="duration" data-bound="min"></label><span>—</span><label><span class="sr-only">Duración máxima en minutos</span><input type="number" min="0" step="any" placeholder="Sin límite" data-kind="duration" data-bound="max"></label></div>
          <small>Minutos entre apertura y cierre · límites incluidos</small>
        </div></div>
      <div class="filter-row"><label class="filter-label" for="${prefix}-news">Noticias previas</label>
        <div class="filter-range"><div class="news-range-heading"><span>Antigüedad máxima</span><output for="${prefix}-news" data-news-value>Sin filtro</output></div>
          <input id="${prefix}-news" class="news-filter-slider" type="range" min="0" max="100" step="1" value="0" data-field="news" aria-valuetext="Sin filtro" style="--news-fill:0%">
          <div class="news-range-endpoints"><span>Sin filtro</span><span>48 h</span></div>
          <small>Solo operaciones con noticia en la ventana elegida. Sin hora: mismo día en cualquier valor positivo; día anterior = 24 h; dos días antes = 48 h, según Nueva York. Una coincidencia del mismo día no confirma que precediera a la entrada. Cobertura parcial.</small>
        </div></div>
      <div class="filter-row country-filter-row"><span class="filter-label" id="${prefix}-countries-label">País de constitución</span><div><div class="country-toggles" role="group" aria-labelledby="${prefix}-countries-label"></div><small>Clic izquierdo: solo los seleccionados. Clic derecho o Mayús + clic: todos menos los seleccionados. Cambiar de modo sustituye la selección. Sin selección: todos.</small><small class="country-filter-state" aria-live="polite"></small></div></div>
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
        this.toggleCountry(toggle.dataset.country, event.shiftKey ? 'exclude' : 'include');
      }
      if (event.target.closest('[data-clear]')) this.reset();
      if (event.target.closest('[data-apply]')) this.apply();
    });
    host.addEventListener('contextmenu', event => {
      const toggle = event.target.closest('[data-country]');
      if (!toggle) return;
      event.preventDefault();
      this.toggleCountry(toggle.dataset.country, 'exclude');
    });
  }

  field(name) { return this.host.querySelector(`[data-field="${name}"]`); }
  bound(kind, bound) { return this.host.querySelector(`[data-kind="${kind}"][data-bound="${bound}"]`); }
  slider(kind, bound) { return this.host.querySelector(`[data-slider="${kind}"][data-bound="${bound}"]`); }

  toggleCountry(country, mode) {
    if (mode !== this.countryMode) this.countries.clear();
    this.countryMode = mode;
    if (this.countries.has(country)) this.countries.delete(country); else this.countries.add(country);
    this.syncCountryToggles();
    this.changed();
  }

  syncCountryToggles() {
    this.host.querySelectorAll('[data-country]').forEach(button => {
      const selected = this.countries.has(button.dataset.country);
      const excluded = selected && this.countryMode === 'exclude';
      const name = button.dataset.country === UNKNOWN_FILTER_COUNTRY ? 'Sin identificar' : button.dataset.country;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('excluded', excluded);
      button.setAttribute('aria-label', `${name}: ${selected ? excluded ? 'excluido' : 'incluido' : 'sin seleccionar'}`);
      button.title = `${name}${selected ? excluded ? ' · Excluido' : ' · Incluido' : ''}. Clic izquierdo: incluir. Clic derecho o Mayús + clic: excluir.`;
    });
    const status = this.host.querySelector('.country-filter-state');
    if (status) status.textContent = !this.countries.size ? '' : this.countryMode === 'exclude'
      ? `Todos excepto ${this.countries.size} ${this.countries.size === 1 ? 'país marcado' : 'países marcados'} en rojo.`
      : `Solo ${this.countries.size} ${this.countries.size === 1 ? 'país seleccionado' : 'países seleccionados'}.`;
  }

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
    this.syncCountryToggles();
    if (!preserve) {
      this.reset(false);
      this.appliedCriteria = this.snapshot();
      this.pending = false;
      this.validationMessage = '';
    }
    this.syncRange('price');
    this.syncNewsRange();
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
      if (isTime) {
        if (input.value && !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(input.value)) continue;
        const [hour, minute] = (input.value || (bound === 'min' ? '00:00' : '23:59')).split(':').map(Number);
        value = hour * 60 + minute;
      }
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

  syncNewsRange() {
    const input = this.field('news');
    const position = Number(input.value);
    const label = position ? `${Number((position * 0.48).toFixed(2)).toLocaleString('es-ES', { maximumFractionDigits: 2 })} h` : 'Sin filtro';
    input.style.setProperty('--news-fill', `${position}%`);
    input.setAttribute('aria-valuetext', label);
    this.host.querySelector('[data-news-value]').textContent = label;
  }

  handleInput(event) {
    const input = event.target;
    if (input.dataset.field === 'period') return;
    if (input.dataset.field === 'news') this.syncNewsRange();
    else if (input.dataset.slider) {
      const kind = input.dataset.slider, bound = input.dataset.bound;
      const other = this.slider(kind, bound === 'min' ? 'max' : 'min');
      input.value = bound === 'min' ? Math.min(Number(input.value), Number(other.value)) : Math.max(Number(input.value), Number(other.value));
      const value = Number(input.value);
      this.bound(kind, bound).value = kind === 'time' ? `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}` : bound === 'max' && value === 1000 ? '' : (Math.expm1(value / 1000 * Math.log1p(this.priceCeiling))).toFixed(2);
      this.syncRange(kind);
    } else if (input.dataset.kind && input.dataset.kind !== 'duration') this.syncRange(input.dataset.kind);
    this.changed();
  }

  criteria() {
    const minutes = value => { const [hour, minute] = value.split(':').map(Number); return hour * 60 + minute; };
    return { from: this.field('from').value, to: this.field('to').value, symbol: this.field('symbol').value.trim().toUpperCase(), side: this.field('side').value,
      timeMin: minutes(this.bound('time', 'min').value || '00:00'), timeMax: minutes(this.bound('time', 'max').value || '23:59'),
      durationMin: Number(this.bound('duration', 'min').value || 0), durationMax: this.bound('duration', 'max').value === '' ? Infinity : Number(this.bound('duration', 'max').value),
      newsHours: Number((Number(this.field('news').value || 0) * 0.48).toFixed(2)),
      priceMin: Number(this.bound('price', 'min').value || 0), priceMax: this.bound('price', 'max').value === '' ? Infinity : Number(this.bound('price', 'max').value), countries: this.countries, countryMode: this.countryMode || 'include' };
  }

  snapshot() {
    const criteria = this.criteria();
    return { ...criteria, countries: new Set(criteria.countries) };
  }

  apply() {
    const criteria = this.snapshot();
    const invalid = [...this.host.querySelectorAll('input')].some(input => !input.validity.valid) ||
      (criteria.from && criteria.to && criteria.from > criteria.to) || criteria.timeMin > criteria.timeMax || criteria.priceMin > criteria.priceMax || criteria.durationMin > criteria.durationMax;
    if (invalid) {
      this.validationMessage = 'Revisa los rangos y las horas (HH:mm, de 00:00 a 23:59). El mínimo debe ser menor o igual al máximo.';
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
    const newsUnavailable = this.appliedCriteria.newsHours > 0 && !issuerNewsAvailable;
    status.textContent = this.validationMessage || `${integerFormat.format(this.appliedCount)} operaciones${this.pending ? ' · Cambios sin aplicar' : ''}${newsUnavailable ? ' · Noticias no disponibles para verificar coincidencias' : ''}`;
    status.classList.toggle('warning', this.pending || Boolean(this.validationMessage) || newsUnavailable);
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
    this.bound('duration', 'min').value = '0'; this.bound('duration', 'max').value = '';
    this.field('news').value = '0'; this.syncNewsRange();
    this.countries.clear();
    this.countryMode = 'include';
    this.syncCountryToggles();
    this.syncRange('time'); this.syncRange('price');
    if (!notify) this.field('side').value = this.initialSide;
    if (notify) this.changed();
  }
}

function initializeTradeFilters() {
  tradeFilterPanels.set('general', new TradeFilterPanel('general', $('global-filters'), applyFilters));
  addComparisonGroup('BUY');
  addComparisonGroup('SELL');
  $('compare-add-group').addEventListener('click', () => addComparisonGroup('all', true));
  $('comparison-groups').addEventListener('click', event => {
    const color = event.target.closest('[data-group-color]');
    if (color) {
      setComparisonGroupColor(color.dataset.group, color.dataset.groupColor);
      const picker = color.closest('details');
      picker.open = false;
      picker.querySelector('summary').focus();
    }
    const remove = event.target.closest('[data-remove-group]');
    if (remove) removeComparisonGroup(remove.dataset.removeGroup);
  });
  $('comparison-groups').addEventListener('toggle', event => {
    if (!event.target.matches('.group-color-picker') || !event.target.open) return;
    document.querySelectorAll('.group-color-picker[open]').forEach(picker => { if (picker !== event.target) picker.open = false; });
  }, true);
  document.addEventListener('click', event => {
    document.querySelectorAll('.group-color-picker[open]').forEach(picker => { if (!picker.contains(event.target)) picker.open = false; });
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    document.querySelectorAll('.group-color-picker[open]').forEach(picker => {
      picker.open = false;
      picker.querySelector('summary').focus();
    });
  });
}

function comparisonGroupList() {
  return [...comparisonGroups.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function nextComparisonGroup() {
  const key = ['a', 'b', 'c', 'd', 'e', 'f'].find(value => !comparisonGroups.has(value));
  const color = COMPARISON_COLORS.find(option => !comparisonGroupList().some(group => group.color === option.value));
  return key && color ? { key, name: `Grupo ${key.toUpperCase()}`, color: color.value } : null;
}

function addComparisonGroup(defaultSide = 'all', focus = false) {
  const group = nextComparisonGroup();
  if (!group) return null;
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'comparison-group';
  fieldset.id = `comparison-group-${group.key}`;
  fieldset.innerHTML = `<legend>${group.name}</legend><div class="comparison-group-toolbar"><details class="group-color-picker"><summary aria-label="Elegir color de ${group.name}"><span class="group-color-dot" aria-hidden="true"></span>Color <span aria-hidden="true">▾</span></summary><div class="group-color-options" role="group" aria-label="Colores de ${group.name}">${COMPARISON_COLORS.map(color => `<button type="button" data-group="${group.key}" data-group-color="${color.value}" style="--swatch-color:${color.value}" aria-label="${color.name}" title="${color.name}"><span aria-hidden="true">✓</span></button>`).join('')}<small>Los colores en uso por otros grupos no están disponibles.</small></div></details><button type="button" class="secondary group-remove" data-remove-group="${group.key}" aria-label="Eliminar ${group.name}">Eliminar</button></div><div id="compare-${group.key}-filters"></div>`;
  const following = comparisonGroupList().find(existing => existing.key > group.key);
  $('comparison-groups').insertBefore(fieldset, following ? $(`comparison-group-${following.key}`) : null);
  comparisonGroups.set(group.key, group);
  const panel = new TradeFilterPanel(group.key, $(`compare-${group.key}-filters`), renderComparisons, defaultSide);
  tradeFilterPanels.set(group.key, panel);
  if (dataset) panel.populate(dataset.trades, dataset.tickerProfiles, false);
  initializeFilterControlHelp(fieldset);
  updateComparisonGroupControls();
  if (typeof tableSortStates !== 'undefined') tableSortStates.delete('compare-table');
  renderComparisons();
  if (focus) panel.field('symbol').focus();
  return group;
}

function removeComparisonGroup(key) {
  if (comparisonGroups.size <= 2 || !comparisonGroups.has(key)) return false;
  comparisonGroups.delete(key);
  tradeFilterPanels.delete(key);
  $(`comparison-group-${key}`).remove();
  if (typeof tableSortStates !== 'undefined') tableSortStates.delete('compare-table');
  updateComparisonGroupControls();
  renderComparisons();
  $('compare-add-group').focus();
  return true;
}

function setComparisonGroupColor(key, color) {
  const group = comparisonGroups.get(key);
  if (!group || !COMPARISON_COLORS.some(option => option.value === color) || comparisonGroupList().some(other => other.key !== key && other.color === color)) return false;
  group.color = color;
  updateComparisonGroupControls();
  renderComparisons();
  return true;
}

function updateComparisonGroupControls() {
  $('compare-add-group').disabled = comparisonGroups.size >= COMPARISON_COLORS.length;
  $('compare-group-count').textContent = `${comparisonGroups.size} de 6 grupos`;
  for (const group of comparisonGroupList()) {
    const fieldset = $(`comparison-group-${group.key}`);
    fieldset.style.setProperty('--group-color', group.color);
    fieldset.querySelector('[data-remove-group]').hidden = comparisonGroups.size <= 2;
    fieldset.querySelectorAll('[data-group-color]').forEach(button => {
      const color = button.dataset.groupColor;
      button.disabled = comparisonGroupList().some(other => other.key !== group.key && other.color === color);
      button.setAttribute('aria-pressed', String(color === group.color));
    });
  }
}
