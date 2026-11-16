'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const original = fs.readFileSync(path.join(root, 'data/hotkeys/RRS_Setup_RiskScale_TradeSize_v11.htk'));
const elements = new Map();
const storage = new Map();
let downloads = [];
let downloadNames = [];
let storageBlocked = false;
function element(id) {
  if (!elements.has(id)) {
    const item = { id, value: '', textContent: '', hidden: false, disabled: false, dataset: {}, handlers: {},
      classList: { toggle() {} }, addEventListener(type, handler) { this.handlers[type] = handler; }, reportValidity: () => true, focus() {} };
    Object.defineProperty(item, 'innerHTML', { get() { return this.html || ''; }, set(value) {
      this.html = value;
      for (const match of value.matchAll(/<input id="([^"]+)"[^>]*value="([^"]*)"/g)) element(match[1]).value = match[2];
    } });
    elements.set(id, item);
  }
  return elements.get(id);
}
const context = vm.createContext({
  document: { getElementById: element, body: { appendChild() {} }, createElement() { return { click() { downloadNames.push(this.download); }, remove() {} }; } },
  localStorage: { getItem: key => storage.get(key) ?? null, setItem(key, value) { if (storageBlocked) throw new Error('Storage blocked'); storage.set(key, value); } },
  TextDecoder, Uint8Array, Blob,
  window: { innerWidth: 1400 },
  URL: { createObjectURL(blob) { downloads.push(blob); return 'blob:test'; }, revokeObjectURL() {} },
  setTimeout: callback => callback(),
  fetch: async () => ({ ok: true, arrayBuffer: async () => original.buffer.slice(original.byteOffset, original.byteOffset + original.byteLength) })
});
vm.runInContext(fs.readFileSync(path.join(root, 'hotkeys.js'), 'utf8'), context);
const evaluate = code => vm.runInContext(code, context);
function edit(id, value) {
  element(`hotkeys-${id}`).value = value;
  element('hotkeys-editor').handlers.input({ target: element(`hotkeys-${id}`) });
}
function select(slot) {
  const id = evaluate(`hotkeysEntries.find(entry => entry.slot === ${slot}).id`);
  element('hotkeys-deck').handlers.click({ target: { closest: () => ({ dataset: { hotkeyId: id } }) } });
}

async function run() {
  await evaluate('initializeHotkeys()');
  assert.equal(evaluate('hotkeysEntries.length'), 22);
  assert.equal(evaluate('hotkeysEntries.filter(entry => entry.slot !== null).length'), 15);
  assert.equal(element('hotkeys-extra-count').textContent, '(7)');
  assert.equal((element('hotkeys-deck').innerHTML.match(/data-hotkey-id=/g) || []).length, 15);
  assert.deepEqual(Array.from(evaluate('HOTKEYS_LAYOUT.map(([, label]) => label)')), ['Panic', 'C', 'B', 'Market', 'Clear', 'Config', 'Buy 20%', 'Buy 50%', 'Buy 100%', 'Entry B', 'Test T', 'Sell 20%', 'Sell 50%', 'Sell 100%', 'Entry C']);
  const initial = evaluate('hotkeysSerialize(hotkeysEntries)');
  assert.deepEqual(Buffer.from(evaluate('hotkeysEncode(hotkeysSerialize(hotkeysEntries))')), original, 'Unedited export must match every original byte');
  assert.equal(evaluate('hotkeysSerialize(hotkeysParse(hotkeysSerialize(hotkeysEntries)))'), initial);
  assert.equal(evaluate("hotkeysCanonicalKey('Shift+Ctrl+b')"), evaluate("hotkeysCanonicalKey('ctrl+shift+B')"));
  assert.equal(evaluate("hotkeysCanonicalKey('Alt+[')"), 'ALT+[');
  assert.throws(() => evaluate("hotkeysCanonicalKey('Alt+Alt+1')"));
  assert.throws(() => evaluate("hotkeysParse('Alt+1:Broken:~ 100:abc')"), /longitud/);
  assert.throws(() => evaluate(String.raw`hotkeysParse('Alt+1:A:PANIC;\nalt+1:B:CXL ALLSYMB;')`), /duplicado/);
  assert.throws(() => evaluate("hotkeysParse('Alt+1:A:B\u0000')"));
  assert.equal(Buffer.from(evaluate("hotkeysEncode('Gestión €')")).toString('hex'), '4765737469f36e2080');
  assert.throws(() => evaluate("hotkeysEncode('\u{1f600}')"), /Windows-1252/);

  element('hotkeys-generate').handlers.click();
  assert.deepEqual(Buffer.from(await downloads[0].arrayBuffer()), original);
  assert.equal(downloadNames[0], 'RRS_Setup_RiskScale_TradeSize_custom.htk');
  const keyboardId = evaluate('hotkeysEntries.find(entry => entry.slot === null).id');
  element('hotkeys-extras').handlers.click({ target: { closest: () => ({ dataset: { hotkeyId: keyboardId } }) } });
  assert.equal(element('hotkeys-label-field').hidden, true);
  assert.equal(element('hotkeys-label').disabled, true);
  assert.equal(element('hotkeys-save').textContent, 'Guardar hotkey');
  edit('name', 'Keyboard custom');
  assert.equal(evaluate('hotkeysSaveEditor()'), true);
  assert.ok(element('hotkeys-extras').innerHTML.includes('Keyboard custom'));
  assert.equal(element('hotkeys-editor-title').textContent, 'Keyboard custom');
  element('hotkeys-restore').handlers.click();
  select(0);
  assert.equal(element('hotkeys-label-field').hidden, false);
  assert.equal(element('hotkeys-label').disabled, false);
  select(9);
  assert.equal(element('hotkeys-param-entry-0').value, '0.8');
  assert.equal(element('hotkeys-param-entry-1').value, '1');
  element('hotkeys-param-entry-0').value = '0.6';
  element('hotkeys-parameter-fields').handlers.change({ target: Object.assign(element('hotkeys-param-entry-0'), { dataset: { hotkeyParameter: 'entry-0' } }) });
  assert.ok(element('hotkeys-script').value.includes('/$Distance*0.6;'));
  assert.ok(element('hotkeys-script').value.includes('else{$EntryPrice=Ask;'));
  select(14);
  assert.equal(element('hotkeys-param-entry-0').value, '1');
  assert.equal(element('hotkeys-param-entry-1').value, '0.7');
  select(6);
  assert.equal(element('hotkeys-param-close').value, '20');
  element('hotkeys-param-close').value = '30';
  evaluate('hotkeysDirty = true');
  element('hotkeys-generate').handlers.click();
  const updated = new TextDecoder('windows-1252').decode(await downloads.at(-1).arrayBuffer());
  context.updatedSource = updated;
  assert.equal(evaluate("hotkeysParse(updatedSource).find(entry => entry.slot === 6).script"), 'Route=EDGAL;Price=Bid;Share=Pos*0.3;Buy=Send;TIF=DAY+;');
  assert.equal(evaluate("hotkeysParse(updatedSource).find(entry => entry.slot === 9).script"), evaluate("hotkeysEntries.find(entry => entry.slot === 9).script"), 'Edited advanced lengths must parse correctly');
  assert.equal(evaluate('hotkeysEntries.filter(entry => entry.slot === null).every(entry => entry.script === hotkeysDefaults.find(item => item.id === entry.id).script)'), true);

  const priorDownloads = downloads.length;
  element('hotkeys-param-close').value = '101';
  evaluate('hotkeysDirty = true');
  element('hotkeys-generate').handlers.click();
  assert.equal(downloads.length, priorDownloads, 'Invalid percentages must block download');
  element('hotkeys-param-close').value = '30';
  edit('key', 'Alt+1');
  element('hotkeys-generate').handlers.click();
  assert.equal(downloads.length, priorDownloads, 'Duplicate shortcuts must block download');
  assert.ok(element('hotkeys-editor-status').textContent.includes('duplicado'));
  assert.equal(evaluate('hotkeysEntries.find(entry => entry.slot === 6).key'), 'Alt+6');
  edit('key', 'Ctrl+6');
  edit('name', 'Invalid:Name');
  assert.equal(evaluate('hotkeysSaveEditor()'), false);
  edit('name', 'Close custom');
  edit('label', '<img src=x>');
  assert.equal(evaluate('hotkeysSaveEditor()'), true);
  assert.ok(!element('hotkeys-deck').innerHTML.includes('<img src=x>'));
  assert.ok(element('hotkeys-deck').innerHTML.includes('&lt;img src=x&gt;'));
  assert.equal(JSON.parse(storage.get('track-das-hotkeys-v1')).entries.find(entry => entry.slot === 6).key, 'Ctrl+6');
  await evaluate('initializeHotkeys()');
  select(6);
  assert.equal(element('hotkeys-key').value, 'Ctrl+6', 'Saved changes must survive reload');
  storageBlocked = true;
  edit('label', 'Buy custom');
  assert.equal(evaluate('hotkeysSaveEditor()'), true);
  assert.ok(element('hotkeys-status').textContent.includes('No se pudo guardar'));
  storageBlocked = false;
  element('hotkeys-restore').handlers.click();
  assert.equal(evaluate('hotkeysEntries.find(entry => entry.slot === 6).script'), evaluate('hotkeysDefaults.find(entry => entry.slot === 6).script'));
  assert.equal(evaluate('hotkeysEntries.find(entry => entry.slot === 9).script.includes("/$Distance*0.6;")'), true, 'Restoring one button preserves all other edits');

  select(2);
  element('hotkeys-param-risk').value = '42';
  evaluate('hotkeysDirty = true');
  select(9);
  assert.equal(element('hotkeys-param-risk').value, '42', 'B multiplier changes must update Entry B');
  assert.equal(evaluate('hotkeysRiskValue(hotkeysEntries.find(entry => entry.slot === 1))'), 25, 'B changes must not affect C');
  edit('script', element('hotkeys-script').value.replace('$RiskMultiplier=42;', '$RiskMultiplier=45;'));
  select(2);
  assert.equal(element('hotkeys-param-risk').value, '45', 'Editing Entry B script must update B');
  select(1);
  element('hotkeys-param-risk').value = '17';
  evaluate('hotkeysDirty = true');
  select(14);
  assert.equal(element('hotkeys-param-risk').value, '17', 'C changes must update Entry C');
  element('hotkeys-param-risk').value = '18';
  evaluate('hotkeysDirty = true');
  select(1);
  assert.equal(element('hotkeys-param-risk').value, '18', 'Entry C changes must update C');
  assert.equal(evaluate('hotkeysRiskValue(hotkeysEntries.find(entry => entry.slot === 2))'), 45);
  element('hotkeys-restore').handlers.click();
  assert.equal(evaluate('hotkeysRiskValue(hotkeysEntries.find(entry => entry.slot === 14))'), 25, 'Restoring C must synchronize its paired multiplier');
  select(2);
  element('hotkeys-restore').handlers.click();
  assert.equal(evaluate('hotkeysRiskValue(hotkeysEntries.find(entry => entry.slot === 9))'), 35);
  assert.equal(evaluate('hotkeysEntries.find(entry => entry.slot === 9).script.includes("/$Distance*0.6;")'), true, 'Risk synchronization must preserve entry factors');
  const saved = JSON.parse(storage.get('track-das-hotkeys-v1'));
  saved.entries.find(entry => entry.slot === 9).script = saved.entries.find(entry => entry.slot === 9).script.replace('$RiskMultiplier=35;', '$RiskMultiplier=99;');
  storage.set('track-das-hotkeys-v1', JSON.stringify(saved));
  await evaluate('initializeHotkeys()');
  assert.equal(evaluate('hotkeysRiskValue(hotkeysEntries.find(entry => entry.slot === 9))'), 35, 'Existing saved mismatches must adopt the corresponding sizing multiplier');
  assert.equal(JSON.parse(storage.get('track-das-hotkeys-v1')).entries.find(entry => entry.slot === 9).script.includes('$RiskMultiplier=35;'), true);
  context.mismatchedEntries = saved.entries;
  assert.throws(() => evaluate('hotkeysSerialize(mismatchedEntries)'), /compartir/);
  storage.set('track-das-hotkeys-v1', '{broken');
  await evaluate('initializeHotkeys()');
  assert.ok(element('hotkeys-status').textContent.includes('no es válida'));
  assert.equal(evaluate('hotkeysSerialize(hotkeysEntries)'), initial);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/update-dashboard.yml'), 'utf8');
  assert.ok(html.includes('href="#hotkeys" data-view="hotkeys"'));
  assert.ok(html.includes('id="view-hotkeys"'));
  assert.ok(html.includes('id="hotkeys-keyboard-title">Keyboard'));
  assert.ok(!html.includes('<details class="hotkeys-extras"'));
  assert.ok(html.indexOf('src="hotkeys.js') < html.indexOf('src="workspace.js'));
  assert.ok(workflow.includes('cp hotkeys.js hotkeys.css site/'));
  assert.ok(workflow.includes('cp data/hotkeys/*.htk site/data/hotkeys/'));
  assert.ok(fs.readFileSync(path.join(root, '.gitattributes'), 'utf8').includes('data/hotkeys/*.htk -text'), 'Git must preserve the DAS source bytes on every platform');
  console.log('Hotkey byte-exact round trip, layout, parameter edits, encoding, validation, persistence, escaping and download checks passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
