'use strict';

const tableSortStates = new Map();
const preparedTables = new WeakSet();
const tableCollator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
const tableDisclosureStates = new WeakMap();

function prepareCollapsibleTables() {
  document.querySelectorAll('.table-wrap').forEach(host => {
    const rowCount = [...host.querySelectorAll('table > tbody > tr')].length;
    let state = tableDisclosureStates.get(host);
    if (rowCount <= 10) {
      if (state?.details.isConnected) {
        state.details.before(host);
        state.details.remove();
      }
      return;
    }
    if (!state) {
      const details = document.createElement('details');
      details.className = 'table-disclosure';
      const summary = document.createElement('summary');
      details.append(summary);
      state = { details, summary, rowCount };
      tableDisclosureStates.set(host, state);
      details.addEventListener('toggle', () => {
        summary.textContent = `${details.open ? 'Ocultar' : 'Ver'} tabla · ${state.rowCount} filas`;
      });
    }
    state.rowCount = rowCount;
    const label = `${state.details.open ? 'Ocultar' : 'Ver'} tabla · ${rowCount} filas`;
    if (state.summary.textContent !== label) state.summary.textContent = label;
    if (!state.details.isConnected) {
      host.before(state.details);
      state.details.append(host);
    }
  });
}

function tableSortValue(value, heading = '') {
  const text = String(value ?? '').trim();
  if (!text || /^(?:—|–|-|N\/A|Sin confirmar|Pendiente)$/i.test(text)) return null;
  if (/^[+-]?∞$/.test(text)) return text.startsWith('-') ? -Infinity : Infinity;
  const numeric = text.replace(/[$€£\s]/g, '').replace(/(?:%|x|min)$/i, '');
  if (/^[+-]?\d[\d.,]*$/.test(numeric)) {
    const normalized = /^(?:Operaciones|Shares)$/i.test(heading)
      ? numeric.replace(/[.,]/g, '') : numeric.replace(/,/g, '');
    return Number(normalized);
  }
  return text;
}

function compareTableValues(left, right, direction = 'ascending') {
  if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
  const result = typeof left === 'number' && typeof right === 'number'
    ? (left === right ? 0 : left < right ? -1 : 1)
    : tableCollator.compare(String(left), String(right));
  return direction === 'ascending' ? result : -result;
}

function tableSortKey(table) {
  return table.id || table.parentElement.closest('[id]')?.id;
}

function cellSortValue(cell, heading) {
  if (!cell) return null;
  if (cell.hasAttribute('data-sort-value')) return tableSortValue(cell.dataset.sortValue, heading);
  const content = cell.cloneNode(true);
  content.querySelectorAll('small, details, .help-mark').forEach(node => node.remove());
  return tableSortValue(content.textContent, heading);
}

function applyTableSort(table, state) {
  const headers = [...table.tHead.rows[0].cells];
  headers.forEach((header, index) => {
    header.setAttribute('aria-sort', index === state.column ? state.direction : 'none');
  });
  if (table.dataset.sortSource === 'trades') return;
  const body = table.tBodies[0];
  if (!body) return;
  const heading = headers[state.column].dataset.sortLabel;
  const rows = [...body.rows].map((row, index) => ({ row, index, value: cellSortValue(row.cells[state.column], heading) }));
  rows.sort((a, b) => compareTableValues(a.value, b.value, state.direction) || a.index - b.index);
  const fragment = document.createDocumentFragment();
  rows.forEach(({ row }) => fragment.append(row));
  body.append(fragment);
}

function prepareSortableTables() {
  document.querySelectorAll('table').forEach(table => {
    if (preparedTables.has(table) || !table.tHead?.rows.length) return;
    preparedTables.add(table);
    [...table.tHead.rows[0].cells].forEach(header => {
      header.dataset.sortLabel = header.textContent.replace(/ⓘ|ℹ/g, '').trim();
      header.tabIndex = 0;
      header.classList.add('sortable-column');
      header.setAttribute('aria-sort', 'none');
      header.setAttribute('aria-label', `${header.dataset.sortLabel}: ordenar de forma ascendente o descendente`);
      const indicator = document.createElement('span');
      indicator.className = 'sort-indicator';
      indicator.setAttribute('aria-hidden', 'true');
      header.append(indicator);
    });
    const state = tableSortStates.get(tableSortKey(table));
    if (state) applyTableSort(table, state);
  });
}

function initializeTableSorting() {
  const activate = event => {
    if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
    const header = event.target.closest?.('th.sortable-column');
    if (!header) return;
    event.preventDefault();
    const table = header.closest('table');
    const column = header.cellIndex;
    const key = tableSortKey(table);
    const previous = tableSortStates.get(key);
    const state = { column, direction: previous?.column === column && previous.direction === 'ascending' ? 'descending' : 'ascending' };
    tableSortStates.set(key, state);
    if (table.dataset.sortSource === 'trades') setTradeTableSort(state);
    applyTableSort(table, state);
  };
  document.addEventListener('click', activate);
  document.addEventListener('keydown', activate);
  prepareSortableTables();
  prepareCollapsibleTables();
  if (typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(() => {
      prepareSortableTables();
      prepareCollapsibleTables();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
}
