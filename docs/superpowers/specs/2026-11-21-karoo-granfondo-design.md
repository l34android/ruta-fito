# Gran Fondo: Karoo live sensors + one-screen view

## Intent
Followers of Lean in the Gran Fondo 7 Lagos (Sun 2026-11-22) see in one glance where he is and how hard he is pushing: raw heart rate, power and cadence, each with an icon. The current /granfondo page scrolls and looks templated; it becomes a one-screen view like the trip's "nueva" view.

## Goals / non-goals / anti-goals
- Goals: HR, power (3 s), cadence and speed from the Karoo on the page with ≤ 30 s delay; Karoo GPS as the position source; one screen, no page scroll, bottom tab bar Mapa / Perfil / Aliento.
- Non-goals: history charts, zones, Garmin data (stays as an optional link), store publication of the extension.
- Anti-goals: anything that makes the Karoo recording less reliable; showing position before the start (hotel stays hidden); secrets in the public repo.

## Approaches
- **A (picked by Lean): own Karoo extension** using hammerheadnav/karoo-ext; sends latest values every 15 s via MakeHttpRequest (Wi-Fi or Bluetooth through the Hammerhead Companion app).
- B: only Garmin/Karoo tracking links — no build, but data lives outside our page and power/cadence are missing.
- C: Web Bluetooth from the phone — Android-only, sensor connection limits, screen must stay on. Rejected.

## Design
**Extension (Android, Kotlin, `karoo/`)**
- Built in CI by cloning karoo-ext and including its `lib` module (no package-registry auth).
- `KarooExtension` service; subscribes to HEART_RATE, SMOOTHED_3S_AVERAGE_POWER, CADENCE, SPEED, LOCATION and RideState.
- Only while RideState is Recording or Paused: every 15 s, POST JSON `{ts, lat, lon, hr, power, cadence, speedKmh, state}` to `/api/telemetry` with `waitForConnection=false` (stale data is dropped, never queued).
- Header `X-Ruta-Key`: sha256("ruta-fito-karoo:" + TG token), derived in CI and injected as BuildConfig; also set as a Worker secret. Never committed.
- APK served by the preview Worker at a path derived from the same key; the bot command `/karoo` replies with that link (owner only). Installed by sharing the link to the Hammerhead Companion app.

**Worker**
- `POST /api/telemetry`: checks key; stores latest under `tele` (in memory always, durable write at most every 30 s). On race day its location goes through `updateRace` exactly like a Telegram location; while Karoo data is < 2 min old, Telegram locations are ignored for the race.
- `/api/granfondo` adds `sensors: {hr, power, cadence, speedKmh, ageSec}`; values older than 60 s are returned as null.

**Page (/granfondo), pattern: Dashboard / Overview; the Aliento tab is an Activity Feed**
- Full-screen satellite map with course, climbs and rider.
- Top panel: km / total, progress, ETA, live status.
- Sensor row: heart (ppm), bolt (W), rotate (rpm), gauge (km/h); stale → "—" with muted icon.
- Perfil tab: elevation with current/next climb. Aliento tab: chat, composer pinned.
- Bottom tab bar, 3 items, ≥ 48 px. Height `100dvh`, no page scroll.
- Type: weights 400/500/600; sizes 12 (meta only) / 14 / 16 / 20 / 32; tabular numbers. AAA contrast, focus rings, reduced motion. Remove eyebrow caps, gradient bar and glow; one surface level for panels.

## Constraints
- Race is tomorrow 08:00: Lean must install and test the APK today with a short recorded ride.
- Fallbacks if the extension fails: Telegram live location + Garmin link (already working).

## Left to the builder
Exact icon choice for cadence, panel spacing, map zoom behavior.
