---
name: sayintentions-api
description: Use when working with the SayIntentions.AI API — importVAData payload, SI detection, flight.json monitoring, procedure change detection, send queue pattern, VA profile structure
applyTo: "src/**/*.js,frontend/src/**/*.jsx"
---

# SayIntentions.AI (SI) API Skill

## Detection: Is SI Running?

SI detection is file-based — no port or process check needed:

```js
const SI_FLIGHT_JSON = path.join(
  process.env.LOCALAPPDATA, 'SayIntentionsAI', 'flight.json'
);
const isRunning = fs.existsSync(SI_FLIGHT_JSON) && fs.statSync(SI_FLIGHT_JSON).size > 0;
```

Backend endpoint: `GET /api/si/status` — returns `{ running, callsign, flight_id, on_ground, current_airport }`

`flight_id` changes on every new SI session. Track it to detect restarts.

---

## flight.json Structure (Key Fields)

⚠️ **Real structure verified March 2026** — all data is nested under `flight_details`, NOT at root level.

```js
// Root level: only "flight_details" key exists
{
  flight_details: {
    // Always present (flat fields):
    api_key:         "siEb5NFkfC4b",  // Rotates per session — read fresh on each dispatch
    flight_id:       845143415,
    callsign:        "Kahuna-one-zero-zero-one",
    callsign_icao:   "khn1001",
    on_ground:       1,               // 1=on ground, 0=airborne
    current_airport: "EGCC",
    runway:          "23L",           // Active runway (departure runway when on ground)
    heading:         320,
    altitude:        228,
    coordinates:     "53.36,-2.26",

    // These are "" (empty string) on ground / before SI loads a flight plan,
    // and become objects once SI has an active flight plan loaded:
    current_flight:  "" | {           // Object when SI flight plan loaded:
      flight_plan_departing_runway:  "05R",
      flight_plan_sid:               "ABKU2A",
      flight_plan_star:              "LOGA4A",
      flight_plan_arriving_runway:   "23L",
      assigned_gate:                 "A3",     // null until SI assigns parking
      taxi_path:                     "A B C",  // null until SI assigns taxi
      taxi_object:                   "Gate A3"
    },
    arrival_wx:      "" | {           // Object when arrival weather is available:
      approaches_in_use: "ILS23L"
    }
  }
}
```

**Correct pattern for reading flight.json:**
```js
const fd = flightJson?.flight_details || {};
// Guard against "" (empty string) — only use if it's actually an object
const cf = (fd.current_flight && typeof fd.current_flight === 'object') ? fd.current_flight : {};
const awx = (fd.arrival_wx   && typeof fd.arrival_wx   === 'object') ? fd.arrival_wx   : {};

// api_key is always at fd.api_key (NOT flightJson.api_key)
const apiKey = fd.api_key;

// Runway: prefer nested cf field (full flight plan), fall back to flat fd.runway (on ground)
const depRwy = cf.flight_plan_departing_runway || fd.runway || null;
```

---

## importVAData Endpoint

```
POST https://api.sayintentions.ai/api/v1/importVAData
Content-Type: application/x-www-form-urlencoded  ← REQUIRED (NOT JSON, NOT query params)
```

### Two-Key System

SI uses **two separate keys** — both required:

| Key | Source | Purpose |
|-----|--------|---------|
| `api_key` | `flight.json` root (rotates per session) | Pilot's personal SI session key |
| `va_api_key` | Saved credentials (`SI_VA_API_KEY`) | Links the company/VA account |

```js
// ✅ Correct — read api_key fresh from flight.json each dispatch
const flightData = JSON.parse(fs.readFileSync(SI_FLIGHT_JSON, 'utf8'));
const apiKey = flightData.api_key;

// Build form body (URLSearchParams, not JSON)
const body = new URLSearchParams({
  api_key:         apiKey,
  va_api_key:      credentials.SI_VA_API_KEY,
  crew_data:       payload.crew_data,
  dispatcher_data: payload.dispatcher_data,
  copilot_data:    payload.copilot_data,
});

const response = await fetch('https://api.sayintentions.ai/api/v1/importVAData', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: body.toString(),
});
```

### Payload Fields (all plain-text strings, NOT JSON)

| Field | Content |
|-------|---------|
| `crew_data` | Captain intro, FA profiles, VA culture, airline standards |
| `dispatcher_data` | Company policies, operational notes for the dispatcher |
| `copilot_data` | Captain preferences for FO's reference (procedure style, preferences) |

SI expects **paragraph-format natural language**, not structured JSON.

---

## VA Profile Structure (7 Sections)

Per SI best practices, structure VA profiles as:

1. `name` + `about` / `tagline` — Airline identity
2. `safetyPriority` / `safetyQuirks` — Safety & Compliance
3. `crewGreeting` — Passenger greeting / announcement style
4. `communicationStyle` / `humorPolicy` — Cabin tone & service philosophy
5. `signatureAmenities` — Signature amenities
6. `traditions` — Traditions & quirks
7. `companyPolicies` — Dispatcher notes / company policies

**Callsign is NOT stored in VA profile** — it comes from the SimBrief OFP.

---

## Send Queue Pattern

SI may not be running when dispatch is ready. Use a pending queue:

```js
// On dispatch
if (!siRunning) {
  pendingSIPayload = payload;   // queue it
  return;
}
sendToSI(payload);

// On SI detected as running (flight_id changes or running flips true)
if (pendingSIPayload) {
  sendToSI(pendingSIPayload);
  pendingSIPayload = null;
}
```

In React: store `siSendStatus` in state (`'idle' | 'pending' | 'sent' | 'applied'`).

---

## Procedure Change Detection Pattern (React)

```jsx
// 1. Capture OFP baseline ONCE on SimBrief load — never overwrite
const ofpProceduresRef = useRef(null);
if (!ofpProceduresRef.current) {
  ofpProceduresRef.current = {
    depRwy: ofp.departure?.runway || null,
    sid:    ofp.departure?.SID    || null,
    arrRwy: ofp.arrival?.runway   || null,
    star:   ofp.arrival?.STAR     || null,
    // No approach — OFP doesn't assign one
  };
}

// 2. Poll /api/si/procedures every 15s when siRunning
useEffect(() => {
  if (!siRunning) { setSiProcedures(null); return; }
  const poll = async () => {
    const json = await fetch(`${apiUrl}/api/si/procedures`).then(r => r.json());
    if (json.success) setSiProcedures(json.procedures);
  };
  poll();
  const id = setInterval(poll, 15000);
  return () => clearInterval(id);
}, [apiUrl, siRunning]);

// 3. Compare for changes
const ofpBase = ofpProceduresRef.current;
const chgStar   = ofpBase && siProcedures?.star   && siProcedures.star   !== ofpBase.star;
const chgSid    = ofpBase && siProcedures?.sid    && siProcedures.sid    !== ofpBase.sid;
const chgArrRwy = ofpBase && siProcedures?.arrRwy && siProcedures.arrRwy !== ofpBase.arrRwy;
const chgDepRwy = ofpBase && siProcedures?.depRwy && siProcedures.depRwy !== ofpBase.depRwy;
```

**Display convention:**
- Changed procedures → **amber** + `↑` indicator + hover tooltip with original value
- Approach (no OFP baseline) → **blue** when non-null
- Gate / taxi path → **green** row when either is non-null

---

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Sending payload as JSON body | Must be `application/x-www-form-urlencoded` |
| Sending as query params | Must be POST body |
| Using only one API key | Need BOTH `api_key` (flight.json) AND `va_api_key` (credentials) |
| Hardcoding `api_key` | Must read fresh from `flight.json` — rotates per session |
| Reading approach from OFP | OFP has no approach; it comes from `arrival_wx.approaches_in_use` |
| Overwriting `ofpProceduresRef` on re-poll | Set once on OFP load, never update |

---

## References

- Dispatch service: `src/siDispatchService.js`
- Payload builder: `src/siPayloadBuilder.js`
- SI endpoints in server: `src/server.js` (search `/api/si/`)
- VA profile schema: `src/vaProfileManager.js`
- Procedure monitoring in UI: `frontend/src/AppMinimal.jsx` (search `ofpProceduresRef`)
