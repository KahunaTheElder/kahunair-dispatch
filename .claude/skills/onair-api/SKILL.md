---
name: onair-api
description: Use when working with the OnAir Company API — flight detection, cargo/charter matching, jobs, fleet, or any OnAir data integration
applyTo: "src/**/*.js"
---

# OnAir API Skill

## Base URL & Auth

```
https://server1.onair.company/api/v1
Header: oa-apikey: <key>
```

Two separate credential pairs exist:
- **Company role**: `ONAIR_COMPANY_ID` + `ONAIR_COMPANY_API_KEY`
- **VA role**: `ONAIR_VA_ID` + `ONAIR_VA_API_KEY`

Try company first, fall back to VA.

---

## Active Flight Detection

```js
// ✅ Correct
const isActive = flight.StartTime && !flight.EndTime;

// ❌ Wrong — matches completed flights
const isActive = flight.StartTime || flight.EngineOnTime;
```

- **No `/current` endpoint exists.** Always query `/company/{id}/flights` and filter.
- Useful filter: `pageSize=50` (recent flights only, faster than full list).
- `Aircraft.CurrentFlight` field is in the schema but always returns `null` from the API.

---

## Payload Field Names

```js
flight.PAXCount            // ✅ passenger count
flight.CargosTotalWeight   // ✅ cargo weight (lbs)

flight.Passengers          // ❌ legacy, always 0
flight.Cargo               // ❌ legacy, always 0
```

Other useful flight fields:
```js
flight.Id                  // UUID
flight.AircraftId          // UUID of aircraft (use for matching)
flight.StartTime           // Set when player clicks "Fly Now"
flight.EngineOnTime        // Set when engines started
flight.AirborneTime        // Set at takeoff
flight.EndTime             // Set on landing/completion
flight.Aircraft.AircraftType.DisplayName  // ✅ aircraft type display name
flight.Aircraft.AircraftType.Name         // ❌ internal name, not for display
```

---

## Cargo & Charter Matching

### The One Correct Strategy

```js
// Match cargo/charter items to flight by AircraftId
const matched = allItems.filter(item => item.CurrentAircraftId === flight.AircraftId);
```

**Never use:**
- `MissionId` — this is the container Mission ID, shared by all items in a Mission, not the Flight ID
- Route matching on `DepartureAirport` — reflects the mission origin, not the current leg

### Data Sources

```js
// Jobs come from two endpoints — combine both
const [pending, completed] = await Promise.all([
  apiCall(`/company/${id}/jobs/pending`, key),
  apiCall(`/company/${id}/jobs/completed`, key)
]);
const allCargos   = [...pending, ...completed].flatMap(j => j.Cargos   || []);
const allCharters = [...pending, ...completed].flatMap(j => j.Charters || []);
```

### Key Charter Fields

```js
charter.CurrentAircraftId          // Match key
charter.PassengersNumber           // Passenger count
charter.MinPAXSeatConf             // Cabin class: 0=Eco, 1=Business, 2=First
charter.CharterType.Name           // Human-readable type: "Film Crew", "Soldiers"
charter.Description                // "#8 Business Passenger Transport" — NOT useful for display
charter.DepartureAirport.ICAO
charter.DestinationAirport.ICAO
```

### Key Cargo Fields

```js
cargo.CurrentAircraftId            // Match key
cargo.Weight                       // Weight in lbs
cargo.CargoType.Name               // Human-readable type: "Precious Metals", "White Goods"
cargo.Description                  // "#7 Cargo Delivery" — NOT useful for display
```

---

## Staged Cargo Polling Pattern

Never hammer the Jobs API — it's slow and cargo isn't available until the flight starts:

```js
const CARGO_POLL_INTERVAL_MS = 60000;

// State machine per flight
let cargoState = { flightId: null, cargoCharter: null, cargoStatus: 'IDLE', lastCargoFetch: null };

function updateCargoState(flight) {
  // Reset on new flight
  if (cargoState.flightId !== flight.Id) {
    cargoState = { flightId: flight.Id, cargoCharter: null, cargoStatus: 'IDLE', lastCargoFetch: null };
  }

  if (!flight.StartTime) {
    cargoState.cargoStatus = 'AWAITING_OA_START';
    return;
  }
  if (cargoState.cargoStatus === 'READY') return; // cached

  const elapsed = cargoState.lastCargoFetch ? Date.now() - cargoState.lastCargoFetch : Infinity;
  if (elapsed < CARGO_POLL_INTERVAL_MS) return; // wait

  // Fetch
  cargoState.lastCargoFetch = Date.now();
  const result = await matchCargoCharterForActiveFlight(flight, credentials);
  if (result.cargos.length > 0 || result.charters.length > 0 || flight.EngineOnTime) {
    cargoState.cargoCharter = result;
    cargoState.cargoStatus = 'READY';
  } else {
    cargoState.cargoStatus = 'LOADING'; // retry next interval
  }
}
```

Status values: `IDLE` | `AWAITING_OA_START` | `LOADING` | `READY`

---

## Common Pitfalls

| Pitfall | Fix |
|---|---|
| Calling `/company/{id}/current` | Does not exist — filter `/flights` instead |
| `isActive = StartTime \|\| EngineOnTime` | Matches completed flights — use `StartTime && !EndTime` |
| Matching by `MissionId` | Use `CurrentAircraftId` |
| Using `cargo.Description` for display | Use `cargo.CargoType.Name` |
| Using `charter.Description` for display | Use `charter.CharterType.Name` |
| `flight.Passengers` / `flight.Cargo` | Always 0 — use `PAXCount` / `CargosTotalWeight` |
| `AircraftType.Name` | Use `AircraftType.DisplayName` |
| Fetching jobs on every poll | Gate behind StartTime + 60s interval |
