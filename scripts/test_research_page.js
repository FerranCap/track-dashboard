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
  let failNext = false;
  function element() {
    return { children: [], handlers: {}, dataset: {}, disabled: false,
      append(child) { this.children.push(child); },
      replaceChildren() { this.children = []; },
      setAttribute(key, value) { this[key] = value; },
      addEventListener(key, callback) { this.handlers[key] = callback; },
      getBoundingClientRect() { return { width: 900, height: 490, left: 0 }; }
    };
  }
  const document = {
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    createElement: element,
    querySelectorAll() { return document.getElementById('research-calendar').children.filter(item => item.dataset.researchDate); },
    addEventListener() {}
  };
  const drawing = new Proxy({}, { get: (object, key) => object[key] || (() => {}), set: (object, key, value) => { object[key] = value; return true; } });
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
  return { run: code => vm.runInContext(code, context), requests, elements, fail() { failNext = true; } };
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
  assert.equal(test.elements.get('research-position').disabled, false);
  test.elements.get('research-reset').handlers.click();
  assert.equal(test.elements.get('research-position').disabled, true);

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
  assert.equal(multiple.elements.get('research-month-select').children.length, 2);
  assert.equal(multiple.requests.length, 1);
  await multiple.run("loadResearchSession('2026-11-17')");
  assert.match(multiple.elements.get('research-status').textContent, /09:30.*NY/);
  assert.match(multiple.elements.get('research-chart-title').textContent, /17\/11\/2026/);
  multiple.run("renderResearchCalendar('2026-10')");
  await multiple.run("loadResearchSession('2026-10-01')");
  assert.equal(multiple.requests.length, 3);
  await multiple.run("loadResearchSession('2026-11-17')");
  assert.equal(multiple.requests.length, 3);
  console.log('Research isolation, on-demand loading, cache, retry, calendar and NY timezone: OK');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
