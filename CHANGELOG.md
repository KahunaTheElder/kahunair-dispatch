# Changelog

All notable changes to KahunaAir Dispatch are documented here.

---

## [0.2.2] - 2026-03-14  *(Test Flight 2 — EDXW → ESNO)*

### Fixed — Status Indicators
- **OA indicator** no longer shows green from backend health check alone; goes green only when `/api/flights/active` returns an active flight, amber while waiting
- **SI indicator** now performs a staleness check on `flight.json` — if the file is >5 minutes old the indicator shows amber instead of green (fixes false-green from previous session)
- **Status dot tooltips** added: hovering any indicator (BE/OA/SI/SC/SB) shows full name and current state

### Fixed — SimBrief OFP Display
- **Departure/Arrival airports** now populated from SimBrief OFP immediately on load; previously showed `---- / ----` until OnAir found the active flight
- **RFL display** fixed: `initial_altitude` fallback (feet) now divided by 100 before display; previously showed `FL29000` instead of `FL290`

### Fixed — SimConnect
- **SC reconnects indefinitely** until MSFS is running — previously gave up after 10 attempts (~20s); now retries with exponential backoff up to 30s, forever

### Fixed — Crew Display
- **Crew editor name/hours/role** now resolve correctly — lookup was matching on flight `id` instead of stable `peopleId`; new crew appeared as nameless "New Hire"
- **Company passengers** now shown below FA section with a divider; display name + "Company Passenger" label only — no stats, no edit button
- **Collapsed crew summary** follows Capt → FO → FA → PAX order with `PAX:` prefix for company passengers

### Fixed — Telemetry PAX Count
- PAX count now derived as `round(totalPaxWeight / 170)` — replaces unstable GCD approach which produced wildly wrong counts during MSFS boarding animation

### Added — Taxi Route with Runway Hold Short Detection *(post-TF2, commits 3bc0615–e8764d6)*
- **SimConnect Facility API** integration (`src/taxiGraphService.js`): fetches TAXI_POINT, TAXI_PATH, TAXI_NAME for each departure/arrival airport and caches result for the session
- **Taxi display**: resolves SI `current_flight.taxi_path` waypoints to human-readable taxiway sequence (e.g. `A → B → C`)
- **HOLD SHORT injection**: TAXI_PATH edges with `TYPE=1` (runway surface) emit `HOLD SHORT` in the route sequence instead of being silently dropped
- **Snap threshold**: SI waypoints matched to nearest TAXI_POINT within 75 m (increased from 50 m after TF2 ESNO diagnosis showed nearest point at 54.5 m)
- **Buffer fix**: `IS_RUNWAY` / `RUNWAY_NUMBER_0` / `RUNWAY_DESIGNATOR_0` are not valid SimConnect TAXI_PATH field names — they caused a 40-byte buffer overflow on every path, producing 0 cached paths. Replaced with `TYPE` (valid, 4th INT32 in the struct)
- **Sandwich-interloper collapse**: route post-processing strips `X A X → X` interlopers but now exempts `HOLD SHORT` tokens from collapse
- **Taxi graph diagnostic endpoint**: `GET /api/taxi/graph/:icao` returns `{ pts, paths, names, nameList }` for any ICAO — triggers a background fetch if not yet cached; useful for pre-flight inspection

### Diagnosed — ESNO taxi result
- ESNO (TF2 arrival): 113 pts, 133 paths, **3 named taxiways** (A, B, C) — taxi display returns `RCVD` because departure taxi path has no runway crossing in SI's data for that route
- LEBG (TF3 destination): pre-fetched via diagnostic endpoint — 113 pts, 133 paths, **3 named taxiways** (A, B, C) — confirmed good test candidate for HOLD SHORT

---

## [0.2.1] - 2026-03-12

### Added — VA Profile Editor (7-section form)

- **VA Profile modal** (`frontend/src/components/VAProfileEditor.jsx`) replaces the old single-textarea form with seven structured sections matching SI `importVAData` best practices:
  1. Airline Basics (name, tagline)
  2. Safety & Compliance
  3. Crew Greeting / Announcement Style
  4. Cabin Tone & Service Philosophy
  5. Signature Amenities
  6. Traditions & Quirks
  7. Company Policies / Dispatcher Notes
- `callsign` field removed — callsign is obtained from the SimBrief OFP, not from the VA profile.
- `vaProfileManager.js` schema updated; `siPayloadBuilder.js` now wires all new fields into the SI `crew_data` and `dispatcher_data` sections.

### Added — VA Profile discoverability

- Settings modal footer now shows **🏢 Edit VA Profile** underline link.
- Clicking the link closes Settings and opens the VA Profile editor, so the feature is discoverable without knowing about the top-bar 🏢 icon.

### Added — Live SI Procedure Change Detection

- New `GET /api/si/procedures` endpoint reads `current_flight` from `flight.json` (SayIntentions) every 15 seconds when SI is running.
- Returns: `depRwy`, `sid`, `star`, `arrRwy`, `approach`, `gate`, `taxiPath`.
- SimBrief OFP values are captured once as a baseline when the OFP loads (`ofpProceduresRef`).
- In the flight data bar:
  - Fields that differ from the OFP baseline render in **amber** with a `↑` indicator and a hover tooltip showing the original value.
  - Approach (no OFP equivalent) renders in **blue** when assigned.
  - Gate and taxi path render in **green** below the procedures line when populated.

### Added — Window Position Persistence

- `main.js` now saves and restores window bounds (`x`, `y`, `width`, `height`) across restarts.
- State persisted to `%APPDATA%\KahunaAir Dispatch\window-state.json` via `app.getPath('userData')`.
- Save is skipped when the window is maximized or minimized (restores correctly on next launch).

### Added — Taxi & Gate Display

- When SI assigns parking and taxi instructions, a green row appears in the flight data bar between the procedures line and the route:  `GATE A3 | TAXI A B C`
- Source fields: `current_flight.assigned_gate` and `current_flight.taxi_path` in `flight.json`.

---

## [0.2.0] - 2026-03-11

### Fixed — Cargo & Charter Matching (critical)

- **Wrong matching strategy removed.** The previous implementation used `MissionId` to link jobs to flights. `MissionId` is the ID of the containing *Mission*, not the *Flight* — all items in a mission share the same `MissionId`, making it useless for matching. Also removed broken route-matching fallback where `cargo.DepartureAirport` reflected the mission origin, not the current leg departure.
- **Correct strategy:** `cargo.CurrentAircraftId === flight.AircraftId` — every in-progress cargo/charter item carries the ID of the aircraft currently transporting it. This is 100% reliable.
- **Wrong flight endpoint removed.** `getCurrentActiveFlight()` was calling `/company/{id}/current` which does not exist (returns 404 HTML). Replaced with filter over `/company/{id}/flights`: `StartTime && !EndTime`.
- **Wrong payload field names fixed.** `flight.Passengers` and `flight.Cargo` are legacy fields, always 0. Correct fields are `flight.PAXCount` and `flight.CargosTotalWeight`.
- **Aircraft type display fixed.** Was using `Aircraft.AircraftType.Name`; correct field is `Aircraft.AircraftType.DisplayName`.
- **UTF-8 BOM bug fixed in `credentialsManager.js`.** The exported `loadCredentials()` function did not strip the BOM that PowerShell adds when writing JSON files. `JSON.parse()` threw a `SyntaxError`, causing the startup credential dialog to fire even when credentials were valid. Fixed by adding `if (data.charCodeAt(0) === 0xFEFF) data = data.slice(1);`.

### Added — Staged Cargo Polling State Machine (`server.js`)

Instead of fetching cargo on every `/api/flights/current` request, the backend now uses a `cargoState` object with four statuses:

| Status | Meaning |
|---|---|
| `IDLE` | No active flight detected |
| `AWAITING_OA_START` | Flight exists but `StartTime` not yet set (Fly Now not pressed) |
| `LOADING` | `StartTime` set; cargo not yet fetched or empty result, retry in 60 s |
| `READY` | Cargo fetched and cached for the duration of the flight |

- Jobs API is never called until `StartTime` is set.
- Once a result is found (or engines are on with empty result), the state is permanently `READY` — no further Jobs API calls.
- Poll interval: 60 seconds.
- State resets on new flight ID.

### Added — Cargo Status UI (`AppMinimal.jsx`)

- `cargoStatus` React state tracks the backend polling stage.
- Flight data section now shows cargo and passenger lines sourced from live `cargoCharter` data instead of the legacy SI dispatch summary fields.
- Passenger line sorted **Eco → Business → First**.
- Cabin class shown as styled badge: dark green (Eco), dark blue (Bus), near-black (1st) — 1 px border, 3 px radius.
- Display format: `[Eco] 17 Soldiers | [Bus] 3 Film Crew | [1st] 1 Musicians`
- Cargo format: `Precious Metals (3976 lbs)` — uses `cargo.type` (the cargo category name), not the description number.
- Redundant standalone "Cargo & Charters" section removed from the UI.

### Changed — `cargoCharterService.js`

- `formatCharter()` now includes `cabinClass: ['Eco', 'Business', 'First'][charter.MinPAXSeatConf]`.
- `formatCharter()` now includes `type: charter.CharterType?.Name` for the human-readable charter type.
- `formatCargo()` now includes `type: cargo.CargoType?.Name` for the human-readable cargo type.
- Removed 70-line multi-strategy matching block in `matchCargoCharterForActiveFlight()`, replaced with single `CurrentAircraftId` filter (2 lines).

### Changed — `flightDetectionService.js`

- `isActiveStatus()`: was `StartTime || EngineOnTime || AirborneTime` (matched completed flights). Fixed to `StartTime && !EndTime`.
- `getDispatchSummary()`: replaced broken route matching with `CurrentAircraftId`; fixed payload field names.
- `matchFlightToJob()`: uses `CurrentAircraftId` matching.

---

## [0.1.x] — Prior releases

Previous work not formally documented. The application provides an API bridge and dispatch UI between OnAir Company (VA simulation platform) and SayIntentions.AI for use in MSFS 2024.
