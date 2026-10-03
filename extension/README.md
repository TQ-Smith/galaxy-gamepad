# Galaxy Gamepad

A controller layer **inside** the real Galaxy web interface at
<https://usegalaxy.org/>. It does not replace any part of the UI: it moves
focus over the elements Galaxy already renders, clicks them, and reads job
state from Galaxy's own API using the session you are already logged into.

No API key. No local server. No account configuration. One file.

## Install

**As a userscript** (simplest) — install Tampermonkey or Violentmonkey, then
create a new script and paste `galaxy-gamepad.user.js`. The `@match` lines
already cover `usegalaxy.org` and `galaxy-main.usegalaxy.org`.

**As an unpacked Chrome/Edge extension** — `chrome://extensions` → enable
Developer mode → *Load unpacked* → select this `extension/` folder.

Then open Galaxy and **press any button on the controller**. Browsers deliver
no gamepad input until the page has seen a gesture, so nothing happens before
that first press (a click on the page works too).

No controller to hand? Every binding has a keyboard equivalent, so the whole
thing is testable without hardware.

## Bindings

| Pad | Keyboard | Action |
|---|---|---|
| Left stick ▲▼ / D-pad | `W` `S` | move focus within the current region |
| Left stick ◀▶ | `A` `D` | previous / next region |
| LB / RB | `Q` / `E` | previous / next region |
| A | `J` | activate — a real click on the focused element |
| B | `K` | back: close a dialog, dismiss the doctor, else browser back |
| X (hold) | `L` | open the region's radial menu; release on a slice to run it |
| Y | `I` | expand / inspect the focused item |
| Right stick | arrow keys | choose a radial slice |
| LT (hold) | `U` | peek: scroll the focused item into view and expand it |
| RT | `O` | precision modifier — slows auto-repeat |
| View | `` ` `` | selector doctor (see below) |
| Menu | `\` | pause / resume the pad |
| — | `Esc` | leave a Galaxy text field and give the pad control back |

While the caret is in a Galaxy input or textarea the pad layer ignores the
keyboard entirely, so typing a tool parameter works normally. `Esc` hands
control back.

### Regions

`LB`/`RB` cycle the four parts of the Galaxy page. Regions with nothing
focusable on the current route are skipped automatically.

| Region | What it navigates |
|---|---|
| History | dataset items in the current history (`[data-hid]`) |
| Center | inputs, selects and buttons of the tool form or workflow run form |
| Tools | the tool panel's search box and tool links |
| Activity | the left activity bar |

### Radial menus

Hold `X` and flick the right stick. Slice 0 is at 12 o'clock and is the action
you take most often in that region. The selection **latches** — releasing the
stick before the button keeps your choice, as a weapon wheel does. `B` cancels.

| Region | Slices (clockwise from 12) |
|---|---|
| History | Expand · Tags · Edit attrs · Download · Job info · Hide · Delete · History menu |
| Center | **RUN** · Run workflow · Scroll top · Back · Forward |
| Tools | Open tool · Search · Upload |
| Activity | Open · New history · Switch history · Show hidden · Show deleted |

### Haptics

Job state is polled from `/api/histories/{id}/contents` on your own session —
every 3 s while anything is active, every 30 s when the history is idle,
backing off to 120 s on error.

| Event | Pattern |
|---|---|
| state change | single 60 ms tick |
| job finished OK | double pulse |
| job failed | 430 ms low buzz |
| focus / slice change | 25 ms nudge |

The first poll after load establishes a baseline silently, so opening Galaxy
with a finished history does not fire a volley of buzzes. If you are not
signed in, Galaxy answers with success and no history rather than an error —
the pad says `not signed in — job haptics off` once instead of going quietly
dead.

## When a Galaxy release breaks it

This is the real risk of operating a page from the outside, so it is built to
be diagnosed and repaired in one place.

Every target is addressed through the `SELECTORS` table at the top of the
file, and each entry is a list of candidates tried in order. Press **View**
(`` ` ``) to open the **selector doctor**: it lists every logical target, marks
the ones that resolved on the page in front of you, and prints the candidate
that matched. A target showing `○` is not necessarily broken — panels differ
by route — but a target that is `○` on the page where it should exist tells
you exactly which line to edit.

The selectors use Galaxy's `data-description` attributes rather than CSS
classes or DOM paths. Those attributes exist to be addressed from outside the
client; the live `analysis.bundled.js` on Galaxy Main (version 26.1) defines
249 distinct values, including `run tool button`, `execute workflow button`,
`history options`, `dataset download`, `hide option` and `job information
modal`. They are the most stable handles the page offers.

## What has been verified

`node tests/test_userscript.mjs` (from the repository root, after
`npm install`) runs the script in jsdom against a synthetic Galaxy DOM built
from those same attributes — 16 assertions covering overlay injection, focus
navigation, real click dispatch, radial routing to the right
`data-description` target, the typing guard, the pause toggle, the selector
doctor, and the job-state → haptics path including baseline suppression, the
back-off, and the signed-out case.

Not verified: behaviour against the live Galaxy page. jsdom has no layout
engine, so the geometric focus ordering is exercised against synthesised
rectangles, and the selector pack has been checked against the shipped client
bundle rather than a rendered page. Expect to open the selector doctor on
first run and fix two or three entries — that workflow is the point of it.

## Known gaps

- Text entry is Galaxy's own: focus a field with the pad, then type. A
  controller-driven on-screen keyboard is not implemented.
- `RT` is reserved as a precision modifier but currently only slows
  auto-repeat.
- No binding remapping UI yet; edit `KEYMAP` and the `B` index table.
- Haptics need `GamepadHapticActuator.playEffect('dual-rumble')`: present in
  Chrome and Edge, partial in Firefox, absent in Safari. Everything else
  degrades to visual-only.
