'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const index = JSON.parse(read('data/research/sessions.json'));
const session = JSON.parse(read(`data/research/${index.sessions[0].file}`));

function harness(manifest = index) {
  const elements = new Map();
  const requests = [];
  const calls = [];
  let failNext = false;
  function element() {
    return { children: [], handlers: {}, dataset: {}, style: {}, disabled: false,
      clientWidth: 900, scrollLeft: 0,
      append(child) { this.children.push(child); },
      replaceChildren() { this.children = []; },
      setAttribute(key, value) { this[key] = value; },
      addEventListener(key, callback) { this.handlers[key] = callback; },
      getBoundingClientRect() { return { width: 900, height: 490, left: 0, top: 0 }; },
      setPointerCapture(id) { this.pointerId = id; },
      hasPointerCapture(id) { return this.pointerId === id; },
      releasePointerCapture() { this.pointerId = null; }
    };
  }
  const document = {
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    createElement: element,
    querySelectorAll() { return document.getElementById('research-calendar').children.filter(item => item.dataset.researchDate); },
    addEventListener() {}
  };
  const drawing = new Proxy({}, { get: (object, key) => object[key] || ((...args) => calls.push([key, ...args])), set: (object, key, value) => { object[key] = value; return true; } });
  Object.defineProperty(document.getElementById('research-position'), 'scrollWidth', {
    get: () => 900 * parseFloat(document.getElementById('research-scroll-track').style.width || '100') / 100
  });
  document.getElementById('research-canvas').getContext = () => drawing;
  const context = vm.createContext({ document, Intl, Date, window: { devicePixelRatio: 1 },
    ResizeObserver: class { observe() {} }, requestAnimationFrame: () => 1,
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url === 'data/research/sessions.json') return { ok: true, json: async () => manifest };
      assert.match(url, /^data\/research\/nvda-\d{4}-\d{2}-\d{2}-1m\.json\?v=/);
      if (failNext) { failNext = false; return { ok: false, status: 503 }; }
      const date = /nvda-(\d{4}-\d{2}-\d{2})/.exec(url)[1];
      return { ok: true, json: async () => date === session.date ? session : {
        ...session, date, bars: [{ ...session.bars[0], time: Date.parse(`${date}T14:30:00Z`) / 1000 }]
      } };
    }
  });
  vm.runInContext(read('research.js'), context);
  return { run: code => vm.runInContext(code, context), requests, elements, calls, fail() { failNext = true; } };
}

async function main() {
  const html = read('research.html');
  assert.deepEqual([...html.matchAll(/<script[^>]+src="([^"?]+)/g)].map(match => match[1]), ['research.js']);
  assert.deepEqual([...html.matchAll(/<link[^>]+href="([^"?]+)/g)].map(match => match[1]), ['research.css']);
  assert.match(read('index.html'), /href="research.html"/);
  assert.doesNotMatch(read('index.html'), /src="research.js|id="view-nvidia"/);
  assert.doesNotMatch(read('workspace.js'), /initializeResearch/);

  const test = harness();
  await test.run('initializeResearch()');
  assert.deepEqual(test.requests.map(request => request.url), ['data/research/sessions.json']);
  const buttons = test.elements.get('research-calendar').children.filter(item => item.dataset.researchDate);
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].dataset.researchDate, '2026-10-01');
  await buttons[0].handlers.click();
  assert.equal(test.requests.length, 2);
  assert.equal(test.requests[1].options.cache, 'default');
  assert.match(test.elements.get('research-status').textContent, /04:00.*19:59 NY.*901 velas/);
  assert.equal(buttons[0]['aria-pressed'], 'true');
  await test.run("loadResearchSession('2026-10-01')");
  assert.equal(test.requests.length, 2, 'A repeated selection must reuse loaded bars');
  await test.run("loadResearchSession('2026-10-02')");
  assert.equal(test.requests.length, 2, 'An unavailable day must not request a file');
  test.elements.get('research-zoom-in').handlers.click();
  assert.equal(test.elements.get('research-position')['aria-disabled'], 'false');
  test.elements.get('research-reset').handlers.click();
  assert.equal(test.elements.get('research-position')['aria-disabled'], 'true');
  const initialWindow = test.run('researchWindow');
  const initialStart = test.run('researchStart');
  const initialRequests = test.requests.length;
  await buttons[0].handlers.click();
  assert.equal(buttons[0]['aria-pressed'], 'false');
  assert.equal(test.run('researchData'), null);
  assert.equal(test.elements.get('research-zoom-in').disabled, true);
  assert.equal(test.elements.get('research-position').scrollLeft, 0);
  await buttons[0].handlers.click();
  assert.equal(test.requests.length, 2, 'Reselecting a deselected day must use its cached data');

  const canvas = test.elements.get('research-canvas');
  let prevented = false;
  const wheel = { deltaY: -120, deltaMode: 0, clientX: 450, preventDefault() { prevented = true; } };
  canvas.handlers.wheel(wheel);
  assert.equal(prevented, true);
  assert.ok(test.run('researchWindow < researchSpan'));
  assert.ok(parseFloat(test.elements.get('research-scroll-track').style.width) > 100);
  for (let i = 0; i < 30; i++) canvas.handlers.wheel(wheel);
  assert.equal(test.run('researchWindow'), 30);
  assert.ok(test.run('researchStart >= 0 && researchStart + researchWindow <= researchSpan'));
  for (let i = 0; i < 30; i++) canvas.handlers.wheel({ ...wheel, deltaY: 120 });
  assert.equal(test.run('researchWindow'), initialWindow);
  assert.equal(test.run('researchStart'), initialStart);
  canvas.handlers.wheel(wheel);
  const beforeOut = test.run('researchWindow');
  canvas.handlers.wheel({ ...wheel, deltaY: 120 });
  assert.ok(test.run('researchWindow') > beforeOut);
  canvas.handlers.wheel(wheel);
  const scroll = test.elements.get('research-position');
  scroll.scrollLeft = scroll.scrollWidth - scroll.clientWidth;
  scroll.handlers.scroll();
  assert.equal(test.run('researchStart'), test.run('researchSpan - researchWindow'));
  test.run('drawResearchChart()');
  scroll.scrollLeft = 0; scroll.handlers.scroll(); test.run('drawResearchChart()');
  assert.equal(test.run('researchStart'), 0);

  canvas.handlers.pointermove({ clientX: 450, clientY: 140 });
  test.calls.length = 0;
  test.run('drawResearchChart()');
  assert.ok(test.calls.some(call => call[0] === 'moveTo' && call[1] === 12 && call[2] === 140), 'Crosshair must include a horizontal line');
  const expectedPrice = test.run('(researchGeometry.high - (140 - researchGeometry.top) / (researchGeometry.bottom - researchGeometry.top) * (researchGeometry.high - researchGeometry.low)).toFixed(2)');
  assert.ok(test.calls.some(call => call[0] === 'fillText' && call[1] === expectedPrice && call[2] === 842), 'Crosshair must show its price on the axis');

  canvas.handlers.pointerdown({ button: 0, pointerId: 7, clientX: 850, clientY: 140, preventDefault() {} });
  assert.equal(canvas.pointerId, 7);
  const originalRange = test.run('researchGeometry.high - researchGeometry.low');
  canvas.handlers.pointermove({ pointerId: 7, clientX: 850, clientY: 180 });
  assert.ok(test.run('researchPriceRange.high - researchPriceRange.low') > originalRange);
  canvas.handlers.pointerup({ pointerId: 7 });
  assert.equal(test.run('researchAxisDrag'), null);
  assert.equal(canvas.pointerId, null);
  test.run('drawResearchChart()');
  canvas.handlers.dblclick({ clientX: 850, clientY: 140 });
  assert.equal(test.run('researchPriceRange'), null);
  canvas.handlers.pointerdown({ button: 0, pointerId: 8, clientX: 450, clientY: 140, preventDefault() {} });
  assert.equal(test.run('researchAxisDrag'), null, 'Dragging the plot must not scale the price axis');
  canvas.handlers.pointerdown({ button: 0, pointerId: 9, clientX: 850, clientY: 180, preventDefault() {} });
  const rangeBeforeUp = test.run('researchGeometry.high - researchGeometry.low');
  canvas.handlers.pointermove({ pointerId: 9, clientX: 850, clientY: 140 });
  assert.ok(test.run('researchPriceRange.high - researchPriceRange.low') < rangeBeforeUp);
  canvas.handlers.pointercancel({ pointerId: 9 });
  assert.equal(test.run('researchAxisDrag'), null);
  assert.equal(canvas.pointerId, null);
  test.elements.get('research-reset').handlers.click();
  assert.equal(test.run('researchPriceRange'), null);
  assert.equal(test.run('researchWindow'), initialWindow);
  assert.equal(test.requests.length, initialRequests);

  test.elements.get('research-month-prev').handlers.click();
  assert.equal(test.run('researchMonth'), '2026-09');
  assert.equal(test.elements.get('research-calendar').children.filter(item => item.dataset.researchDate).length, 0);
  test.elements.get('research-month-next').handlers.click();
  assert.equal(test.run('researchMonth'), '2026-10');
  assert.equal(test.elements.get('research-calendar').children.filter(item => item.dataset.researchDate).length, 1);
  test.run("renderResearchCalendar('2026-12')");
  test.elements.get('research-month-next').handlers.click();
  assert.equal(test.run('researchMonth'), '2027-01');
  assert.equal(test.requests.length, 2, 'Navigating months must not load session files');

  const retry = harness();
  await retry.run('initializeResearch()');
  retry.fail();
  await retry.run("loadResearchSession('2026-10-01')");
  assert.match(retry.elements.get('research-status').textContent, /No se pudo cargar/);
  await retry.run("loadResearchSession('2026-10-01')");
  assert.match(retry.elements.get('research-status').textContent, /901 velas/);
  assert.equal(retry.requests.length, 3);

  const multiple = harness({ ...index, sessions: [...index.sessions,
    { date: '2026-11-17', file: 'nvda-2026-11-17-1m.json', version: 'test' }] });
  await multiple.run('initializeResearch()');
  assert.equal(multiple.run('researchMonth'), '2026-11');
  assert.equal(multiple.requests.length, 1);
  await multiple.run("loadResearchSession('2026-11-17')");
  assert.match(multiple.elements.get('research-status').textContent, /09:30.*NY/);
  assert.match(multiple.elements.get('research-chart-title').textContent, /17\/11\/2026/);
  multiple.run("renderResearchCalendar('2026-10')");
  await multiple.run("loadResearchSession('2026-10-01')");
  assert.equal(multiple.requests.length, 3);
  await multiple.run("loadResearchSession('2026-11-17')");
  assert.equal(multiple.requests.length, 3);
  console.log('Research isolation, daily loading, cache, wheel zoom, scrollbar, crosshair, price scaling, date toggle, month navigation and NY timezone: OK');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
