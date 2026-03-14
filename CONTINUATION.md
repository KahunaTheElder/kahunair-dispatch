# KahunaAir Dispatch — Continuation

*Last updated: March 14, 2026 — commit `1a99678`*

---

## CURRENT STATE

The app is fully functional. Exe is ready at `K:\Workspaces\kahunair-dispatch\KahunaAir Dispatch 0.2.0.exe` (85.3 MB, built March 14 00:10).

**Branch:** `master` — fully synced with `origin/master`.

---

## WHAT'S WORKING ✅

| Feature | Notes |
|---|---|
| Departure taxi resolver | EGLL: `C → B → L28 → N1B` confirmed matching ATC |
| Arrival taxi resolver | `fd.current_airport` fix applied (needs live test at destination) |
| Taxi shows `RCVD` fallback | When taxi path exists but SimConnect graph unavailable |
| Crew profiles persist across flights | Now keyed by `People.Id` (stable) not `FlightCrew.Id` |
| Passenger employees filtered | `rawRole > 2` → `isPassenger:true` → skipped in profile queue |
| OFP weights retry | Retries every 30s until SimBrief returns real values |
| SC indicator accurate | Polls `/api/simconnect/status` — green only when MSFS running |
| Initial altitude in params | `RFL FL290` from SimBrief `cruise_fl`, appended to params line |
| GPS ETE SimVar | Buffer slot 26, `navigation.eteSeconds/eteMinutes` — confirmed working |

---

## OPEN ISSUES / NEEDS TESTING

| Issue | Status | Action Needed |
|---|---|---|
| Arrival taxi not displayed (EDXW flight) | Fix committed `1a99678`, not yet live-tested | Fly to any airport, confirm `TAXI [names]` appears on arrival |
| Telemetry failed after takeoff (Note 6) | Undiagnosed | Needs `logs/backend.log` from a failed session; look for `[SimConnect]` disconnect |
| Arrival/approach procedures empty (Note 7) | Likely correct — EDXW has no published STAR/approach | Confirm with a flight to an airport that has an instrument approach |
| SI crew data not used (Note 5) | Waiting on SI support | No code action needed yet |

---

## ARCHITECTURE QUICK REFERENCE

### SimConnect ID Space — DO NOT COLLIDE
| Reservation | DEF IDs | REQ IDs |
|---|---|---|
| `simConnectService.js` | 0 (telemetry), 1 (names) | 0 (telemetry), 1 (names) |
| `taxiGraphService.js` | 10 (facility) | 100–9999 (rotating) |

### Key SI flight.json Fields
```
fd.current_airport          // Aircraft's actual current location (changes in flight)
cf.flight_origin            // Always the departure airport — do NOT use for taxi resolver
cf.taxi_path                // [{heading, point:{lat,lon}}, ...] — SI waypoints
cf.assigned_gate            // Gate name string
cf.flight_plan_star / .sid
awx.approaches_in_use       // null if no approach published
```

### Crew Profile Keys
```js
const profileId = member.isMe    ? 'my-pilot'
                : member.peopleId ? member.peopleId  // stable across flights ✅
                :                   member.id         // fallback (per-flight) ❌
```

### Backend Endpoints (key ones)
| Endpoint | Purpose |
|---|---|
| `GET /health` | Backend alive check only — does NOT reflect MSFS state |
| `GET /api/simconnect/status` | `{ connected: bool }` — real SC link state |
| `GET /api/si/status` | `{ running, flight_id, callsign, ... }` |
| `GET /api/si/procedures` | `{ depRwy, sid, star, arrRwy, approach, gate, taxiRoute }` |
| `GET /api/flight/active` | OnAir active flight with crew and cargo |
| `GET /api/flight/ofp` | SimBrief OFP (weights, route, procedures, weather) |

---

## KEY FILE LOCATIONS

| File | Purpose |
|---|---|
| `src/taxiGraphService.js` | SimConnect Facility API taxi-graph resolver |
| `src/simConnectService.js` | SimConnect telemetry service (DEF/REQ 0 & 1) |
| `src/server.js` | All backend endpoints |
| `frontend/src/AppMinimal.jsx` | Main React UI (single-file app) |
| `logs/taxiDiag_EGLL.json` | Cached EGLL taxi graph — valid, reuse for diagnostics |
| `src/taxiDiag.js` | Offline diagnostic tool: `node src/taxiDiag.js` (MSFS must be running) |
| `%APPDATA%\KahunaAir\crews\` | Crew profile storage (keyed by People.Id or `my-pilot`) |
| `%APPDATA%\KahunaAir\settings.json` | SimBrief pilot ID, OA pilot ID, etc. |
| `%LOCALAPPDATA%\SayIntentionsAI\flight.json` | Live SI state — polled every 15s |

---

## QUICK START FOR NEXT SESSION

1. **Start fresh:** Run `KahunaAir Dispatch 0.2.0.exe` from workspace root
2. **If debugging:** `node index.js` (no Electron) — shows full stdout/stderr
3. **If taxi not resolving:** Check log for `[TaxiGraph] Requesting...` / `Graph cached` / `Timeout`
4. **If SC green when sim off:** Should be fixed — but check that `/api/simconnect/status` returns `connected:false`
5. **After a failed telemetry session:** Grab `logs/backend.log` before closing app

---

## POTENTIAL NEXT WORK (not committed to)

1. **Crew Editor for old-format profiles** — old profiles load fine; editor shows V2 fields if opened. Low priority.
2. **Taxi route persistence** — route disappears if app refreshes before next 15s poll after landing. Could hold last route in state.
3. **SI procedures: arrival during climb** — STAR/approach appear late (SI design). Consider showing `---` as expected rather than blank.
4. **Telemetry failure investigation** — if happens again, collect the log.

---

## SIMCONNECT DEF/REQ ID SPACE

Already used by `simConnectService.js`:
- DEF 0 = telemetry, DEF 1 = station names
- REQ 0 = telemetry, REQ 1 = station names

Used by `taxiGraphService.js`:
- DEF 10 = facility definition
- REQ IDs 100–9999 (rotating counter per airport fetch)

Do NOT use DEF 0,1 or REQ 0,1 in any new SimConnect code.

---

## NEXT POTENTIAL WORK (not committed to)

1. **Crew Editor V2 for old-format profiles** — old profiles load fine now, but the editor
   shows the new-format fields if opened. Low priority since old profiles work.

2. **Taxi route persistence** — currently route disappears if you refresh before next 15s poll.
   Could cache last route in state so it survives the first null response.

3. **Multi-airport cache display** — cache currently clears on SimConnect reconnect.
   Minor: first flight after restart always gets one null poll cycle.
