'use strict';

function dateFieldToIso(value) {
  if (!value) return '';
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  const iso = match ? `${match[3]}-${match[2]}-${match[1]}` : /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  if (!iso) return null;
  const date = new Date(`${iso}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

function dateFieldFromIso(value) { return value ? value.split('-').reverse().join('/') : ''; }

function attachDatePicker(input) {
  if (typeof document.createElement !== 'function' || input.dataset.datePickerReady) return;
  input.dataset.datePickerReady = 'true';
  const wrapper = document.createElement('span');
  wrapper.className = 'date-field-control';
  input.parentNode.insertBefore(wrapper, input);
  wrapper.appendChild(input);
  const picker = document.createElement('input');
  picker.type = 'date';
  picker.className = 'date-field-native';
  picker.tabIndex = -1;
  picker.setAttribute('aria-hidden', 'true');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'date-field-picker';
  button.setAttribute('aria-label', 'Elegir fecha en el calendario');
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18"/></svg>';
  wrapper.append(picker, button);
  button.addEventListener('click', () => {
    picker.value = dateFieldToIso(input.value) || '';
    if (typeof picker.showPicker === 'function') picker.showPicker(); else picker.click();
  });
  picker.addEventListener('change', () => {
    input.value = dateFieldFromIso(picker.value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
