# Galaxy on a Gamepad — design sketch

**Target instance:** `https://galaxy-main.usegalaxy.org/` (Galaxy Main, the public US server)
**Status:** concept + architecture only. Nothing built, nothing prototyped.

> **Historical note.** This is the original design sketch. Its recommendation —
> a local companion web app with its own interface (Option C) — was **reversed**:
> the shipped tool is Option A, a content script that drives the real
> usegalaxy.org page, requiring no local service and no API key. Sections 1-3
> (the interaction model, the text problem, haptics as an output channel) carried
> over unchanged; section 4's architecture choice did not. See the root README
> for what was actually built.



---

## 1. The idea in one paragraph

Galaxy is a web application designed around a mouse: a three-pane layout, a searchable
tool panel of several thousand tools, and HTML forms generated from each tool's XML
definition. A gamepad has roughly seventeen buttons, two analog sticks, two analog
triggers, and a vibration motor. The naive mapping — stick moves a mouse cursor, A
clicks — produces something strictly worse than a mouse, and that is the failure mode
to avoid. The interesting design treats the gamepad the way a console game does: a
small, fixed vocabulary of inputs whose *meaning changes with context*, with radial
menus instead of lists, ranked and filtered candidates instead of free-text search, and
the vibration motor repurposed as an **output** channel for job state. The pad does not
drive Galaxy's DOM; it drives Galaxy's REST API through a purpose-built, controller-native
front end, with a deep link back into the real web UI for anything the pad is bad at.

![Controller map and system architecture]({{artifact:art_1c5f0fc6-8b31-4211-8f3d-fe29f4beffd9}})

---

## 2. Why this is worth doing (three honest reasons)

1. **Accessibility.** This is the strongest justification and it should drive the
   design, not be bolted on. Users with limited fine motor control, tremor, or RSI
   often already own an adaptive controller (Xbox Adaptive Controller, Logitech
   Adaptive Gaming Kit, one-handed pads). Galaxy's web UI demands sustained precise
   pointing over small targets; a gamepad front end demands none. If the binding layer
   is fully remappable and no action requires a chord or a timed double-tap, the same
   interface serves switch-access and sip-and-puff hardware too.
2. **Monitoring ergonomics.** Most of the wall-clock time in a Galaxy analysis is spent
   waiting on jobs and triaging the ones that failed. That is a low-bandwidth,
   high-frequency task — exactly what a pad plus haptics is good at, and exactly what a
   browser tab is bad at. "Buzz when the invocation finishes, buzz differently when a
   step errors, hold LT to read the stderr" is a genuinely better interaction than
   refreshing a history panel.
3. **Workflow execution as a controller-shaped task.** A saved Galaxy workflow reduces
   an analysis to: choose the workflow, bind each input to a dataset or collection,
   press start. That is a character-select screen. The gamepad is weak at *authoring*
   and strong at *executing* — so the scope rule below falls out naturally.

What this is *not*: a replacement for the Galaxy UI, and not a way to build workflows.

---

## 3. The scope rule

> **Author in the browser. Operate on the pad.**

| On the pad (first class) | In the browser (deep-link escape hatch) |
|---|---|
| Browse / switch / create histories | Workflow editor (graph authoring) |
| Inspect, tag, rename, hide, delete datasets | Data upload from local disk |
| Peek dataset head, metadata, stderr/stdout | Interactive tools (Jupyter, RStudio, IGV) |
| Pick a tool by *what it accepts*, set its parameters, run it | Visualisations (Trackster, charts) |
| Build list and paired collections | Tool forms with pathological nesting |
| Invoke a saved workflow, bind inputs, monitor, rerun failed steps | Account / preferences / quota |
| Triage job failures; cancel, rerun, rerun-with-changes | Sharing and publishing |

Any pad screen that reaches its limit offers a single binding (e.g. `Menu → Open in
browser`) that opens the corresponding Galaxy URL — ideally the exact tool form with
state pre-filled — in a second tab. Designing the escape hatch in from day one is what
keeps the pad UI from having to be complete.

---

## 4. Architecture

Three plausible routes; the third is the recommendation.

**Option A — browser extension / userscript on usegalaxy.org.**
Poll the W3C Gamepad API inside the real Galaxy page, draw a HUD overlay, and synthesise
clicks and focus changes on Galaxy's Vue components.
*For:* works inside the actual site, inherits the login session, nothing to install
beyond the extension, every feature of Galaxy is reachable in principle.
*Against:* it is DOM-coupled to a UI that changes every release; synthetic events on a
reactive framework are fragile; you inherit the mouse-shaped information architecture
you were trying to escape. Good demo, bad foundation.

**Option B — standalone native client.**
A desktop or TUI app talking to the REST API, with native controller input (SDL2 / hidapi).
*For:* full control of the interaction model, real rumble and LED access, works
offline-ish with a cache.
*Against:* heavier to build and distribute; you still need a browser for visualisations,
so the user ends up in two worlds anyway.

**Option C — local companion web app + thin local service (recommended).**
A single page served from `localhost`, opened in the user's ordinary browser. The page
gets gamepad input free via the Gamepad API (no drivers, no permissions prompt, works
with any XInput-class pad and with adaptive controllers that present as one). Behind it,
a small local service (FastAPI + BioBlend, or Node) holds the Galaxy API key, relays
requests to `usegalaxy.org`, caches tool definitions, and runs the job poller.
*For:* fastest path to a usable thing; no CORS problem, because the page talks to
`localhost` and the local service talks to Galaxy server-to-server; the API key never
touches page JavaScript or `localStorage`; the browser is already there for the escape
hatch; one codebase runs on every OS.
*Against:* requires a local process (one `pipx run` / one binary); browser Gamepad API
throttles or stops polling in a background tab, which matters for the monitor HUD —
mitigated by having the *service*, not the page, own job polling and haptics triggering
via a persistent WebSocket.

**Data flow.** Pad → page (input) → WebSocket → local service → Galaxy REST API; and
Galaxy job states → service poller → WebSocket → page → `gamepad.vibrationActuator`
(and DualSense LED where available).

---

## 5. Interaction model

The core design problem: Galaxy's state space is enormous and the input device has
~20 discrete signals. Four mechanisms close that gap.

### 5.1 Modes (workspaces)

Six contexts, cycled with LB/RB, each with its own meaning for the face buttons and its
own action wheel:

`History` · `Datasets` · `Tools` · `Workflows` · `Jobs` · `Collections`

Only one is on screen at a time. A persistent HUD strip shows the current mode and the
live meaning of every button — like a fighting game's move list, always visible, never
needing to be remembered. (`View` expands it to a full legend.)

### 5.2 Radial menus, not lists

Hold or flick the right stick to pop an eight-slice wheel; release to commit. Radial
selection is a single gesture with no dwell time and builds muscle memory in a way that
scrolling a list never does. Eight slices per wheel, nested at most two deep (64 reachable
actions, which comfortably covers every verb in §3). Slice contents are **context- and
rank-ordered**, never alphabetical: the slice at 12 o'clock is the action you take most
often here.

### 5.3 Analog where Galaxy has continuous values

The left stick and triggers give what a mouse gives badly: proportional control.
- Numeric tool parameters (quality thresholds, k-mer size, p-value cutoffs) are scrubbed
  with the left stick, step size scaled by how far the stick is pushed, with RT held for
  fine steps and the D-pad for ±1.
- Long histories and long log files scroll with velocity proportional to deflection.
- A paired-collection builder uses left stick for forward reads and right stick for
  reverse — arguably more pleasant than Galaxy's existing pairing dialog.

### 5.4 The text problem (the hardest part)

Typing is a gamepad's worst skill, and Galaxy asks for text constantly: tool search,
dataset names, parameter strings. Three layers, in order of preference:

1. **Design text out.** The decisive trick: *select a dataset, press X, and the wheel
   shows tools that accept that datatype*, ranked by the user's own usage history and
   by global popularity. Galaxy knows each dataset's datatype and each tool's accepted
   input formats, so compatible-tool discovery is a server-side join, not a search box.
   Plus: favourites, recently used, "rerun this job", and the tool panel's own section
   hierarchy as a nested wheel. Most real sessions never need to type a tool name.
2. **Constrained entry.** Numbers via stick/D-pad scrub. Enumerations and booleans via
   wheel. Dataset names via "rename from a template" (`{tool} on {input}` patterns).
3. **On-screen keyboard, last resort.** A dual-stick keyboard (the Steam Deck idiom: left
   stick picks a key cluster, right stick picks the key, triggers commit) with predictive
   completion against the live tool list. Setup-time text — the API key, mainly — is typed
   once on a real keyboard and never again.

### 5.5 Haptics and light as an output channel

This is the part with no desktop equivalent and it should be a first-class feature:

| Event | Signal |
|---|---|
| Tool/job queued | single short tick |
| Job running | slow LED pulse (amber) |
| Job finished OK | double pulse, LED green |
| Job failed | long low rumble, LED red |
| Workflow invocation complete | ascending triple pulse |
| Input needed / paused step | repeating soft tick until acknowledged |

With the pad in your lap you get ambient awareness of a running analysis without looking
at anything. Every signal is individually disableable (and must be — haptics are a
sensory-sensitivity issue for some users).

### 5.6 Proposed default bindings

| Control | Meaning |
|---|---|
| Left stick | move focus within pane; scrub the focused numeric parameter |
| Right stick | radial menu: flick to a slice, release to commit |
| D-pad | discrete step (±1 item, ±1 parameter unit); up/down switches workspace |
| A | confirm / activate / run |
| B | back / cancel (never destructive) |
| X | open the context action wheel |
| Y | inspect: metadata, provenance, tool parameters used |
| LB / RB | previous / next workspace |
| LT (hold) | peek — dataset head, job stderr, workflow preview; release to dismiss |
| RT (hold) | precision modifier: fine steps, advanced/hidden parameters |
| Menu | command palette + on-screen keyboard |
| View | HUD legend / help overlay |
| Stick click (L) | multi-select toggle |
| Stick click (R) | mark favourite |

Everything remappable; profiles saved per user; a left-handed and a one-handed preset
shipped by default.

---

## 6. Galaxy API surface this needs

All of it is standard REST, authenticated with the user's API key from
*User → Preferences → Manage API Key*. BioBlend wraps the whole surface in Python, which
is the obvious implementation choice for the companion service.

| Capability | Endpoint / BioBlend call | Controller idiom |
|---|---|---|
| List / switch / create histories | `GET,POST /api/histories` | wheel of recent histories |
| List datasets in history | `GET /api/histories/{id}/contents` | scrollable focus list |
| Peek dataset | `GET /api/datasets/{id}/display?preview=true` | LT hold |
| Dataset metadata / provenance | `GET /api/datasets/{id}` , `/provenance` | Y |
| Tool panel hierarchy | `GET /api/tools?in_panel=true` | nested wheel |
| Tools compatible with a datatype | tool input format metadata, joined locally | X on a dataset |
| Tool parameter model | `GET /api/tools/{id}/build` | generic form renderer |
| Run a tool | `POST /api/tools` | A on the filled form |
| List / show workflows | `GET /api/workflows`, `/api/workflows/{id}` | wheel + input list |
| Invoke a workflow | `POST /api/workflows/{id}/invocations` with a datamap `{step: {src:'hda', id:…}}` | bind inputs, press A |
| Invocation + step state | `GET /api/invocations/{id}` | monitor HUD |
| Job state, stdout/stderr | `GET /api/jobs/{id}`, `?full=true` | jobs workspace |
| Cancel / rerun | `DELETE /api/jobs/{id}`, `POST /api/tools` with prior state | wheel actions |
| Build collections | `POST /api/dataset_collections` | dual-stick pairing |

**The generic tool-form renderer is the central piece of engineering.** `/api/tools/{id}/build`
returns a typed parameter tree; each type gets one controller idiom:

- `boolean` → A toggles
- `select` → wheel (≤8 options) or focus list
- `integer` / `float` → stick scrub, trigger-modified step, bounded by the tool's own min/max
- `text` → on-screen keyboard (flagged as a friction point in telemetry)
- `data` / `data_collection` → pick from current history, LT to peek before committing
- `conditional` → the governing select is a wheel; its branch swaps the sub-form
- `repeat` → LB/RB add/remove instances
- `section` → collapsed by default, revealed by RT

Tools whose forms can't be rendered sensibly get the "open in browser" fallback rather
than a bad approximation. Expect that to be a minority tail, and measure it.

---

## 7. Risks and open questions

- **Public-server etiquette.** Galaxy Main is a free shared resource and the Galaxy
  project does run and tune rate limiting on it. A controller UI invites rapid,
  twitchy interaction, so the service must coalesce requests, cache tool definitions
  aggressively (they change only on server upgrade), poll job state on a backoff
  schedule (e.g. 2 s → 30 s as a job ages) rather than per frame, and never poll from
  the page itself. Budget: well under 1 request/second steady-state per user. Worth an
  early note to the Galaxy community about the project's intent.
- **API key handling.** Keep it in the local service only (OS keychain where available),
  never in page JS, never in an artifact, never logged. Treat it as a full-account
  credential, because it is.
- **Tool-form generality.** Some tool XMLs are genuinely baroque. The renderer needs a
  "can I render this?" predicate and an honest fallback, not a best-effort guess that
  silently drops a parameter.
- **Browser Gamepad API constraints.** Events require a prior user gesture on the page,
  and a backgrounded tab may stop polling. Mitigation: service-owned polling and
  notifications; a reconnect banner; optionally an installable PWA.
- **Latency.** Public-server round trips are tens to hundreds of milliseconds. A
  controller UI feels broken at that latency if it waits for the server, so: optimistic
  local state, a prefetched tool cache, and an explicit "pending" glyph on anything
  not yet acknowledged.
- **Does anyone want this besides the author?** Honest risk. Mitigated by the
  accessibility framing — which is where to look for the first real users, and which
  should shape the milestone ordering below.
- **Open question:** single-user local tool, or a hosted mode where the pad page is
  served from a URL and the key stays in the browser? Local-first is safer; hosted is
  far easier to hand to a collaborator. Decide before Phase 2.
- **Open question:** does this belong eventually as a Galaxy community project
  (an accessibility front end) rather than a personal tool? That changes the
  architecture toward Option A/B and toward upstream contribution.

---

## 8. Phased build plan

Each phase ends with a stop/go question, and each is independently useful.

**Phase 0 — Feasibility spike (read-only).**
Companion service + pad page. Connect a controller, browse histories and datasets, peek
contents, watch job state, feel the rumble when a job finishes. No mutation of anything.
*Stop/go: does the mode + radial model feel better than a mouse for monitoring, or merely
different?*

**Phase 1 — Workflow runner.**
Pick a saved workflow, bind inputs from the current history, invoke, monitor the
invocation step-by-step, rerun failed steps. This is the smallest genuinely useful
product and it exercises the full API path with almost no text entry.
*Stop/go: can a real analysis be launched end-to-end without touching the keyboard?*

**Phase 2 — Generic tool runner.**
`/api/tools/{id}/build` renderer for the common parameter types; datatype-driven tool
discovery; dataset operations (tag, rename, hide, delete); on-screen keyboard.
*Stop/go: what fraction of the user's actual tool usage renders cleanly? Measure it.*

**Phase 3 — Collections and multi-history work.**
List/paired collection building, cross-history dataset copy, batch operations with
multi-select.

**Phase 4 — Accessibility hardening and release.**
Full remapping UI, one-handed and switch-access presets, no-chord guarantee, configurable
dead zones and hold-vs-toggle modifiers, haptics opt-out, screen-reader-compatible HUD
text, high-contrast theme. Test with adaptive-controller users. Then publish.

An optional **Phase 5** revisits Option A: an in-page overlay for usegalaxy.org that
reuses the same binding layer, for the parts of Galaxy the pad UI never covers.

---

## 9. How to tell if it worked

Define a fixed benchmark task set up front and measure both input modes on it:

1. Run FastQC on three datasets and read the per-base quality verdict.
2. Invoke a saved RNA-seq workflow on a paired collection and report when it finishes.
3. Find the one failed step in a 12-step invocation and read its stderr.
4. Build a paired collection from 20 FASTQ files.

Metrics: time to completion, discrete input events required, error/undo rate, and
unassisted completion rate for participants using adaptive hardware. The accessibility
metric is the one that decides whether the project is a toy.

---

## 10. Smallest next step

Phase 0, narrowed further: a read-only **job monitor with haptics** — list the current
history, poll invocation and job states, vibrate on transitions. It touches the API,
the pad, and the service loop, needs no tool-form renderer and no text entry, and it
answers the only question that matters early: *is a controller a pleasant way to be
connected to a running analysis?*
