'use strict';

const HOTKEYS_SOURCE = 'data/hotkeys/RRS_Setup_RiskScale_TradeSize_v11.htk';
const HOTKEYS_STORAGE = 'track-das-hotkeys-v1';
const HOTKEYS_RISK_PAIRS = [[2, 9], [1, 14]];
const HOTKEYS_LAYOUT = [
  ['Alt+1', 'Panic', 'danger'], ['Alt+2', 'C', 'neutral'], ['Alt+3', 'B', 'neutral'], ['Alt+4', 'Market', 'neutral'], ['Alt+Q', 'Clear', 'neutral'],
  ['Alt+5', 'Config', 'neutral'], ['Alt+6', 'Buy 20%', 'buy'], ['Alt+7', 'Buy 50%', 'buy'], ['Alt+8', 'Buy 100%', 'buy'], ['Alt+E', 'Entry B', 'buy'],
  ['Alt+9', 'Test T', 'neutral'], ['Alt+0', 'Sell 20%', 'sell'], ['Alt+[', 'Sell 50%', 'sell'], ['Alt+]', 'Sell 100%', 'sell'], ['Alt+R', 'Entry C', 'buy']
];
let hotkeysDefaults = [];
let hotkeysEntries = [];
let hotkeysSelectedId = '';
let hotkeysDirty = false;

function hotkeysEscape(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function hotkeysCanonicalKey(key) {
  const parts = key.trim().toUpperCase().split('+');
  const main = parts.pop();
  if (!main || !/^(?:[A-Z0-9\[\];',.\/=\-`\\]|F(?:[1-9]|1\d|2[0-4])|SPACE|TAB|ENTER|ESC|ESCAPE|HOME|END|PGUP|PGDN|PAGEUP|PAGEDOWN|INSERT|DELETE|UP|DOWN|LEFT|RIGHT|BACKSPACE|NUM[0-9])$/.test(main)
    || parts.some(part => !['CTRL', 'ALT', 'SHIFT'].includes(part)) || new Set(parts).size !== parts.length) {
    throw new Error('Atajo no válido. Usa, por ejemplo, Alt+1, Ctrl+Shift+B o F5.');
  }
  const aliases = { ESCAPE: 'ESC', PAGEUP: 'PGUP', PAGEDOWN: 'PGDN' };
  return [...parts.sort(), aliases[main] || main].join('+');
}

function hotkeysEncode(text) {
  const specials = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';
  return Uint8Array.from(Array.from(text, character => {
    const code = character.charCodeAt(0);
    if (code <= 127 || (code >= 160 && code <= 255)) return code;
    const index = specials.indexOf(character);
    if (index >= 0) return 128 + index;
    throw new Error('El archivo DAS admite caracteres Windows-1252. Quita los caracteres no compatibles del nombre o script.');
  }));
}

function hotkeysParse(source) {
  if (source.length > 1000000) throw new Error('El archivo de hotkeys es demasiado grande.');
  const lines = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
  const entries = [];
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].trim()) continue;
    const header = /^([^:\r\n]+):([^:\r\n]+):(.*)$/.exec(lines[index]);
    if (!header) throw new Error(`Formato .htk no válido en la línea ${index + 1}.`);
    const [, key, name, body] = header;
    const lengthHeader = /^~ (\d+):/.exec(body);
    let script = lengthHeader ? body.slice(lengthHeader[0].length) : body;
    if (lengthHeader) {
      const length = Number(lengthHeader[1]);
      if (length > 100000) throw new Error('Longitud de script no válida.');
      while (script.length < length && index + 1 < lines.length) script += lines[++index];
      if (script.length !== length) throw new Error(`La longitud del script ${name} no coincide con su cabecera.`);
    }
    const slot = HOTKEYS_LAYOUT.findIndex(([shortcut]) => shortcut.toUpperCase() === key.toUpperCase());
    entries.push({ id: `hotkey-${entries.length}`, key, name, script, advanced: Boolean(lengthHeader), slot: slot < 0 ? null : slot,
      label: slot < 0 ? name : HOTKEYS_LAYOUT[slot][1] });
  }
  hotkeysValidate(entries);
  return entries;
}

function hotkeysValidate(entries) {
  if (!Array.isArray(entries) || !entries.length) throw new Error('No hay hotkeys para generar.');
  const shortcuts = new Set();
  const ids = new Set();
  const slots = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry.id !== 'string' || ids.has(entry.id) || typeof entry.key !== 'string'
      || typeof entry.name !== 'string' || !entry.name.trim() || /[:\r\n\x00-\x1f]/.test(entry.name)
      || typeof entry.label !== 'string' || !entry.label.trim() || (entry.slot !== null && entry.label.length > 60)
      || typeof entry.script !== 'string' || !entry.script.trim() || /[\x00-\x08\x0b-\x1f]/.test(entry.script)
      || typeof entry.advanced !== 'boolean') throw new Error('Revisa el nombre, texto y script de cada botón. El nombre DAS no puede contener dos puntos ni saltos de línea.');
    ids.add(entry.id);
    const shortcut = hotkeysCanonicalKey(entry.key);
    if (shortcuts.has(shortcut)) throw new Error(`Atajo duplicado: ${entry.key}. Cada hotkey necesita un atajo distinto.`);
    shortcuts.add(shortcut);
    if (entry.slot !== null) {
      if (!Number.isInteger(entry.slot) || entry.slot < 0 || entry.slot >= 15 || slots.has(entry.slot)) throw new Error('La distribución de botones no es válida.');
      slots.add(entry.slot);
    }
    hotkeysEncode(entry.key + entry.name + entry.script.replace(/\r?\n/g, ''));
  }
}

function hotkeysSerialize(entries) {
  hotkeysValidate(entries);
  for (const pair of HOTKEYS_RISK_PAIRS) {
    const values = pair.map(slot => hotkeysRiskValue(entries.find(entry => entry.slot === slot)));
    if (values.some(value => value === null) || values[0] !== values[1]) throw new Error('B y Entry B deben compartir un multiplicador; C y Entry C deben compartir el suyo. Revisa $RiskMultiplier en esos botones.');
  }
  return entries.map(entry => {
    const script = entry.script.replace(/\r?\n/g, '');
    const advanced = entry.advanced || script.length > 100 || /[{}]/.test(script);
    const body = advanced ? `~ ${hotkeysEncode(script).length}:${script.match(/.{1,51}/g).join('\r\n')}` : script;
    return `${entry.key}:${entry.name}:${body}\r\n`;
  }).join('');
}

function hotkeysParameterDefinitions(script) {
  const definitions = [
    { id: 'risk', label: 'Multiplicador de riesgo', pattern: /\$RiskMultiplier=([0-9.]+);/g, prefix: '$RiskMultiplier=', suffix: ';', min: 0.000001 },
    { id: 'route', label: 'Ruta', pattern: /\bRoute=([A-Za-z0-9_]+);/gi, prefix: 'Route=', suffix: ';' },
    { id: 'tif', label: 'Vigencia (TIF)', pattern: /\bTIF=([A-Za-z0-9+]+);/gi, prefix: 'TIF=', suffix: ';' },
    { id: 'close', label: 'Posición a cerrar (%)', pattern: /\bShare=Pos\*([0-9.]+);/gi, prefix: 'Share=Pos*', suffix: ';', scale: 100, min: 0.000001, max: 100 },
    { id: 'slippage', label: 'Margen sobre Last (%)', pattern: /\$Delta=Last\*([0-9.]+);/g, prefix: '$Delta=Last*', suffix: ';', scale: 100, min: 0, max: 100 },
    { id: 'shares', label: 'Acciones de prueba', pattern: /\bShare=([0-9.]+);/gi, prefix: 'Share=', suffix: ';', min: 1 }
  ];
  const parameters = definitions.flatMap(definition => {
    const matches = [...script.matchAll(definition.pattern)];
    if (!matches.length || !matches.every(match => match[1] === matches[0][1])) return [];
    return [{ ...definition, value: definition.min === undefined ? matches[0][1] : Number(matches[0][1]) * (definition.scale || 1) }];
  });
  const entries = [...script.matchAll(/Share=\$RiskScale\*\$RiskMultiplier\/\$Distance(?:\*([0-9.]+))?;/g)];
  if (entries.length === 2) {
    for (let index = 0; index < 2; index++) parameters.push({ id: `entry-${index}`, label: `Factor de entrada ${index === 0 ? 'long' : 'short'}`, value: Number(entries[index][1] || 1), min: 0.000001 });
  }
  return parameters;
}

function hotkeysApplyParameter(script, id, rawValue) {
  const parameter = hotkeysParameterDefinitions(script).find(item => item.id === id);
  if (!parameter) throw new Error('El parámetro ya no está presente en el script.');
  const value = parameter.min === undefined ? rawValue.trim() : Number(rawValue);
  if (parameter.min === undefined ? !/^[A-Za-z0-9_+]+$/.test(value) : rawValue.trim() === '' || !Number.isFinite(value) || value < parameter.min || (parameter.max !== undefined && value > parameter.max)) {
    throw new Error(`Valor no válido para ${parameter.label}.`);
  }
  if (id.startsWith('entry-')) {
    let index = 0;
    return script.replace(/Share=\$RiskScale\*\$RiskMultiplier\/\$Distance(?:\*[0-9.]+)?;/g, match => index++ === Number(id.slice(-1))
      ? `Share=$RiskScale*$RiskMultiplier/$Distance${value === 1 ? '' : `*${value}`};` : match);
  }
  return script.replace(parameter.pattern, () => `${parameter.prefix}${parameter.min === undefined ? value : value / (parameter.scale || 1)}${parameter.suffix}`);
}

function hotkeysRiskValue(entry) {
  const parameter = entry && hotkeysParameterDefinitions(entry.script).find(item => item.id === 'risk');
  return parameter && Number.isFinite(parameter.value) && parameter.value > 0 ? parameter.value : null;
}

function hotkeysSynchronizeRisk(entries, selectedId) {
  const selected = entries.find(entry => entry.id === selectedId);
  const pair = selected && HOTKEYS_RISK_PAIRS.find(slots => slots.includes(selected.slot));
  if (!pair) return entries;
  const partner = entries.find(entry => entry.slot === pair.find(slot => slot !== selected.slot));
  const value = hotkeysRiskValue(selected);
  if (value === null || hotkeysRiskValue(partner) === null) throw new Error('Conserva una asignación válida $RiskMultiplier en ambos botones de B o C para compartir el multiplicador.');
  return entries.map(entry => entry.id === partner.id && hotkeysRiskValue(entry) !== value
    ? { ...entry, script: hotkeysApplyParameter(entry.script, 'risk', String(value)) } : entry);
}

function hotkeysMessage(id, message, error = false) {
  const element = document.getElementById(id);
  element.textContent = message;
  element.classList.toggle('hotkeys-error', error);
}

function hotkeysPersist(entries) {
  try {
    localStorage.setItem(HOTKEYS_STORAGE, JSON.stringify({ schemaVersion: 1, entries }));
    return true;
  } catch { return false; }
}

function hotkeysRenderDeck() {
  document.getElementById('hotkeys-deck').innerHTML = HOTKEYS_LAYOUT.map(([, label, tone], slot) => {
    const entry = hotkeysEntries.find(item => item.slot === slot);
    return entry ? `<button type="button" class="hotkeys-key" data-tone="${tone}" data-hotkey-id="${entry.id}" aria-pressed="${entry.id === hotkeysSelectedId}" aria-label="Configurar ${hotkeysEscape(entry.label)}, fila ${Math.floor(slot / 5) + 1}, columna ${slot % 5 + 1}"><strong>${hotkeysEscape(entry.label)}</strong><small>${hotkeysEscape(entry.key)}</small></button>`
      : `<button class="hotkeys-key" type="button" disabled>${hotkeysEscape(label)}</button>`;
  }).join('');
  const extras = hotkeysEntries.filter(entry => entry.slot === null);
  document.getElementById('hotkeys-extra-count').textContent = `(${extras.length})`;
  document.getElementById('hotkeys-extras').innerHTML = extras.map(entry => `<button type="button" class="hotkeys-extra" data-hotkey-id="${entry.id}" aria-pressed="${entry.id === hotkeysSelectedId}"><span>${hotkeysEscape(entry.name)}</span><span class="hotkeys-chord">${hotkeysEscape(entry.key)}</span></button>`).join('');
}

function hotkeysRenderParameters() {
  const parameters = hotkeysParameterDefinitions(document.getElementById('hotkeys-script').value);
  const slot = hotkeysEntries.find(entry => entry.id === hotkeysSelectedId)?.slot;
  const group = [2, 9].includes(slot) ? 'B' : [1, 14].includes(slot) ? 'C' : '';
  if (group) {
    const risk = parameters.find(parameter => parameter.id === 'risk');
    if (risk) risk.label = `Multiplicador compartido · ${group} / Entry ${group}`;
  }
  document.getElementById('hotkeys-parameters').hidden = !parameters.length;
  document.getElementById('hotkeys-parameter-fields').innerHTML = parameters.map(parameter => `<label for="hotkeys-param-${parameter.id}">${parameter.label}<input id="hotkeys-param-${parameter.id}" data-hotkey-parameter="${parameter.id}" value="${hotkeysEscape(parameter.value)}" ${parameter.min === undefined ? 'type="text"' : `type="number" step="any" min="${parameter.min}" ${parameter.max === undefined ? '' : `max="${parameter.max}"`}`} required></label>`).join('');
}

function hotkeysOpenEditor(id) {
  const entry = hotkeysEntries.find(item => item.id === id);
  if (!entry) return;
  hotkeysSelectedId = id;
  hotkeysDirty = false;
  document.getElementById('hotkeys-editor-panel').hidden = false;
  document.getElementById('hotkeys-position').textContent = entry.slot === null ? 'KEYBOARD' : `FILA ${Math.floor(entry.slot / 5) + 1} · COLUMNA ${entry.slot % 5 + 1}`;
  document.getElementById('hotkeys-editor-title').textContent = entry.slot === null ? entry.name : entry.label;
  document.getElementById('hotkeys-label-field').hidden = entry.slot === null;
  document.getElementById('hotkeys-label').disabled = entry.slot === null;
  document.getElementById('hotkeys-save').textContent = entry.slot === null ? 'Guardar hotkey' : 'Guardar botón';
  document.getElementById('hotkeys-restore').textContent = entry.slot === null ? 'Restaurar hotkey original' : 'Restaurar botón original';
  document.getElementById('hotkeys-editor-chord').textContent = entry.key;
  for (const field of ['label', 'key', 'name', 'script']) document.getElementById(`hotkeys-${field}`).value = entry[field];
  hotkeysMessage('hotkeys-editor-status', '');
  hotkeysRenderParameters();
  hotkeysRenderDeck();
}

function hotkeysSaveEditor() {
  if (!hotkeysSelectedId || !hotkeysDirty) return true;
  try {
    if (!document.getElementById('hotkeys-editor').reportValidity()) return false;
    const textarea = document.getElementById('hotkeys-script');
    for (const parameter of hotkeysParameterDefinitions(textarea.value)) {
      const raw = document.getElementById(`hotkeys-param-${parameter.id}`).value;
      const updated = hotkeysApplyParameter(textarea.value, parameter.id, raw);
      if (parameter.min === undefined ? raw.trim() !== parameter.value : Number(raw) !== parameter.value) textarea.value = updated;
    }
    const entries = hotkeysSynchronizeRisk(hotkeysEntries.map(entry => {
      if (entry.id !== hotkeysSelectedId) return entry;
      const updated = { ...entry, ...Object.fromEntries(['label', 'key', 'name', 'script'].map(field => [field, document.getElementById(`hotkeys-${field}`).value.trim()])) };
      if (entry.slot === null) updated.label = updated.name;
      return updated;
    }), hotkeysSelectedId);
    hotkeysValidate(entries);
    const persisted = hotkeysPersist(entries);
    hotkeysEntries = entries;
    hotkeysOpenEditor(hotkeysSelectedId);
    hotkeysMessage('hotkeys-status', persisted ? 'Configuración guardada en este navegador.' : 'No se pudo guardar en este navegador. Puedes generar el archivo con los cambios de esta sesión.', !persisted);
    hotkeysMessage('hotkeys-editor-status', 'Botón actualizado.');
    return true;
  } catch (error) {
    hotkeysMessage('hotkeys-editor-status', error.message, true);
    return false;
  }
}

async function initializeHotkeys() {
  try {
    const response = await fetch(HOTKEYS_SOURCE, { cache: 'no-store' });
    if (!response.ok) throw new Error('No se pudo cargar el archivo original de hotkeys.');
    const source = new TextDecoder('windows-1252').decode(await response.arrayBuffer());
    hotkeysDefaults = hotkeysParse(source);
    hotkeysEntries = hotkeysDefaults.map(entry => ({ ...entry }));
    let storageWarning = '';
    try {
      const raw = localStorage.getItem(HOTKEYS_STORAGE);
      if (raw !== null) {
        const saved = JSON.parse(raw);
        hotkeysValidate(saved.entries);
        if (saved.schemaVersion !== 1 || saved.entries.length !== hotkeysDefaults.length || !saved.entries.every((entry, index) => entry.id === hotkeysDefaults[index].id && entry.slot === hotkeysDefaults[index].slot)) throw new Error('Invalid saved layout');
        hotkeysEntries = saved.entries;
      }
    } catch { storageWarning = ' La configuración guardada no está disponible o no es válida; se muestra el archivo original.'; }
    let synchronized = false;
    for (const [slot, partnerSlot] of HOTKEYS_RISK_PAIRS) {
      const selected = hotkeysEntries.find(entry => entry.slot === slot);
      const partner = hotkeysEntries.find(entry => entry.slot === partnerSlot);
      if (hotkeysRiskValue(selected) !== null && hotkeysRiskValue(partner) !== null && hotkeysRiskValue(selected) !== hotkeysRiskValue(partner)) {
        hotkeysEntries = hotkeysSynchronizeRisk(hotkeysEntries, selected.id);
        synchronized = true;
      }
    }
    if (synchronized) storageWarning += hotkeysPersist(hotkeysEntries) ? ' Multiplicadores de Entry B y Entry C unificados con B y C.' : ' Multiplicadores unificados en esta sesión; no se pudo guardar en el navegador.';
    document.getElementById('hotkeys-generate').disabled = false;
    hotkeysMessage('hotkeys-status', `${hotkeysEntries.length} hotkeys cargadas · Archivo base v11.${storageWarning}`, Boolean(storageWarning));
    hotkeysOpenEditor(hotkeysEntries.find(entry => entry.slot === 0).id);
    for (const id of ['hotkeys-deck', 'hotkeys-extras']) document.getElementById(id).addEventListener('click', event => {
      const button = event.target.closest('[data-hotkey-id]');
      if (button && hotkeysSaveEditor()) {
        hotkeysOpenEditor(button.dataset.hotkeyId);
        document.getElementById(hotkeysEntries.find(entry => entry.id === hotkeysSelectedId).slot === null ? 'hotkeys-name' : 'hotkeys-label').focus({ preventScroll: true });
        if (window.innerWidth <= 1150) document.getElementById('hotkeys-editor-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    document.getElementById('hotkeys-editor').addEventListener('input', event => {
      hotkeysDirty = true;
      hotkeysMessage('hotkeys-editor-status', 'Cambios pendientes. Se guardan al cambiar de botón o generar el archivo.');
      if (event.target.id === 'hotkeys-script') hotkeysRenderParameters();
    });
    document.getElementById('hotkeys-parameter-fields').addEventListener('change', event => {
      const id = event.target.dataset.hotkeyParameter;
      if (!id) return;
      try {
        const textarea = document.getElementById('hotkeys-script');
        textarea.value = hotkeysApplyParameter(textarea.value, id, event.target.value);
        hotkeysDirty = true;
        hotkeysMessage('hotkeys-editor-status', 'Parámetro aplicado al script. Guarda el botón para conservarlo.');
      } catch (error) { hotkeysMessage('hotkeys-editor-status', error.message, true); }
    });
    document.getElementById('hotkeys-editor').addEventListener('submit', event => { event.preventDefault(); hotkeysSaveEditor(); });
    document.getElementById('hotkeys-restore').addEventListener('click', () => {
      hotkeysEntries = hotkeysSynchronizeRisk(hotkeysEntries.map(entry => entry.id === hotkeysSelectedId ? { ...hotkeysDefaults.find(original => original.id === entry.id) } : entry), hotkeysSelectedId);
      const persisted = hotkeysPersist(hotkeysEntries);
      hotkeysOpenEditor(hotkeysSelectedId);
      hotkeysMessage('hotkeys-status', persisted ? 'Botón restaurado al archivo original y guardado.' : 'Botón restaurado en esta sesión; no se pudo guardar en el navegador.', !persisted);
    });
    document.getElementById('hotkeys-generate').addEventListener('click', () => {
      if (!hotkeysSaveEditor()) return;
      try {
        const bytes = hotkeysEncode(hotkeysSerialize(hotkeysEntries));
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'RRS_Setup_RiskScale_TradeSize_custom.htk';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        hotkeysMessage('hotkeys-status', `Archivo .htk generado con ${hotkeysEntries.length} hotkeys. Los atajos del Stream Deck deben coincidir con los de DAS.`);
      } catch (error) { hotkeysMessage('hotkeys-status', error.message, true); }
    });
  } catch (error) { hotkeysMessage('hotkeys-status', error.message, true); }
}
