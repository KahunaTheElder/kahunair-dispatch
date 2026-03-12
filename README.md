# KahunaAir Dispatch

An Electron desktop application that bridges **OnAir Company** (VA simulation platform) and **SayIntentions.AI** for use in Microsoft Flight Simulator 2024. It provides a real-time dispatch panel showing flight data, crew, cargo/charter manifests, telemetry, and OFP details.

---

## Architecture

```
Electron (main.js)
  └── Express backend (src/server.js)          ← REST API on localhost:3000
        ├── OnAir API client (src/apiClients.js)
        ├── Cargo/Charter service (src/cargoCharterService.js)
        ├── Flight detection (src/flightDetectionService.js)
        ├── SimConnect bridge (src/simConnectService.js)
        ├── SayIntentions.AI dispatcher (src/siDispatchService.js)
        └── SimBrief client (src/simBriefClient.js)
  └── React frontend (frontend/src/AppMinimal.jsx)
        └── Polls backend every 1s (telemetry), 10s (flight/crew/cargo)
```

**Credentials** are stored at `%APPDATA%\kahunair-dispatch\credentials.json`.

---

## Key Backend Endpoints

| Endpoint | Description |
|---|---|
| `GET /health` | Health check |
| `GET /api/flights/current` | Active OnAir flight with staged cargo state |
| `GET /api/flights/active` | Active flight with crew roster |
| `GET /api/telemetry` | Live SimConnect telemetry |
| `GET /api/flight/ofp` | SimBrief OFP (route, weights, procedures) |
| `GET /api/dispatch/summary` | SI dispatch summary |
| `POST /api/crew/:id/profile` | Save crew personality profile |

---

## Cargo/Charter Matching

Cargo and charter data comes from the OnAir **Jobs API** (`/company/{id}/jobs/pending` + `/completed`). The correct matching strategy is:

```js
cargo.CurrentAircraftId === flight.AircraftId
```

Every in-progress cargo/charter carries the ID of the aircraft currently transporting it. `MissionId` and route-based matching are **not reliable** — do not use them.

**Payload fields** (correct OnAir field names):
- `flight.PAXCount` — passenger count
- `flight.CargosTotalWeight` — total cargo weight in lbs
- `charter.MinPAXSeatConf` — cabin class: 0=Eco, 1=Business, 2=First
- `charter.CharterType.Name` — human-readable charter type (e.g. "Film Crew")
- `cargo.CargoType.Name` — human-readable cargo type (e.g. "Precious Metals")

### Staged Cargo Polling

The backend only calls the Jobs API after `flight.StartTime` is set (player has clicked "Fly Now" in OnAir). Status values returned on `/api/flights/current`:

| `cargoStatus` | Meaning |
|---|---|
| `IDLE` | No active flight |
| `AWAITING_OA_START` | Flight planned but not started |
| `LOADING` | Polling in progress (60 s interval) |
| `READY` | Cargo fetched and cached |

---

## Active Flight Detection

```js
// Correct — StartTime set AND EndTime not set
const isActive = flight.StartTime && !flight.EndTime;
```

The endpoint `/company/{id}/current` **does not exist** — always query `/company/{id}/flights` and filter.

---

## Building

Builds are done via GitHub Actions on every push to `master` or `main`. The workflow file is [`.github/workflows/build.yml`](.github/workflows/build.yml).

To trigger a build and download the result locally:

```powershell
# Push triggers the build automatically
git push origin master

# Monitor and download
$id = (gh run list --repo KahunaTheElder/kahunair-dispatch --limit 1 --json databaseId | ConvertFrom-Json).databaseId
do {
  Start-Sleep 15
  $r = gh run view $id --repo KahunaTheElder/kahunair-dispatch --json status,conclusion | ConvertFrom-Json
  Write-Host "$($r.status) $($r.conclusion)"
} while ($r.status -ne 'completed')

Remove-Item "KahunaAir Dispatch 0.2.0.exe" -Force
gh run download $id --repo KahunaTheElder/kahunair-dispatch --name kahunair-dispatch-exe --dir .
```

---

## Credentials

Required credentials stored in `%APPDATA%\kahunair-dispatch\credentials.json`:

```json
{
  "ONAIR_COMPANY_ID": "uuid",
  "ONAIR_COMPANY_API_KEY": "uuid",
  "ONAIR_VA_ID": "uuid",
  "ONAIR_VA_API_KEY": "uuid",
  "SI_API_KEY": "key",
  "SIMBRIEF_PILOT_ID": "number"
}
```

> **Note:** If you create or edit this file with PowerShell, it will be written with a UTF-8 BOM. The app handles this automatically.

---

## Development

```powershell
# Install dependencies
npm install --legacy-peer-deps
npm ci --prefix frontend

# Run backend only
npm start

# Run in dev mode (backend + frontend via Vite)
npm run electron-dev
```

---

## OnAir API Reference

Base URL: `https://server1.onair.company/api/v1`

Authentication: `oa-apikey` header with the company or VA API key.

Key endpoints used:
- `GET /company/{id}/flights?page=1&pageSize=50` — flight list
- `GET /company/{id}/jobs/pending` — pending jobs
- `GET /company/{id}/jobs/completed` — completed jobs
- `GET /company/{id}/aircraft` — fleet list
