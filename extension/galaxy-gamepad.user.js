// ==UserScript==
// @name         Galaxy Gamepad
// @namespace    galaxy-gamepad
// @version      0.1.0
// @description  Operate the Galaxy web interface with a game controller.
// @match        https://usegalaxy.org/*
// @match        https://galaxy-main.usegalaxy.org/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/* Galaxy Gamepad — drives the real Galaxy page.
 *
 * This is an in-page layer, not a replacement interface: it moves focus over
 * the elements Galaxy already renders, clicks them, and reads job state from
 * Galaxy's own API using the session you are already logged into (no API key).
 *
 * The known weakness of in-page automation is DOM drift. Three things contain
 * it: every target is addressed through one SELECTORS table (so a Galaxy
 * release is a one-table edit), every entry carries fallbacks, and the
 * built-in selector doctor (View button, twice) reports which targets
 * resolved on the page in front of you.
 *
 * Selector evidence: the `data-description` attributes used below were taken
 * from the live analysis.bundled.js served by galaxy-main.usegalaxy.org, which
 * defines 249 distinct values. They are the most stable handles the client
 * offers — they exist specifically to be addressed from outside.
 */
'use strict';

(function () {
if (window.__galaxyGamepad) return;
window.__galaxyGamepad = true;

// ---------------------------------------------------------------- selectors
// Each logical target is a list of candidates tried in order. First match wins.
const SELECTORS = {
  // regions
  activityBar:    ['[data-description="activity bar"]', '#activity-bar', 'nav.activity-bar'],
  toolPanel:      ['[data-description="panel toolbox"]', '#tool-panel', '.tool-panel'],
  centerPanel:    ['#center', '#center-panel', 'main', '[role="main"]'],
  historyPanel:   ['[data-description="history panel"]', '#right', '.history-index',
                   '#current-history-panel'],
  // navigable items
  historyItems:   ['[data-hid]', '.content-item', '[data-description="content item header info"]'],
  activityItems:  ['[data-description="activity bar"] [role="button"]',
                   '[data-description="activity bar"] button',
                   '[data-description="activity bar"] a'],
  toolItems:      ['[data-description="panel toolbox"] a[href*="tool_id"]',
                   '.toolTitle a', '[data-description="panel toolbox"] button'],
  formFields:     ['#center input:not([type=hidden]), #center select, #center textarea, ' +
                   '#center [role="button"], #center button'],
  // actions
  runTool:        ['[data-description="run tool button"]', 'button#execute', '#execute'],
  executeWorkflow:['[data-description="execute workflow button"]'],
  historyOptions: ['[data-description="history options"]', '[data-description="history action menu"]'],
  newHistory:     ['[data-description="create new history"]'],
  switchHistory:  ['[data-description="switch to another history"]',
                   '[data-description="switch to history button"]'],
  upload:         ['[data-description="upload"]'],
  toolSearch:     ['[data-description="panel toolbox"] input[type="text"]',
                   'input#tool-search-query', 'input[placeholder*="search" i]'],
  datasetHid:     ['[data-description="dataset hid"]'],
  datasetDownload:['[data-description="dataset download"]'],
  jobInfo:        ['[data-description="job information modal"]', '[data-description="job link"]',
                   '[data-description="singular job link"]'],
  hideOption:     ['[data-description="hide option"]'],
  deleteOption:   ['[data-description="delete option"]'],
  addTags:        ['[data-description="add tags"]'],
  editDetails:    ['[data-description="edit details"]'],
  invocationState:['[data-description="workflow invocation state"]'],
  showHidden:     ['[data-description="include hidden items button"]'],
  showDeleted:    ['[data-description="include deleted items button"]'],
};

const REGIONS = [
  { key: 'history',  label: 'History',  items: 'historyItems',  root: 'historyPanel' },
  { key: 'center',   label: 'Center',   items: 'formFields',    root: 'centerPanel' },
  { key: 'tools',    label: 'Tools',    items: 'toolItems',     root: 'toolPanel' },
  { key: 'activity', label: 'Activity', items: 'activityItems', root: 'activityBar' },
];

// ---------------------------------------------------------------- utilities
const $one = (key) => {
  for (const sel of SELECTORS[key] || []) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
};
const $all = (key) => {
  for (const sel of SELECTORS[key] || []) {
    const els = [...document.querySelectorAll(sel)].filter(visible);
    if (els.length) return els;
  }
  return [];
};
function visible(el) {
  if (!el || !el.getBoundingClientRect) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const st = window.getComputedStyle ? getComputedStyle(el) : null;
  return !st || (st.visibility !== 'hidden' && st.display !== 'none');
}
const byPosition = (a, b) => {
  const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
  return (ra.top - rb.top) || (ra.left - rb.left);
};

// -------------------------------------------------------------------- state
const S = {
  region: 0, index: 0, items: [], wheel: null, doctor: false, help: false,
  toast: null, padName: null, states: new Map(), historyId: null,
  pollMs: 30000, lastPoll: 0, haptics: true, enabled: true,
};

// ------------------------------------------------------------------ haptics
const PATTERNS = {
  tick: [[60, 0.15, 0.35]],
  done: [[90, 0.45, 0.25], [70, 0], [90, 0.45, 0.25]],
  fail: [[430, 0.95, 0.15]],
  fanfare: [[70, 0.3, 0.2], [60, 0], [70, 0.55, 0.3], [60, 0], [110, 0.85, 0.5]],
  nudge: [[25, 0.08, 0.18]],
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let padIndex = 0;
async function rumble(name) {
  if (!S.haptics) return;
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const pad = pads && pads[padIndex];
  const act = pad && (pad.vibrationActuator || (pad.hapticActuators || [])[0]);
  if (!act || !act.playEffect) return;
  for (const [dur, strong, weak] of PATTERNS[name] || PATTERNS.tick) {
    if (strong === 0) { await sleep(dur); continue; }
    try {
      await act.playEffect('dual-rumble', {
        duration: dur, startDelay: 0, strongMagnitude: strong,
        weakMagnitude: weak === undefined ? strong : weak });
    } catch (_) { return; }
    await sleep(dur);
  }
}

// -------------------------------------------------------------------- input
const B = { A:0, B:1, X:2, Y:3, LB:4, RB:5, LT:6, RT:7, VIEW:8, MENU:9,
            L3:10, R3:11, UP:12, DOWN:13, LEFT:14, RIGHT:15 };
const KEYMAP = {
  KeyJ: B.A, KeyK: B.B, KeyL: B.X, KeyI: B.Y, KeyQ: B.LB, KeyE: B.RB,
  KeyU: B.LT, KeyO: B.RT, Backquote: B.VIEW, Backslash: B.MENU,
  KeyW: 'ly-', KeyS: 'ly+', KeyA: 'lx-', KeyD: 'lx+',
  ArrowUp: 'ry-', ArrowDown: 'ry+', ArrowLeft: 'rx-', ArrowRight: 'rx+',
};
const DEADZONE = 0.35, REPEAT_FIRST = 380, REPEAT_NEXT = 110;
const keys = {}, prev = {}, repeat = {};

function isTyping() {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

addEventListener('keydown', (e) => {
  // Never steal keystrokes while the user is typing in a Galaxy field.
  if (isTyping() && e.code !== 'Escape') return;
  if (e.code === 'Escape') { document.activeElement && document.activeElement.blur(); return; }
  if (KEYMAP[e.code] !== undefined) { keys[e.code] = true; e.preventDefault(); }
}, true);
addEventListener('keyup', (e) => { delete keys[e.code]; }, true);
addEventListener('gamepadconnected', (e) => {
  padIndex = e.gamepad.index; S.padName = e.gamepad.id;
  toast('controller connected'); rumble('done');
});
addEventListener('gamepaddisconnected', () => { S.padName = null; });

function readInput() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const pad = pads && pads[padIndex];
  const btn = {}, ax = { lx: 0, ly: 0, rx: 0, ry: 0 };
  if (pad) {
    for (const k in B) btn[B[k]] = !!(pad.buttons[B[k]] && pad.buttons[B[k]].pressed);
    ax.lx = pad.axes[0] || 0; ax.ly = pad.axes[1] || 0;
    ax.rx = pad.axes[2] || 0; ax.ry = pad.axes[3] || 0;
    if (!S.padName) S.padName = pad.id;
  }
  if (!isTyping()) {
    for (const code in keys) {
      const m = KEYMAP[code];
      if (typeof m === 'number') btn[m] = true;
      else ax[m.slice(0, 2)] = m.endsWith('-') ? -1 : 1;
    }
  }
  if (btn[B.UP]) ax.ly = -1; if (btn[B.DOWN]) ax.ly = 1;
  if (btn[B.LEFT]) ax.lx = -1; if (btn[B.RIGHT]) ax.lx = 1;
  return { btn, ax };
}
const dz = (v) => (Math.abs(v) < DEADZONE ? 0 : v);
function edges(btn) {
  const down = {}, up = {};
  for (const k in B) {
    const cur = !!btn[B[k]];
    if (cur && !prev[B[k]]) down[k] = true;
    if (!cur && prev[B[k]]) up[k] = true;
    prev[B[k]] = cur;
  }
  return { down, up };
}
function axisStep(name, value, now) {
  const dir = Math.sign(dz(value));
  const r = repeat[name] || (repeat[name] = { dir: 0, next: 0 });
  if (!dir) { r.dir = 0; return 0; }
  if (dir !== r.dir) { r.dir = dir; r.next = now + REPEAT_FIRST; return dir; }
  if (now >= r.next) { r.next = now + REPEAT_NEXT; return dir; }
  return 0;
}

// ------------------------------------------------------------------ overlay
// A shadow root keeps Galaxy's CSS out and our CSS in.
let host, root, ring, hud, wheelEl, panel;
function buildOverlay() {
  host = document.createElement('div');
  host.id = 'galaxy-gamepad-overlay';
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000';
  (document.body || document.documentElement).appendChild(host);
  root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  const style = document.createElement('style');
  style.textContent = `
    :host, * { box-sizing: border-box; }
    .ring { position:fixed; border:2px solid #e08a3c; border-radius:6px;
            box-shadow:0 0 0 3px rgba(224,138,60,.22); transition:all .08s linear; }
    .hud { position:fixed; left:50%; bottom:10px; transform:translateX(-50%);
           background:rgba(20,23,28,.94); color:#e8ecf1; border:1px solid #333b47;
           border-radius:8px; padding:7px 12px; font:12px ui-monospace,Menlo,monospace;
           display:flex; gap:14px; align-items:center; white-space:nowrap; }
    .hud b { background:#232933; color:#e08a3c; border:1px solid #e08a3c;
             border-radius:4px; padding:1px 6px; margin-right:5px; }
    .hud .region { color:#4a9fd8; font-weight:700; }
    .hud .target { color:#8b97a7; max-width:30ch; overflow:hidden; text-overflow:ellipsis; }
    .toast { position:fixed; left:50%; bottom:58px; transform:translateX(-50%);
             background:#232933; color:#e8ecf1; border:1px solid #5fae6b;
             border-radius:6px; padding:6px 14px; font:12px ui-monospace,monospace; }
    .panel { position:fixed; right:16px; top:64px; width:430px; max-height:72vh;
             overflow:auto; background:rgba(20,23,28,.97); color:#e8ecf1;
             border:1px solid #333b47; border-radius:8px; padding:12px 14px;
             font:11.5px ui-monospace,Menlo,monospace; }
    .panel h3 { margin:0 0 8px; font-size:12px; color:#e08a3c; }
    .panel tr td { padding:1px 6px 1px 0; }
    .ok { color:#5fae6b; } .bad { color:#d9534f; } .dim { color:#5a6472; }
    canvas.wheel { position:fixed; inset:0; width:100%; height:100%; }
  `;
  root.appendChild(style);
  ring = el('div', 'ring'); ring.style.display = 'none';
  hud = el('div', 'hud');
  wheelEl = document.createElement('canvas'); wheelEl.className = 'wheel';
  wheelEl.style.display = 'none';
  root.append(ring, hud, wheelEl);
}
const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };

function paintRing() {
  const target = S.items[S.index];
  if (!target) { ring.style.display = 'none'; return; }
  const r = target.getBoundingClientRect();
  ring.style.display = 'block';
  ring.style.left = (r.left - 3) + 'px'; ring.style.top = (r.top - 3) + 'px';
  ring.style.width = (r.width + 6) + 'px'; ring.style.height = (r.height + 6) + 'px';
}

const HUD_KEYS = [['LS', 'move'], ['A', 'activate'], ['B', 'back'], ['X', 'wheel'],
                  ['Y', 'expand'], ['LB/RB', 'region'], ['LT', 'peek'], ['View', 'doctor']];
function paintHud() {
  const reg = REGIONS[S.region];
  const t = S.items[S.index];
  const name = t ? (t.getAttribute('data-description') || t.innerText || t.tagName)
                   .trim().slice(0, 34) : 'nothing focusable';
  hud.innerHTML = '';
  const r = el('span', 'region'); r.textContent = reg.label.toUpperCase();
  const c = el('span', 'target');
  c.textContent = `${S.items.length ? S.index + 1 : 0}/${S.items.length} · ${name}`;
  hud.append(r, c);
  for (const [b, label] of HUD_KEYS) {
    const s = el('span'); s.innerHTML = `<b>${b}</b>${label}`; hud.append(s);
  }
  const p = el('span', 'dim');
  p.textContent = S.padName ? '🎮' : 'keyboard: WASD JKLI QE UO ` \\';
  hud.append(p);
}

function toast(msg, good) {
  const t = el('div', 'toast');
  t.style.borderColor = good === false ? '#d9534f' : '#5fae6b';
  t.textContent = msg;
  root.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

// ------------------------------------------------------------- navigation
function refreshItems(keepTarget) {
  const reg = REGIONS[S.region];
  const target = keepTarget ? S.items[S.index] : null;
  S.items = $all(reg.items).sort(byPosition);
  if (target) {
    const i = S.items.indexOf(target);
    S.index = i >= 0 ? i : Math.min(S.index, Math.max(0, S.items.length - 1));
  } else {
    S.index = Math.min(S.index, Math.max(0, S.items.length - 1));
  }
}
function move(d) {
  if (!S.items.length) return;
  S.index = (S.index + d + S.items.length) % S.items.length;
  const t = S.items[S.index];
  if (t.scrollIntoView) t.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  rumble('nudge');
}
function cycleRegion(d) {
  for (let k = 0; k < REGIONS.length; k++) {
    S.region = (S.region + d + REGIONS.length) % REGIONS.length;
    refreshItems(false);
    if (S.items.length) break;
  }
  S.index = 0;
  toast(REGIONS[S.region].label);
  rumble('nudge');
}

// Real clicks on real elements: focus first so Galaxy's own keyboard handlers
// and :focus styling behave as if a user tabbed there.
function activate(target) {
  const t = target || S.items[S.index];
  if (!t) { rumble('fail'); return false; }
  if (t.focus) { try { t.focus({ preventScroll: true }); } catch (_) { t.focus(); } }
  t.click();
  rumble('tick');
  return true;
}
function clickTarget(key, label) {
  const t = $one(key);
  if (!t) { toast(`${label || key}: not on this page`, false); rumble('fail'); return false; }
  t.scrollIntoView && t.scrollIntoView({ block: 'nearest' });
  activate(t);
  toast(label || key);
  return true;
}

// ---------------------------------------------------------------- wheels
function wheelFor() {
  const reg = REGIONS[S.region].key;
  if (reg === 'history') return [
    { label: 'Expand', act: () => activate() },
    { label: 'Tags', act: () => clickTarget('addTags', 'add tags') },
    { label: 'Edit attrs', act: () => clickTarget('editDetails', 'edit details') },
    { label: 'Download', act: () => clickTarget('datasetDownload', 'download') },
    { label: 'Job info', act: () => clickTarget('jobInfo', 'job info') },
    { label: 'Hide', act: () => clickTarget('hideOption', 'hide') },
    { label: 'Delete', act: () => clickTarget('deleteOption', 'delete') },
    { label: 'History menu', act: () => clickTarget('historyOptions', 'history options') },
  ];
  if (reg === 'center') return [
    { label: 'RUN', act: () => clickTarget('runTool', 'run tool'), hot: true },
    { label: 'Run workflow', act: () => clickTarget('executeWorkflow', 'execute workflow'), hot: true },
    { label: 'Scroll top', act: () => scrollTo({ top: 0, behavior: 'smooth' }) },
    { label: 'Back', act: () => history.back() },
    { label: 'Forward', act: () => history.forward() },
    { label: '', act: null }, { label: '', act: null }, { label: '', act: null },
  ];
  if (reg === 'tools') return [
    { label: 'Open tool', act: () => activate() },
    { label: 'Search', act: () => { const s = $one('toolSearch'); if (s) { s.focus(); toast('type, then Esc'); } } },
    { label: 'Upload', act: () => clickTarget('upload', 'upload') },
    { label: '', act: null }, { label: '', act: null },
    { label: '', act: null }, { label: '', act: null }, { label: '', act: null },
  ];
  return [
    { label: 'Open', act: () => activate() },
    { label: 'New history', act: () => clickTarget('newHistory', 'new history') },
    { label: 'Switch history', act: () => clickTarget('switchHistory', 'switch history') },
    { label: 'Show hidden', act: () => clickTarget('showHidden', 'show hidden') },
    { label: 'Show deleted', act: () => clickTarget('showDeleted', 'show deleted') },
    { label: '', act: null }, { label: '', act: null }, { label: '', act: null },
  ];
}
function wheelPick(ax) {
  const x = dz(ax.rx), y = dz(ax.ry);
  if (!x && !y) return -1;
  let a = Math.atan2(x, -y) * 180 / Math.PI;
  if (a < 0) a += 360;
  return Math.round(a / 45) % 8;
}
function paintWheel() {
  if (!S.wheel) { wheelEl.style.display = 'none'; return; }
  const w = innerWidth, h = innerHeight, dpr = devicePixelRatio || 1;
  wheelEl.style.display = 'block';
  wheelEl.width = w * dpr; wheelEl.height = h * dpr;
  const c = wheelEl.getContext('2d');
  if (!c) return;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  c.fillStyle = 'rgba(10,12,15,0.55)'; c.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.24, r0 = R * 0.36;
  for (let i = 0; i < 8; i++) {
    const a0 = (i * 45 - 22.5 - 90) * Math.PI / 180, a1 = a0 + Math.PI / 4;
    const sl = S.wheel.slices[i] || { label: '' }, on = i === S.wheel.sel;
    c.beginPath(); c.arc(cx, cy, R, a0, a1); c.arc(cx, cy, r0, a1, a0, true); c.closePath();
    c.fillStyle = !sl.label ? 'rgba(40,45,54,0.5)' : on ? (sl.hot ? '#5fae6b' : '#e08a3c') : '#232933';
    c.fill();
    c.strokeStyle = '#333b47'; c.lineWidth = 1.5; c.stroke();
    const am = (a0 + a1) / 2, lr = (R + r0) / 2;
    c.fillStyle = on ? '#14171c' : (sl.label ? '#c3ccd8' : '#5a6472');
    c.font = `${on ? 700 : 400} 12px ui-monospace, Menlo, monospace`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(sl.label, cx + Math.cos(am) * lr, cy + Math.sin(am) * lr);
  }
  c.fillStyle = '#5a6472'; c.font = '11px ui-monospace, monospace';
  c.textAlign = 'center'; c.fillText('release X', cx, cy);
}

// -------------------------------------------------- job state -> haptics
// Same-origin fetch: Galaxy's session cookie authenticates us, so there is no
// API key to store and nothing to configure.
async function gapi(path) {
  const r = await fetch(path, { credentials: 'same-origin',
                                headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(path + ' -> ' + r.status);
  return r.json();
}
const ACTIVE = new Set(['new', 'queued', 'running', 'waiting', 'paused', 'upload']);
const HAPTIC = { ok: 'done', error: 'fail', failed: 'fail' };

async function pollStates() {
  try {
    if (!S.historyId) {
      const h = await gapi('/api/histories/most_recently_used');
      S.historyId = h && h.id;
    }
    if (!S.historyId) {
      // Galaxy answers anonymous sessions with success and no history rather
      // than a 401, so without this the haptics channel would just be silent.
      if (!S.warnedAnon) { S.warnedAnon = true; toast('not signed in — job haptics off', false); }
      S.pollMs = 60000;
      return;
    }
    const items = await gapi(`/api/histories/${S.historyId}/contents?v=dev&keys=id,hid,name,state`);
    const first = S.states.size === 0;
    let active = false;
    for (const it of items) {
      const was = S.states.get(it.id);
      S.states.set(it.id, it.state);
      if (ACTIVE.has(it.state)) active = true;
      if (first || was === it.state) continue;
      if (was === undefined && ACTIVE.has(it.state)) continue;   // no buzz storm
      const h = HAPTIC[it.state] || 'tick';
      rumble(h);
      if (h !== 'tick') toast(`${it.name || it.hid}: ${it.state}`, it.state === 'ok');
    }
    S.pollMs = active ? 3000 : 30000;
  } catch (e) {
    S.pollMs = Math.min(S.pollMs * 2, 120000);
  }
}

// ----------------------------------------------------------- selector doctor
function toggleDoctor() {
  if (panel) { panel.remove(); panel = null; S.doctor = false; return; }
  S.doctor = true;
  panel = el('div', 'panel');
  const rows = Object.keys(SELECTORS).map((k) => {
    const n = $all(k).length, one = $one(k);
    const hit = SELECTORS[k].find((s) => document.querySelector(s));
    return `<tr><td class="${one ? 'ok' : 'bad'}">${one ? '●' : '○'}</td>
            <td>${k}</td><td class="dim">${n || (one ? 1 : 0)}</td>
            <td class="dim">${hit ? hit.slice(0, 44) : 'no candidate matched'}</td></tr>`;
  }).join('');
  panel.innerHTML = `<h3>selector doctor — ${location.host}</h3>
    <table>${rows}</table>
    <p class="dim">● resolved on this page ○ not present (may be correct: panels
    differ by route). Edit SELECTORS to repair after a Galaxy release.</p>`;
  root.appendChild(panel);
}

function toggleHelp() {
  toast(S.enabled ? 'gamepad paused' : 'gamepad active');
  S.enabled = !S.enabled;
}

// -------------------------------------------------------------------- loop
function update(now) {
  const { btn, ax } = readInput();
  const { down, up } = edges(btn);

  if (down.MENU) { toggleHelp(); return; }
  if (!S.enabled) return;
  if (down.VIEW) toggleDoctor();

  if (down.X) { S.wheel = { slices: wheelFor(), sel: -1 }; }
  if (S.wheel) {
    // Latch: the stick usually recentres a few milliseconds before the button
    // is released, so a neutral stick must keep the last chosen slice rather
    // than cancel it. B cancels explicitly.
    const sel = wheelPick(ax);
    if (sel >= 0 && sel !== S.wheel.sel) { S.wheel.sel = sel; rumble('nudge'); }
    if (down.B) { S.wheel = null; toast('cancelled'); return; }
    if (up.X) {
      const slice = S.wheel.slices[S.wheel.sel];
      S.wheel = null;
      if (slice && slice.act) slice.act();
    }
    return;
  }

  if (down.RB) cycleRegion(1);
  if (down.LB) cycleRegion(-1);

  const v = axisStep('ly', ax.ly, now);
  if (v) move(v);
  const hstep = axisStep('lx', ax.lx, now);
  if (hstep) cycleRegion(hstep);

  if (down.A) activate();
  if (down.Y) activate();                       // expand/collapse is a click too
  if (down.B) {
    if (panel) toggleDoctor();
    else { const esc = document.querySelector('.modal.show .close, [data-description="confirm dialog cancel"]');
           if (esc) esc.click(); else history.back(); }
  }
  if (down.LT) {                                 // peek: expand without leaving
    const t = S.items[S.index];
    if (t) { t.scrollIntoView({ block: 'center' }); activate(t); }
  }
  // RT: precision modifier — reserved; currently slows auto-repeat
  if (btn[B.RT]) { repeat.ly && (repeat.ly.next = now + REPEAT_NEXT * 3); }
}

let rafPending = false;
function frame(now) {
  try {
    update(now);
    if (now - S.lastPoll > S.pollMs) { S.lastPoll = now; pollStates(); }
    refreshItems(true);
    paintRing(); paintHud(); paintWheel();
  } catch (e) {
    if (!window.__ggErrored) { window.__ggErrored = true; console.error('[galaxy-gamepad]', e); }
  }
  requestAnimationFrame(frame);
}

let booted = false;
function boot() {
  // Idempotent: a userscript manager and a late DOMContentLoaded can both
  // reach here, and a second overlay would orphan the first one's elements.
  if (booted) return;
  booted = true;
  buildOverlay();
  refreshItems(false);
  if (!S.items.length) cycleRegion(1);
  paintHud();
  // Galaxy is a SPA: re-resolve on route changes and panel swaps.
  const mo = new MutationObserver(() => { if (!S.wheel) refreshItems(true); });
  mo.observe(document.body, { childList: true, subtree: true });
  requestAnimationFrame(frame);
  toast('Galaxy Gamepad ready — View for selector doctor');
}

if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot, { once: true });
else boot();

window.__galaxyGamepadApi = { S, SELECTORS, REGIONS, $one, $all, refreshItems,
                              wheelFor, pollStates, update, boot };
})();
