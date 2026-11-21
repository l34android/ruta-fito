# Karoo sensors + one-screen Gran Fondo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Live HR/power/cadence/speed and GPS from the Karoo 3 on a one-screen /granfondo page.

**Architecture:** A Kotlin Karoo extension POSTs the latest sensor sample every 15 s to the preview Worker; the Worker keeps the latest sample, feeds its position to `updateRace`, and exposes `sensors` in `/api/granfondo`. The page is rebuilt as a full-screen map with a top panel, sensor row and a 3-tab bar.

**Tech Stack:** Kotlin + karoo-ext `lib` (source include), Gradle in GitHub Actions; Cloudflare Worker (JS, node:test); vanilla HTML/CSS/JS + Leaflet.

**Spec:** `docs/superpowers/specs/2026-11-21-karoo-granfondo-design.md`

## Global Constraints
- Key: `X-Ruta-Key` = sha256("ruta-fito-karoo:" + TG token), hex; derived in CI only; never committed.
- Send interval 15 s; `waitForConnection=false`; send only while RideState Recording or Paused.
- Sensor value older than 60 s → null. Karoo position preferred while < 2 min old.
- Durable write of telemetry at most every 30 s.
- Weights 400/500/600; sizes 12 (meta only)/14/16/20/32; AAA contrast; targets ≥ 48 px; `100dvh`, no page scroll.
- Icons (Tabler outline): heart, bolt, rotate-clockwise, gauge.

## Review Focus
- Telemetry arrives before the start (at the hotel): no position shown, as with Telegram.
- Karoo and Telegram both reporting: Telegram ignored for the race while Karoo < 2 min old.
- No power meter paired (power null): power shows "—", others still shown.
- Missing or wrong key: 401, nothing stored.
- Short screen (375×667): whole map tab visible without page scroll.

---

### Task 1: Worker telemetry ingest

**Files:** Modify `worker/src/preview-core.js`; Test `worker/test/preview.test.js`; Modify `scripts/cf-setup.mjs` / `.github/workflows/preview.yml` (secret `KAROO_KEY`).

**Interfaces:**
- Produces: `POST /api/telemetry` body `{ts, lat, lon, hr, power, cadence, speedKmh, state}` → `200 {ok:true}` | `401`; `/api/granfondo` gains `sensors: {hr, power, cadence, speedKmh, ageSec} | null`; `/karoo` bot command replies `${PUBLIC_URL}/karoo/${KAROO_KEY.slice(0,16)}.apk`.

- [ ] Tests: `telemetry rejects wrong key` (401, `sensors` null after); `telemetry feeds race on race day and hides position before start`; `Telegram location ignored while Karoo fresh`; `sensor older than 60 s is null`; `null power stays null`.
- [ ] Run `node --test worker/test/*.test.js` → new tests FAIL.
- [ ] Implement in `preview-core.js`; memory copy `pmem.tele`, durable `tele` key throttled 30 s; race update via existing `updateRace`.
- [ ] Tests PASS; commit.

### Task 2: Karoo extension + CI build

**Files:** Create `karoo/settings.gradle.kts`, `karoo/build.gradle.kts`, `karoo/app/build.gradle.kts`, `karoo/app/src/main/AndroidManifest.xml`, `karoo/app/src/main/res/xml/extension_info.xml`, `karoo/app/src/main/kotlin/ar/rutafito/karoo/RutaExtension.kt`; Modify `.github/workflows/preview.yml`.

**Interfaces:** Consumes Task 1 endpoint. BuildConfig fields `INGEST_URL`, `INGEST_KEY`.

- [ ] CI: setup-java 17, clone hammerheadnav/karoo-ext into `karoo/karoo-ext`, include `:lib`, `assembleRelease` signed with a debug-style keystore generated in CI, copy APK to `dist/preview/karoo/<key16>.apk` before Worker deploy.
- [ ] `RutaExtension : KarooExtension("ruta-fito", "1")`: connect `KarooSystemService`, consume `OnStreamState` for HEART_RATE, SMOOTHED_3S_AVERAGE_POWER, CADENCE, SPEED, LOCATION and `RideState`; 15 s ticker posts JSON via `OnHttpResponse.MakeHttpRequest`.
- [ ] Verify: workflow log shows APK built and `/karoo/<key16>.apk` returns 200 (diag branch).
- [ ] Commit.

### Task 3: One-screen page

**Files:** Rewrite `preview/granfondo/index.html`, `style.css`, `app.js`.

**Interfaces:** Consumes `/api/granfondo` `sensors`, `race.json`, `/api/chat`.

- [ ] Shell: map full-screen; top panel (km/total, progress, ETA, status); sensor row (heart ppm, bolt W, rotate rpm, gauge km/h, "—" + muted when null); tab bar Mapa/Perfil/Aliento (`role=tablist`, ≥ 48 px).
- [ ] Perfil tab: elevation SVG sized to its container + current/next climb. Aliento tab: feed scrolls inside, composer pinned.
- [ ] Verify with headless Chrome mock at 375×667, 375×812, 1280×800: `scrollHeight == innerHeight`, no console errors; screenshots reviewed.
- [ ] Commit, push, deploy check via diag.
