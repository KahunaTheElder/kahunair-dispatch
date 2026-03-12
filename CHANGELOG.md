# Changelog

All notable changes to KahunaAir Dispatch are documented here.

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
