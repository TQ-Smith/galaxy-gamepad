/* Tests for extension/galaxy-gamepad.user.js against a synthetic Galaxy DOM.
 *
 * The fixture uses the same data-description attributes the live
 * analysis.bundled.js defines, so what is exercised here is the real selector
 * resolution, focus navigation, click dispatch, radial-menu routing and
 * job-state haptics — not a mock of them.
 *
 *   node tests/test_userscript.mjs
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const SRC = fs.readFileSync(new URL('../extension/galaxy-gamepad.user.js', import.meta.url), 'utf8');

// ---------------------------------------------------------------- fixture
const HTML = `<!doctype html><html><body>
<nav data-description="activity bar">
  <button data-description="activity tools">Tools</button>
  <button data-description="activity workflows">Workflows</button>
  <button data-description="upload">Upload</button>
</nav>
<div data-description="panel toolbox">
  <input type="text" placeholder="search tools">
  <a href="/tool_runner?tool_id=fastqc">FastQC</a>
  <a href="/tool_runner?tool_id=cutadapt">Cutadapt</a>
</div>
<div id="center">
  <input type="text" id="param-threshold" value="20">
  <select id="param-mode"><option>single</option></select>
  <button data-description="run tool button">Run Tool</button>
  <button data-description="execute workflow button">Run workflow</button>
</div>
<section id="right">
  <button data-description="history options">History options</button>
  <button data-description="create new history">New history</button>
  <button data-description="switch to another history">Switch</button>
  <button data-description="include hidden items button">Hidden</button>
  <button data-description="include deleted items button">Deleted</button>
  <div data-hid="3" data-state="ok">3: SRR1039509_R1.fastqsanger.gz
    <button data-description="edit details">Edit</button>
    <button data-description="add tags">Tags</button>
    <button data-description="dataset download">Download</button>
    <button data-description="hide option">Hide</button>
    <button data-description="delete option">Delete</button>
    <a data-description="job link">job</a>
  </div>
  <div data-hid="2" data-state="running">2: FastQC on data 1</div>
  <div data-hid="1" data-state="ok">1: SRR1039508_R1.fastqsanger.gz</div>
</section>
</body></html>`;

// ---------------------------------------------------------------- scaffold
const dom = new JSDOM(HTML, { url: 'https://usegalaxy.org/', runScripts: 'outside-only' });
const { window } = dom;
const { document } = window;

// jsdom has no layout: synthesise stable rects in document order so the
// visibility filter and geometric sort have something real to work with.
let seq = 0;
const rects = new WeakMap();
window.Element.prototype.getBoundingClientRect = function () {
  if (!rects.has(this)) rects.set(this, seq++);
  const i = rects.get(this);
  return { top: i * 30, left: 10, bottom: i * 30 + 24, right: 210,
           width: 200, height: 24, x: 10, y: i * 30 };
};
window.Element.prototype.scrollIntoView = function () {};
window.devicePixelRatio = 1;
window.scrollTo = () => {};

const vibes = [];
const gamepad = {
  index: 0, id: 'Test Pad (STANDARD GAMEPAD)',
  buttons: Array.from({ length: 16 }, () => ({ pressed: false })),
  axes: [0, 0, 0, 0],
  vibrationActuator: { playEffect: (t, o) => { vibes.push(o.duration); return Promise.resolve(); } },
};
window.navigator.getGamepads = () => [gamepad];

const clicks = [];
window.document.addEventListener('click', (e) => {
  const t = e.target;
  clicks.push(t.getAttribute('data-description') || t.getAttribute('data-hid') || t.tagName);
}, true);

// Galaxy's own API, same-origin.
let contents = [
  { id: 'a', hid: 3, name: 'SRR1039509_R1', state: 'ok' },
  { id: 'b', hid: 2, name: 'FastQC on data 1', state: 'running' },
  { id: 'c', hid: 1, name: 'SRR1039508_R1', state: 'ok' },
];
const fetched = [];
window.fetch = async (path) => {
  fetched.push(path);
  if (path.includes('most_recently_used')) return json({ id: 'h1', name: 'RNA-seq pilot' });
  if (path.includes('/contents')) return json(contents);
  return { ok: false, status: 404, json: async () => ({}) };
};
const json = (v) => ({ ok: true, json: async () => v });

let rafCb = null;
window.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };

// ------------------------------------------------------------------- run
window.eval(SRC);
const api = window.__galaxyGamepadApi;
assert.ok(api, 'userscript did not expose its api');
// jsdom may still report readyState 'loading' at this point, in which case the
// script has deferred boot() to DOMContentLoaded exactly as it would in a page.
if (!rafCb) {
  document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
}
assert.ok(rafCb, `boot never reached the frame loop (readyState=${document.readyState})`);

let clock = 1000;
const tick = (n = 1) => { for (let i = 0; i < n; i++) { clock += 16; rafCb(clock); } };
const key = (code, type) => window.dispatchEvent(new window.KeyboardEvent(type, { code, bubbles: true }));
const press = (c) => key(c, 'keydown');
const release = (c) => key(c, 'keyup');
const tap = (c, n = 2) => { press(c); tick(n); release(c); tick(1); };
const hud = () => api.S && dom.window.document.getElementById('galaxy-gamepad-overlay')
  .shadowRoot.querySelector('.hud').textContent;

const T = [];
const test = (name, fn) => { try { fn(); T.push(['ok', name]); }
                             catch (e) { T.push(['FAIL', name + ' :: ' + e.message]); } };

tick(2);

test('overlay is injected into a shadow root', () => {
  const host = document.getElementById('galaxy-gamepad-overlay');
  assert.ok(host && host.shadowRoot, 'no shadow root');
  assert.ok(host.shadowRoot.querySelector('.hud'), 'no HUD');
});

test('boots into the history region with real items', () => {
  assert.equal(api.REGIONS[api.S.region].key, 'history');
  assert.ok(api.S.items.length >= 3, `found ${api.S.items.length} items`);
  assert.ok(api.S.items.every((el) => el.hasAttribute('data-hid')));
});

test('HUD names the region and the focused target', () => {
  const h = hud();
  assert.match(h, /HISTORY/);
  assert.match(h, /1\/3/);
});

test('left stick moves focus and draws the ring', () => {
  const before = api.S.index;
  press('KeyS'); tick(2); release('KeyS'); tick(1);
  assert.equal(api.S.index, before + 1);
  const ring = document.getElementById('galaxy-gamepad-overlay').shadowRoot.querySelector('.ring');
  assert.equal(ring.style.display, 'block');
  assert.notEqual(ring.style.top, '');
});

test('A clicks the focused history item (a real DOM click)', () => {
  clicks.length = 0;
  tap('KeyJ');
  assert.deepEqual(clicks, ['2'], `clicked ${JSON.stringify(clicks)}`);
});

test('radial menu routes a slice to the matching data-description target', () => {
  clicks.length = 0;
  press('KeyL'); tick(2);                       // hold X -> wheel opens
  assert.ok(api.S.wheel, 'wheel did not open');
  assert.equal(api.S.wheel.slices[0].label, 'Expand');
  press('ArrowDown'); tick(2);                  // ry+ -> south -> slice 4
  assert.equal(api.S.wheel.sel, 4);
  release('ArrowDown'); press('ArrowRight'); tick(2);
  assert.equal(api.S.wheel.sel, 2);             // east -> 'Edit attrs'
  release('ArrowRight'); tick(2);
  assert.equal(api.S.wheel.sel, 2, 'selection lost when the stick recentred');
  release('KeyL'); tick(2);
  assert.ok(!api.S.wheel, 'wheel did not close');
  assert.deepEqual(clicks, ['edit details'], `clicked ${JSON.stringify(clicks)}`);
});

test('RB cycles regions and finds the centre panel form', () => {
  tap('KeyE');
  assert.equal(api.REGIONS[api.S.region].key, 'center');
  assert.ok(api.S.items.length >= 3, `found ${api.S.items.length}`);
});

test('centre-panel wheel slice 0 presses Galaxy\'s Run Tool button', () => {
  clicks.length = 0;
  press('KeyL'); tick(2);
  assert.equal(api.S.wheel.slices[0].label, 'RUN');
  press('ArrowUp'); tick(2);                    // north -> slice 0
  assert.equal(api.S.wheel.sel, 0);
  release('ArrowUp'); release('KeyL'); tick(2);
  assert.deepEqual(clicks, ['run tool button'], `clicked ${JSON.stringify(clicks)}`);
});

test('keystrokes are not stolen while typing in a Galaxy field', () => {
  const input = document.getElementById('param-threshold');
  input.focus();
  const before = api.S.index;
  press('KeyS'); tick(2); release('KeyS'); tick(1);
  assert.equal(api.S.index, before, 'focus moved while the user was typing');
  input.blur();
});

test('Menu pauses and resumes the pad', () => {
  tap('Backslash');
  assert.equal(api.S.enabled, false);
  const before = api.S.index;
  press('KeyS'); tick(3); release('KeyS'); tick(1);
  assert.equal(api.S.index, before, 'input acted while paused');
  tap('Backslash');
  assert.equal(api.S.enabled, true);
});

test('selector doctor reports resolved and missing targets', () => {
  tap('Backquote');
  const p = document.getElementById('galaxy-gamepad-overlay').shadowRoot.querySelector('.panel');
  assert.ok(p, 'doctor panel not shown');
  const txt = p.textContent;
  for (const k of ['runTool', 'historyItems', 'activityBar', 'toolSearch'])
    assert.ok(txt.includes(k), `doctor missing ${k}`);
  assert.ok(p.querySelectorAll('td.ok').length >= 8, 'too few resolved targets');
  tap('Backquote');
});

// -- job state -> haptics, through Galaxy's own API --------------------------
vibes.length = 0;
await api.pollStates();
await new Promise((r) => setTimeout(r, 200));
test('first poll baselines silently (no buzz storm on load)', () => {
  assert.equal(vibes.length, 0, `fired ${vibes.length} effects on the first poll`);
  assert.ok(fetched.some((u) => u.includes('most_recently_used')));
  assert.ok(fetched.some((u) => u.includes('/api/histories/h1/contents')));
});

contents = contents.map((c) => (c.hid === 2 ? { ...c, state: 'ok' } : c));
await api.pollStates();
await new Promise((r) => setTimeout(r, 400));
test('a job finishing fires the two-pulse done pattern', () => {
  assert.deepEqual(vibes, [90, 90], `patterns fired: ${JSON.stringify(vibes)}`);
});

vibes.length = 0;
contents = contents.map((c) => (c.hid === 3 ? { ...c, state: 'error' } : c));
await api.pollStates();
await new Promise((r) => setTimeout(r, 500));
test('a job failing fires the long single buzz', () => {
  assert.deepEqual(vibes, [430], `patterns fired: ${JSON.stringify(vibes)}`);
});

test('poll interval backs off when nothing is active', () => {
  assert.equal(api.S.pollMs, 30000, `pollMs=${api.S.pollMs}`);
});

// A signed-out session: Galaxy returns success with no history, so the pad
// must say so rather than going quietly dead.
vibes.length = 0;
const api2 = api; api2.S.historyId = null; api2.S.warnedAnon = false;
window.fetch = async (path) => {
  fetched.push(path);
  if (path.includes('most_recently_used')) return json(null);
  return json([]);
};
await api.pollStates();
test('a signed-out session is reported, not silently ignored', () => {
  const sr = document.getElementById('galaxy-gamepad-overlay').shadowRoot;
  const t = [...sr.querySelectorAll('.toast')].map((e) => e.textContent).join('|');
  assert.match(t, /not signed in/);
  assert.equal(api.S.pollMs, 60000, `pollMs=${api.S.pollMs}`);
  assert.equal(vibes.length, 0, 'buzzed with no history');
});

// --------------------------------------------------------------- report
let bad = 0;
for (const [st, name] of T) {
  if (st !== 'ok') bad++;
  console.log(`${st === 'ok' ? ' ok ' : 'FAIL'}  ${name}`);
}
console.log(`\n${T.length - bad}/${T.length} passed`);
process.exit(bad ? 1 : 0);
