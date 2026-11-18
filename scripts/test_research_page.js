'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const index = JSON.parse(read('data/research/sessions.json'));
const session = JSON.parse(read(`data/research/${index.sessions[0].file}`));
const secondSession = JSON.parse(read(`data/research/${index.sessions[0].secondsFile}`));

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
      releasePointerCapture() { this.pointerId = null; },
      getContext() { return drawing; }
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
      assert.match(url, /^data\/research\/nvda-\d{4}-\d{2}-\d{2}-1[ms]\.json\?v=/);
      if (failNext && (failNext === true || url.includes(failNext))) { failNext = false; return { ok: false, status: 503 }; }
      const date = /nvda-(\d{4}-\d{2}-\d{2})/.exec(url)[1];
      const fixtureFile = `data/research/${url.split('/').at(-1).split('?')[0]}`;
      if (fs.existsSync(path.join(root, fixtureFile))) return { ok: true, json: async () => JSON.parse(read(fixtureFile)) };
      const fixture = url.includes('-1s.json') ? secondSession : session;
      return { ok: true, json: async () => date === session.date ? fixture : {
        ...fixture, date, bars: [{ ...fixture.bars[0], time: Date.parse(`${date}T14:30:00Z`) / 1000 }]
      } };
    }
  });
  vm.runInContext(read('research.js'), context);
  return { run: code => vm.runInContext(code, context), requests, elements, calls, fail(match = true) { failNext = match; } };
}

function assertSynchronized(test, source = secondSession) {
  test.run('drawResearchChart()');
  const range = test.run('researchVisibleRange()');
  const actual = JSON.parse(test.run('JSON.stringify(researchCharts.second.visibleBars.map(bar => bar.time))'));
  const expected = source.bars.filter(bar => bar.time >= range.first && bar.time < range.last).map(bar => bar.time);
  assert.deepEqual(actual, expected, 'Seconds pane must contain exactly the source bars within the minute viewport');
  assert.equal(test.run('researchCharts.minute.geometry.first'), test.run('researchCharts.second.geometry.first'));
  assert.equal(test.run('researchCharts.minute.geometry.last'), test.run('researchCharts.second.geometry.last'));
}

function assertOpeningMinute(test, source) {
  const levels = test.run('researchOpeningMinute()');
  assert.ok(levels);
  assert.equal(test.run(`researchClock(${levels.start}, true)`), '09:30:00');
  assert.equal(test.run(`researchClock(${levels.end - 1}, true)`), '09:30:59');
  const openingSeconds = source.bars.filter(bar => bar.time >= levels.start && bar.time < levels.end);
  assert.ok(openingSeconds.length > 0);
  assert.equal(levels.high, Math.max(...openingSeconds.map(bar => Number(bar.high))));
  assert.equal(levels.low, Math.min(...openingSeconds.map(bar => Number(bar.low))));
}

async function main() {
  const html = read('research.html');
  assert.deepEqual([...html.matchAll(/<script[^>]+src="([^"?]+)/g)].map(match => match[1]), ['research.js']);
  assert.deepEqual([...html.matchAll(/<link[^>]+href="([^"?]+)/g)].map(match => match[1]), ['research.css']);
  assert.match(read('index.html'), /href="research.html"/);
  assert.doesNotMatch(read('index.html'), /src="research.js|id="view-nvidia"/);
  assert.doesNotMatch(read('workspace.js'), /initializeResearch/);
  assert.doesNotMatch(html, /research-zoom-in|research-zoom-out|research-reset/);
  assert.match(html, /id="research-seconds-canvas"/);
  const betweenCharts = html.slice(html.indexOf('</canvas>'), html.indexOf('id="research-seconds-canvas"'));
  assert.doesNotMatch(betweenCharts, /<p\b|<h2\b|research-position/, 'The charts must have no text or controls between them');

  const test = harness();
  await test.run('initializeResearch()');
  assert.deepEqual(test.requests.map(request => request.url), ['data/research/sessions.json']);
  const buttons = test.elements.get('research-calendar').children.filter(item => item.dataset.researchDate);
  assert.equal(buttons.length, index.sessions.filter(entry => entry.date.startsWith('2026-10')).length);
  assert.equal(buttons[0].dataset.researchDate, '2026-10-01');
  await buttons[0].handlers.click();
  assert.equal(test.requests.length, 3);
  assert.equal(test.requests[1].options.cache, 'default');
  assert.match(test.elements.get('research-status').textContent, /09:20.*10:59 NY.*100 velas/);
  assert.equal(test.elements.get('research-seconds-status').hidden, true);
  assert.equal(buttons[0]['aria-pressed'], 'true');
  assert.equal(test.run('researchCharts.second.visibleBars.length'), secondSession.bars.length);
  assertSynchronized(test);
  assertOpeningMinute(test, secondSession);
  assert.ok(test.calls.some(call => call[0] === 'fillText' && String(call[1]).startsWith('High 09:30')));
  assert.ok(test.calls.some(call => call[0] === 'fillText' && String(call[1]).startsWith('Low 09:30')));
  test.calls.length = 0;
  test.run('researchCharts.minute.cacheKey = null; drawResearchPane(researchCharts.minute, researchData)');
  assert.ok(!test.calls.some(call => call[0] === 'fillText' && /^(High|Low) 09:30/.test(String(call[1]))), 'Opening levels belong only on the seconds chart');
  await test.run("loadResearchSession('2026-10-01')");
  assert.equal(test.requests.length, 3, 'A repeated selection must reuse both cached datasets');
  await test.run("loadResearchSession('2026-10-03')");
  assert.equal(test.requests.length, 3, 'An unavailable day must not request a file');
  test.run('zoomResearch(.5)');
  assert.equal(test.elements.get('research-position')['aria-disabled'], 'false');
  test.run('zoomResearch(researchSpan)');
  assert.equal(test.elements.get('research-position')['aria-disabled'], 'true');
  const initialWindow = test.run('researchWindow');
  const initialStart = test.run('researchStart');
  const initialRequests = test.requests.length;
  await buttons[0].handlers.click();
  assert.equal(buttons[0]['aria-pressed'], 'false');
  assert.equal(test.run('researchData'), null);
  assert.equal(test.run('researchSecondData'), null);
  assert.equal(test.run('researchOpeningMinute()'), null);
  assert.equal(test.run('researchCharts.second.visibleBars.length'), 0);
  assert.equal(test.elements.get('research-position').scrollLeft, 0);
  await buttons[0].handlers.click();
  assert.equal(test.requests.length, 3, 'Reselecting a deselected day must use its cached data');

  const canvas = test.elements.get('research-canvas');
  let prevented = false;
  const wheel = { deltaY: -120, deltaMode: 0, clientX: 450, preventDefault() { prevented = true; } };
  canvas.handlers.wheel(wheel);
  assert.equal(prevented, true);
  assert.ok(test.run('researchWindow < researchSpan'));
  assert.ok(parseFloat(test.elements.get('research-scroll-track').style.width) > 100);
  for (let i = 0; i < 30; i++) canvas.handlers.wheel(wheel);
  assert.equal(test.run('researchWindow'), 1);
  assertSynchronized(test);
  canvas.handlers.wheel({ ...wheel, deltaY: 1 });
  assert.equal(test.run('researchWindow'), 2, 'Zoom out must escape the one-minute minimum even with small wheel deltas');
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
  assertSynchronized(test);

  canvas.handlers.pointermove({ clientX: 450, clientY: 140 });
  test.calls.length = 0;
  test.run('drawResearchChart()');
  assert.ok(test.calls.some(call => call[0] === 'moveTo' && call[1] === 12 && call[2] === 140), 'Crosshair must include a horizontal line');
  const expectedPrice = test.run('(researchCharts.minute.geometry.high - (140 - researchCharts.minute.geometry.top) / (researchCharts.minute.geometry.bottom - researchCharts.minute.geometry.top) * (researchCharts.minute.geometry.high - researchCharts.minute.geometry.low)).toFixed(2)');
  assert.ok(test.calls.some(call => call[0] === 'fillText' && call[1] === expectedPrice && call[2] === 842), 'Crosshair must show its price on the axis');
  assert.ok(!test.calls.some(call => call[0] === 'clip'), 'Hover must reuse cached candle layers');

  canvas.handlers.pointerdown({ button: 0, pointerId: 7, clientX: 850, clientY: 140, preventDefault() {} });
  assert.equal(canvas.pointerId, 7);
  const originalRange = test.run('researchCharts.minute.geometry.high - researchCharts.minute.geometry.low');
  canvas.handlers.pointermove({ pointerId: 7, clientX: 850, clientY: 180 });
  assert.ok(test.run('researchCharts.minute.priceRange.high - researchCharts.minute.priceRange.low') > originalRange);
  canvas.handlers.pointerup({ pointerId: 7 });
  assert.equal(test.run('researchDrag'), null);
  assert.equal(canvas.pointerId, null);
  test.run('drawResearchChart()');
  canvas.handlers.dblclick({ clientX: 850, clientY: 140 });
  assert.equal(test.run('researchCharts.minute.priceRange'), null);
  canvas.handlers.pointerdown({ button: 0, pointerId: 8, clientX: 450, clientY: 140, preventDefault() {} });
  assert.equal(test.run('researchDrag.type'), 'pan');
  canvas.handlers.pointermove({ pointerId: 8, clientX: 200, clientY: 140 });
  assert.ok(test.run('researchStart') > 0, 'Dragging left must move forward in the session');
  assert.equal(test.run('researchCharts.minute.priceRange'), null, 'Panning must not scale Y');
  canvas.handlers.pointerup({ pointerId: 8 });
  test.run('drawResearchChart()');
  assert.equal(test.run('researchCharts.minute.geometry.first'), test.run('researchCharts.second.geometry.first'));
  assert.equal(test.run('researchCharts.minute.geometry.last'), test.run('researchCharts.second.geometry.last'));
  assertSynchronized(test);
  const secondCanvas = test.elements.get('research-seconds-canvas');
  const beforeSecondPan = test.run('researchStart');
  secondCanvas.handlers.pointerdown({ button: 0, pointerId: 15, clientX: 450, clientY: 140, preventDefault() {} });
  secondCanvas.handlers.pointermove({ pointerId: 15, clientX: 400, clientY: 140 });
  secondCanvas.handlers.pointerup({ pointerId: 15 });
  assert.ok(test.run('researchStart') > beforeSecondPan, 'Dragging the seconds pane must pan both charts');
  assertSynchronized(test);
  secondCanvas.handlers.wheel({ ...wheel, deltaY: -120 });
  assertSynchronized(test);
  canvas.handlers.pointerdown({ button: 0, pointerId: 9, clientX: 850, clientY: 180, preventDefault() {} });
  const rangeBeforeUp = test.run('researchCharts.minute.geometry.high - researchCharts.minute.geometry.low');
  canvas.handlers.pointermove({ pointerId: 9, clientX: 850, clientY: 140 });
  assert.ok(test.run('researchCharts.minute.priceRange.high - researchCharts.minute.priceRange.low') < rangeBeforeUp);
  canvas.handlers.pointercancel({ pointerId: 9 });
  assert.equal(test.run('researchDrag'), null);
  assert.equal(canvas.pointerId, null);
  canvas.handlers.dblclick({ clientX: 850, clientY: 140 });
  test.run('zoomResearch(researchSpan)');
  assert.equal(test.run('researchCharts.minute.priceRange'), null);
  assert.equal(test.run('researchWindow'), initialWindow);
  assert.equal(test.requests.length, initialRequests);

  test.elements.get('research-month-prev').handlers.click();
  assert.equal(test.run('researchMonth'), '2026-09');
  assert.equal(test.elements.get('research-calendar').children.filter(item => item.dataset.researchDate).length, 0);
  test.elements.get('research-month-next').handlers.click();
  assert.equal(test.run('researchMonth'), '2026-10');
  assert.equal(test.elements.get('research-calendar').children.filter(item => item.dataset.researchDate).length, index.sessions.filter(entry => entry.date.startsWith('2026-10')).length);
  test.run("renderResearchCalendar('2026-12')");
  test.elements.get('research-month-next').handlers.click();
  assert.equal(test.run('researchMonth'), '2027-01');
  assert.equal(test.requests.length, 3, 'Navigating months must not load session files');
  test.run("renderResearchCalendar('2026-10')");
  const dayTwo = test.elements.get('research-calendar').children.find(item => item.dataset.researchDate === '2026-10-02');
  await dayTwo.handlers.click();
  assert.equal(dayTwo['aria-pressed'], 'true');
  assert.equal(test.run('researchData.date'), '2026-10-02');
  assert.equal(test.run('researchSecondData.date'), '2026-10-02');
  assert.match(test.elements.get('research-chart-title').textContent, /02\/10\/2026/);
  assert.equal(test.requests.length, 5);
  const dayTwoSeconds = JSON.parse(read('data/research/nvda-2026-10-02-1s.json'));
  assertSynchronized(test, dayTwoSeconds);
  assertOpeningMinute(test, dayTwoSeconds);
  test.run('zoomResearch(.2)');
  assertSynchronized(test, dayTwoSeconds);
  await test.run("loadResearchSession('2026-10-01')");
  assert.equal(test.requests.length, 5, 'Returning to the first day must reuse its own cached data');
  assertSynchronized(test);

  const octoberDates = index.sessions.filter(entry => entry.date.startsWith('2026-10')).map(entry => entry.date);
  assert.equal(octoberDates.length, 22);
  assert.equal(new Set(octoberDates).size, 22);
  for (const date of octoberDates.filter(date => date > '2026-10-02')) {
    test.calls.length = 0;
    const previousRequests = test.requests.length;
    const button = test.elements.get('research-calendar').children.find(item => item.dataset.researchDate === date);
    assert.ok(button, `${date} must be selectable in the calendar`);
    await button.handlers.click();
    assert.equal(button['aria-pressed'], 'true');
    assert.equal(test.run('researchData.date'), date);
    assert.equal(test.run('researchSecondData.date'), date);
    assert.equal(test.requests.length, previousRequests + 2, 'Selecting a new day must load only its two files');
    const source = JSON.parse(read(`data/research/nvda-${date}-1s.json`));
    assertOpeningMinute(test, source);
    assertSynchronized(test, source);
    test.run('zoomResearch(.2)');
    assertSynchronized(test, source);
    await button.handlers.click();
    assert.equal(test.run('researchData'), null);
    await button.handlers.click();
    assert.equal(test.requests.length, previousRequests + 2, 'Reselecting a session must use its cached data');
  }

  const retry = harness();
  await retry.run('initializeResearch()');
  retry.fail();
  await retry.run("loadResearchSession('2026-10-01')");
  assert.match(retry.elements.get('research-status').textContent, /No se pudo cargar/);
  await retry.run("loadResearchSession('2026-10-01')");
  assert.match(retry.elements.get('research-status').textContent, /100 velas/);
  assert.equal(retry.requests.length, 4);

  const secondsRetry = harness();
  await secondsRetry.run('initializeResearch()');
  secondsRetry.fail('-1s.json');
  await secondsRetry.run("loadResearchSession('2026-10-01')");
  assert.match(secondsRetry.elements.get('research-status').textContent, /100 velas/);
  assert.match(secondsRetry.elements.get('research-seconds-status').textContent, /No se pudieron cargar/);
  assert.equal(secondsRetry.elements.get('research-seconds-status').hidden, false);
  assert.equal(secondsRetry.run('researchSecondData'), null);
  secondsRetry.run('clearResearchSession()');
  await secondsRetry.run("loadResearchSession('2026-10-01')");
  assert.equal(secondsRetry.requests.length, 4, 'Retrying seconds must retain the cached minute data');
  assertSynchronized(secondsRetry);

  const multiple = harness({ ...index, sessions: [...index.sessions,
    { date: '2026-11-17', file: 'nvda-2026-11-17-1m.json', secondsFile: 'nvda-2026-11-17-1s.json', version: 'test' }] });
  await multiple.run('initializeResearch()');
  assert.equal(multiple.run('researchMonth'), '2026-11');
  assert.equal(multiple.requests.length, 1);
  await multiple.run("loadResearchSession('2026-11-17')");
  assert.match(multiple.elements.get('research-status').textContent, /09:30.*NY/);
  assert.match(multiple.elements.get('research-chart-title').textContent, /17\/11\/2026/);
  multiple.run("renderResearchCalendar('2026-10')");
  await multiple.run("loadResearchSession('2026-10-01')");
  assert.equal(multiple.requests.length, 5);
  await multiple.run("loadResearchSession('2026-11-17')");
  assert.equal(multiple.requests.length, 5);
  console.log('Research isolation, linked minute/second panes, drag panning, exact time bounds, cached drawing, daily loading, retry, wheel zoom, scrollbar, crosshair, price scaling, calendar and NY timezone: OK');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
