# Crew Personality Editor — Implementation Plan

**Status:** Ready to Implement  
**Target Branch:** master  
**Reference:** This document captures all decisions, architecture, and sequenced work items for the crew personality editor feature.

---

## Summary of Feature

When a flight loads from OnAir, the app checks for a saved personality/background profile for each crew member (keyed by OA People UUID). If any profiles are missing, the app opens editors **sequentially** — Captain first (always the user), then FO, then FAs in order. Existing profiles are silently skipped. Once all crew are either profiled or explicitly skipped, the assembled data is automatically sent to SI's `importVAData` endpoint.

---

## Confirmed Decisions

| # | Decision | Detail |
|---|---|---|
| 1 | Profile key = OA UUID | `People.Id` UUID is the stable index for all crew profiles |
| 2 | User pilot profile | Stored under fixed ID `my-pilot`. Captain role in OA = always the user — no UUID matching needed |
| 3 | User identity in OA | The **Captain role** is always the user. No `myOaId` setting required. `my-pilot.json` is the permanent profile for the user regardless of which flight they command |
| 4 | Random generation | 20–25 curated options per field, randomized independently. Hours + flights always come from OA; experience level derived via hours-to-rating lookup |
| 5 | SI send trigger | Automatic — fires as soon as all crew on the current flight are either profiled or explicitly skipped. No manual button |
| 6 | Skipped crew | Show "Are you sure?" modal. **Yes** → mark as skipped, advance to next. **No** → reopen editor for that crew member |
| 7 | Dispatcher editing | **OUT OF SCOPE** for this session. `buildDispatcherData()` continues to handle it generically |
| 8 | Captain data in SI payload | `my-pilot` profile feeds both `crew_data` (captain intro for cabin crew) and `copilot_data` (captain preferences for FO's reference) |
| 9 | VA API Key | Yes — exists. Lives in credentials alongside OA + SI keys. Add `vaApiKey` field to the credentials dialog if not already there |
| 10 | Captain operational preferences | **Included** — full operational preferences (procedure style, crew interaction, altitude/speed preferences) are completed and fed into `copilot_data` so the FO has full captain context |
| 11 | "All ready" definition | **All crew** must be profiled or skipped — Captain, FO, and all FAs — before SI send fires |
| 12 | Repeat flights | Same crew UUID on a subsequent flight → profile already exists → silently skipped in the queue → app goes straight to SI send |
| 13 | Sequential editor flow | Editors open in strict order: Captain → FO → FA1 → FA2 → … On save or confirmed skip, advance automatically to next crew member needing a profile. When queue is empty, fire SI send |

---

## Sequential Editor Flow (Key Behavior)

This is the central UX pattern:

```
Flight loads from OA
  │
  ▼
Build crewQueue = crew.members
  sorted by role: Captain first, then FO, then FAs
  filtered to: members WITHOUT an existing saved profile
  │
  ├─ Queue empty? → All profiles already exist → fire SI send immediately
  │
  └─ Queue has items?
       │
       ▼
     Open CrewProfileEditorV2 for crewQueue[0]
       │
       ├─ User saves profile
       │    → persist to backend
       │    → advance queue index
       │    → open editor for crewQueue[1], or...
       │    → if queue exhausted → fire SI send
       │
       └─ User clicks Skip
            → "Are you sure? Skipping [Name] sends incomplete data to SI."
            ├─ Yes → mark crewId as skipped, advance queue, continue
            └─ No  → reopen editor for same crew member (no advance)
```

State in `AppMinimal`:
```javascript
const [crewQueue, setCrewQueue] = useState([])     // ordered list of crew IDs needing profiles
const [queueIndex, setQueueIndex] = useState(0)    // current position in queue
const [skipConfirm, setSkipConfirm] = useState(null) // crewId pending skip confirm, or null
const [siSendStatus, setSiSendStatus] = useState('idle') // idle | sending | sent | error
```

The `editingCrewId` state already exists and drives `CrewProfileEditorV2`. The queue drives what gets set into `editingCrewId`.

---

## Hours-to-Rating Conversion Table

_(Used by the randomizer to set `experienceLevel` and `background.flightHours`)_

| OA Hours | Experience Level Label |
|---|---|
| 0–100 | New Hire |
| 100–500 | Junior First Officer |
| 500–1500 | First Officer |
| 1500–3000 | Senior First Officer |
| 3000–5000 | Line Captain |
| 5000–8000 | Captain |
| 8000–12000 | Senior Captain |
| 12000+ | Chief Pilot / Senior Check Captain |

Flight Attendants use a parallel scale:

| OA Hours | Experience Level Label |
|---|---|
| 0–500 | Junior Flight Attendant |
| 500–2000 | Flight Attendant |
| 2000–5000 | Senior Flight Attendant |
| 5000+ | Lead Cabin Crew |

---

## Randomization Pools (20–25 options per field)

These pools are defined here for review. Implementation goes into `src/crewRandomizer.js`.

### Captain — Background Specialty (25 options)
1. Long-haul international operations
2. Multi-engine turboprop transitions
3. High-altitude mountain flying
4. Oceanic / ETOPS certified
5. Cargo and freight operations
6. Corporate charter and VIP transport
7. Low-visibility CAT III approaches
8. Island and short-field operations
9. Heavy widebody aircraft transitions
10. Regional jet operations
11. Military transport conversion
12. Medevac and air ambulance
13. Aerial survey and special missions
14. Check airman and line training
15. Simulator instructor qualification
16. Cold weather and arctic operations
17. Overwater emergency procedures specialist
18. Reduced vertical separation minimum (RVSM) operations
19. Advanced avionics (glass cockpit) specialist
20. Commuter / high-frequency short-sector operations
21. Low-level tactical flying background
22. Ferry and delivery flights (international)
23. Fire suppression air tanker background
24. Maritime patrol adaptation
25. Selective calling (SELCAL) and HF communications specialist

### Captain — Procedure Style (20 options)
1. By the book — strict SOP adherence
2. Methodical — thorough, no shortcuts
3. Efficient — SOP-compliant but time-aware
4. Old school — technique-based, high manual-flying preference
5. Glass-pit native — automation-forward
6. Crew-centric — heavy CRM emphasis
7. Data-driven — cross-checks everything
8. Safety-first — conservative decision margins
9. Adaptive — adjusts style to conditions
10. Mentoring style — explains decisions to FO
11. Quiet professional — minimal verbosity, maximum precision
12. Proactive briefer — front-loads all information
13. Checklist guardian — never skips, never rushes
14. Situational awareness focused — always ahead of the aircraft
15. Communication-heavy — keeps crew well informed
16. Minimalist — only says what's needed
17. Risk-manager — explicit go/no-go criteria
18. High-autonomy — trusts FO, delegates fully
19. Assertive — takes control early in abnormals
20. Collaborative — consensus-based decision making

### Captain — Personality Style (25 options)
1. Professional and composed
2. Warm but authoritative
3. Direct and no-nonsense
4. Thoughtful and deliberate
5. Quietly confident
6. Personable and approachable
7. Firm but fair
8. Reserved and focused
9. Inspirational — leads by example
10. Deadpan humor, dry wit
11. Formal — strictly professional
12. Energetic and enthusiastic
13. Steady and reassuring
14. Stoic under pressure
15. Analytical — processes before speaking
16. Naturally curious — asks good questions
17. Experienced storyteller — uses examples from career
18. Tactical — always focused on the next step
19. Patient mentor
20. Efficient communicator — brief and clear
21. Slightly old-fashioned — prefers manual flying
22. Optimist — always finds a path forward
23. Detail-oriented perfectionist
24. Protective of the crew
25. Humble — credits the team

### Captain — Communication Preference (20 options)
1. Formal standard phraseology
2. Structured with clear callouts
3. Concise, information-dense
4. Warm but precise
5. Military-influenced, clipped
6. Conversational in cruise, formal on approach
7. Narrative-style briefings
8. Bullet-point style, no rambling
9. Check-in and acknowledge style
10. Prefers written/ACARS for non-urgent items
11. Proactive — announces intentions early
12. Collaborative — invites FO input
13. Decisive — no ambiguity in callouts
14. Safety-focused phrasing
15. Standardized across all phases of flight
16. Adapts tone to workload level
17. Calm monotone, professional
18. Assertive in high-workload, relaxed in cruise
19. Clear and deliberate — never rushed
20. Minimal chatter — conserves radio time

### FO — Personality Style (25 options)
_(Mirrors captain pool with FO-appropriate variations)_
1. Eager and detail-focused
2. Quietly competent
3. Proactive on callouts
4. Reserved but reliable
5. By-the-book, consistent
6. Friendly — easy rapport with captain
7. Slightly deferential by rank, confident in knowledge
8. Technically sharp — systems expert
9. Dry humor during cruise
10. Asks good clarifying questions
11. New to the type — extra careful
12. Experienced — confident contributor
13. Trivia buff — shares facts during cruise
14. Weather-focused — always checks conditions
15. Fuel monitor — tracks consumption carefully
16. Checklist-first mentality
17. Conversational and warm in cruise
18. Formal and precise during procedures
19. Situationally aware — catches things early
20. Team player — backs up captain fully
21. Safety advocate — willing to speak up
22. Efficient — keeps things moving
23. Methodical — no step skipped
24. Diplomatic — handles disagreements well
25. Enthusiastic about aviation history and aircraft

### FO — Background Specialty (25 options)
_(Similar to captain pool but at lower experience tier)_
1. Regional jet background
2. Turboprop multi-engine
3. General aviation cross-country
4. Instructing background — PPL/IR
5. Military flight school
6. Desert/hot-and-high operations
7. Coastal and overwater
8. Freight and cargo operation
9. Sim-heavy training, low flight hours
10. Corporate/charter transitions
11. Island and remote strip operations
12. High-density traffic environment (major hub)
13. International oceanic sectors
14. Night freight specialist
15. Mountain and terrain awareness
16. Instrument flight only — low VFR experience
17. Emergency procedures specialist
18. CRM facilitator background
19. Fuel planning and dispatch cross-trained
20. Weather avoidance specialist
21. Long-haul fatigue management trained
22. Type rating just completed — new to line
23. Accelerated upgrade program graduate
24. Airline cadet program direct entry
25. University aviation degree — systems focus

### Flight Attendant — Service Style (25 options)
1. Premium cabin — formal and attentive
2. Warm and welcoming — hospitality-first
3. Efficient — fast service, minimal fuss
4. Safety-first — procedures before service
5. Luxury-trained — anticipates every need
6. Island hospitality style — relaxed and friendly
7. Corporate charter — VIP service standard
8. High-energy — upbeat and positive
9. Calm and reassuring — particularly good with nervous flyers
10. Professional minimalist — visible only when needed
11. Storytelling style — engages passengers with context
12. Children-friendly — warm with families
13. Medically trained — calm in emergencies
14. Multilingual service — adapts to passenger language
15. High-frequency shuttle style — fast turnaround cadence
16. Formal airline tradition — structured announcements
17. Modern casual — approachable and genuine
18. Galley-focused — strong on food service quality
19. Safety-briefing perfectionist — every word right
20. Passenger advocate — goes above and beyond
21. Silent service — reads the cabin, responds proactively
22. Experienced charters — handles unusual requests smoothly
23. Military background — precise and dependable
24. Customer relations trained — handles complaints gracefully
25. Long-haul specialist — manages fatigue and service cadence

### Flight Attendant — Specialty (20 options)
1. International service, premium cabin management
2. Galley operations and beverage service
3. Passenger relations and conflict resolution
4. Emergency procedures and first aid
5. Special needs passenger assistance
6. Children and unaccompanied minor care
7. VIP and charter service
8. Safety demonstration and compliance
9. Crew coordination and communication
10. Medical in-flight response
11. Long-haul fatigue management
12. Cultural and language diversity
13. Food service and dietary accommodation
14. Security screening awareness
15. Boarding and deplaning efficiency
16. Dangerous goods awareness
17. Fire suppression and evacuation procedures
18. CRM and crew communication
19. Island route hospitality culture
20. High-density cabin management

### Certifications Pool (draw 3 from 25 for FO/Captain)
1. ATPL (Airline Transport Pilot License)
2. CPL (Commercial Pilot License)
3. Instrument Rating (IR) current
4. Multi-engine rating (ME)
5. Type rating — Boeing 737 family
6. Type rating — Airbus A320 family
7. Type rating — Bombardier CRJ series
8. Type rating — ATR 72
9. Type rating — Beech 1900 / King Air
10. LOFT (Line-Oriented Flight Training) current
11. CRM (Crew Resource Management) current
12. Extended Operations (ETOPS/EROPS) qualified
13. RVSM (Reduced Vertical Separation) qualified
14. CAT III (Low Visibility Operations) current
15. Oceanic procedures qualified
16. MNPS (Minimum Navigation Performance Specifications)
17. Mountain and high-altitude endorsement
18. Night rating (NR)
19. Upset Prevention and Recovery Training (UPRT)
20. Dangerous goods awareness trained
21. EFB (Electronic Flight Bag) qualified
22. Check airman authorized
23. Simulator instructor (SIM-I) qualified
24. Line check airman
25. ACAS/TCAS resolution advisory trained

### FA Certifications (draw 2 from 15)
1. CRM trained
2. Safety demonstration current
3. First aid / CPR certified
4. Dangerous goods awareness (IATA)
5. Emergency procedures qualified
6. Defibrillator (AED) trained
7. Special assistance (reduced mobility) trained
8. Galley safety certified
9. Security awareness training
10. Fire and smoke procedures qualified
11. Evacuation drill current
12. Child seat installation certified
13. Unaccompanied minor escort trained
14. Crowd management certified
15. In-flight medical response trained

---

## SI Payload Mapping

Based on the SI `importVAData` best practices docs:

```
crew_data (string):
  - VA name: Kahuna Air Industries
  - Aircraft + route (from active flight)
  - Captain: [user's my-pilot profile name, hours, experience level, style]
  - For each Flight Attendant: name, experience level, service style, specialty
  - Airline culture from kahuna-air.json (traditions, service standard)

copilot_data (string):
  - FO name, experience level, personality, communication style
  - Filed route (departure → arrival ICAO)
  - Aircraft type + registration
  - Fuel load + weights from SimBrief OFP (when available)
  - Passenger/cargo count
  - Captain preferences (from my-pilot profile) — so FO knows how captain works

dispatcher_data (string):
  - Existing buildDispatcherData() output (unchanged for now)
  - Flight number, route, fuel, passengers, cargo
```

---

## New Files

| File | Purpose |
|---|---|
| `src/crewRandomizer.js` | Random profile generator — pools + `generateProfile(role, oaHours, oaFlights)` |
| `src/siPayloadBuilder.js` | `assembleVAPayload(profiles, flight, vaProfile)` → `{ crew_data, copilot_data, dispatcher_data }` |

---

## Modified Files

| File | Changes |
|---|---|
| `frontend/src/components/CrewProfileEditorV2.jsx` | Full implementation (currently stub) |
| `src/crewProfileManager.js` | Schema upgrade to rich template; `my-pilot` routing; upgrade `formatCrewDataForSI()` |
| `src/server.js` | New `POST /api/dispatch/crew-to-si` endpoint; `GET/POST /api/crew/my-pilot/profile`; add `vaApiKey` to credentials |
| `frontend/src/AppMinimal.jsx` | Sequential queue logic; auto-send trigger; skip confirm modal; SI status badge |
| `src/credentialsManager.js` | Add `vaApiKey` field alongside existing keys |
| `src/settingsManager.js` | ~~`myOaId`~~ **Not needed** — Captain role = user, no UUID lookup required |

---

## Implementation Sequence

### Step 1 — Credentials: Add `vaApiKey`
- VA API key is already in hand — wire it in immediately
- Add `vaApiKey` to `credentialsManager.js` (load/save/validate alongside existing OA + SI keys)
- Add `vaApiKey` field to the credentials dialog in `AppMinimal.jsx` (or wherever that dialog renders)
- Backend: pass `vaApiKey` through to `siDispatchService.js` for use in `importVAData` payload as `va_api_key`
- **Test:** Save credentials with all four keys, confirm round-trip (load back, no BOM issues). Verify `va_api_key` appears in the `POST /api/dispatch/crew-to-si` payload

### Step 2 — User Pilot Profile (`my-pilot`)
- Backend: `GET /api/crew/my-pilot/profile` and `POST /api/crew/my-pilot/profile`
- Profile stores in `%APPDATA%\KahunaAir\crews\my-pilot.json`
- Schema uses full captain template (personality + operationalPreferences — see target schema below)
- In `formatFlightResponse()`, the crew member with `role === 'Captain'` (or role value `0`) gets `isMe: true` injected — no UUID lookup needed
- `crewProfileManager.load('my-pilot')` works identically to loading any other profile
- **Test:** GET returns `{ isNew: true }` initially, POST creates it, GET returns it. Verify `isMe: true` appears on the captain in `/api/flights/active` response

### Step 3 — Randomizer (`src/crewRandomizer.js`)
- Implement all pools from this plan (25 options each for specialty, personality style, communication, procedure style; 25 certifications to draw from)
- `generateProfile(role, oaHours, oaFlights, oaName)` → returns full profile object matching target schema
- `hoursToExperienceLevel(hours, role)` → string label using the conversion table in this plan
- `pickN(pool, n)` → picks N unique items from an array (for certifications: 3 for pilots, 2 for FAs)
- Pools for Captain and FO share the same specialty/personality pools; FAs use their own service style + specialty pools
- **Test:** Run `generateProfile` 10× for each role in the Node REPL, verify: (1) no two identical profiles in a row, (2) experience level matches hours range, (3) certifications array has correct count and no duplicates

### Step 4 — `CrewProfileEditorV2.jsx` — Full Implementation
- Modal overlay — covers full screen when a `crewId` is active in the queue
- **Header (read-only):** crew name, role badge, OA hours, OA flights. For Captain: labeled "My Pilot Profile"
- **Mode toggle:** Manual | Randomize
  - **Randomize mode:** Shows all generated fields as individual dropdowns (each pre-loaded with the 20–25 pool options, current selection highlighted). "Re-roll All" regenerates everything. Each field has its own single re-roll die icon.
  - **Manual mode:** Same fields as editable text inputs / dropdowns, starting empty (or from existing profile if re-editing)
- Fields shown per role:
  - Captain/FO: specialty, experience level (derived, read-only), personality style, communication preference, procedure style (Captain only), certifications (chips display)
  - FA: service style, specialty, experience level (derived, read-only), certifications (chips display)
  - Captain only: operationalPreferences section (altitude preference, cruise speed, crew interaction) — fed to copilot_data
- **Footer:** Save button → `onSave(crewId, profileData)` | Skip button → triggers skip confirm modal
- **Test:** Open editor for Captain (should show "My Pilot Profile" label), fill/randomize, save — verify profile card updates. Open for FA, randomize, save. Test skip → confirm modal appears. Test "No" → modal closes, editor still open. Test "Yes" → advances to next

### Step 5 — SI Payload Builder (`src/siPayloadBuilder.js`)
- `assembleVAPayload(crewProfilesMap, flight, vaProfile)`:
  - `crewProfilesMap`: `{ 'my-pilot': {...}, 'uuid-fo': {...}, 'uuid-fa1': {...} }`
  - Captain's `my-pilot` profile → contributes to both `crew_data` (intro line) and `copilot_data` (captain context for FO)
  - FO profile → `copilot_data` (personality, style, route/fuel/weights context)
  - All FA profiles → `crew_data` (service style, specialty, cabin management notes)
  - VA culture from `kahuna-air.json` (airline name, traditions, service standard) → appended to `crew_data`
  - `dispatcher_data` → delegates to existing `buildDispatcherData()` unchanged
  - All output is natural language plain text (not JSON) — SI expects paragraph-format strings
  - Returns `{ crew_data, copilot_data, dispatcher_data }`
- Remove or deprecate `crewProfileManager.formatCrewDataForSI()` — replaced by this module
- **Test:** Pass mock profiles + flight object, `console.log` all three output strings, manually verify they read naturally and contain the expected fields

### Step 6 — Backend Send Endpoint
- `POST /api/dispatch/crew-to-si`
  - Loads all crew profiles for the current active flight using `crewProfileManager`
  - Captain → loads `my-pilot.json`; others → load by UUID from flight crew list
  - Calls `siPayloadBuilder.assembleVAPayload()`
  - POSTs to `https://apipri.sayintentions.ai/sapi/importVAData` with:
    ```
    api_key = globalSIKey (from credentials)
    payload = JSON.stringify({ va_api_key, crew_data, copilot_data, dispatcher_data })
    ```
  - Returns `{ success, siStatus, message }`
- **Test:** Hit endpoint with a known saved profile set, confirm SI returns `{ status: "OK" }`. Test with `va_api_key` missing → expect clear error, not silent failure

### Step 7 — AppMinimal: Queue Logic + Auto-Send
- On crew data load (inside the existing `loadCrewProfiles` effect):
  1. Sort crew: Captain first (role 0), then FO (role 1), then FAs (role 2+)
  2. For Captain: check if `my-pilot.json` exists
  3. For all others: check if profile exists by UUID
  4. Build `crewQueue` = ordered list of IDs for crew **without** a profile
  5. If `crewQueue` is empty → call `/api/dispatch/crew-to-si` immediately
  6. If not empty → set `queueIndex = 0` and `editingCrewId = crewQueue[0]`
- On profile saved (`handleSaveCrewPersonality`):
  1. Advance `queueIndex`
  2. If more in queue → set `editingCrewId = crewQueue[queueIndex]`
  3. If queue exhausted → call `/api/dispatch/crew-to-si`, clear `editingCrewId`
- Skip flow:
  1. Editor's Skip button → sets `skipConfirm = crewId`
  2. Modal renders: "Skip [Name]? Incomplete data will still be sent to SayIntentions.AI."
  3. Yes → advance queue same as save (but don't persist a profile for skipped ID)
  4. No → clear `skipConfirm`, editor stays open for same crew member
- `siSendStatus` state: `idle | sending | sent | error`
  - Crew section heading shows: `✓ Sent to SI` (green) or `⚠ SI Error` (amber) badge
- **Test:** Load flight with all profiles saved → SI send fires immediately, badge shows "Sent". Delete one profile → reload → queue prompts for that one → save → SI fires. Test skip → confirm modal → SI fires with partial data

### Step 8 — End-to-End Test
- **New crew (all profiles missing):** Load a flight, walk Captain → FO → FA editors in sequence. After last save, SI sends. Verify badge shows "✓ Sent to SI"
- **All known crew:** Load same flight again. No editors open. SI sends immediately. Verify badge shows "✓ Sent to SI"
- **One new FA:** Load flight where one FA is new to the company. Only that FA's editor opens. After save, SI fires
- **Skip test:** Load flight with new FO. Open FO editor, click Skip. Confirm modal appears. Click No → editor stays. Click Skip again → Yes → advances. SI fires. Badge shows sent
- **VA key missing:** Remove `vaApiKey` from credentials. SI send should return a clear error and show "⚠ SI Error" badge, not crash

---

## Profile Schema (Target)

This is the unified schema for all profile types, stored in `%APPDATA%\KahunaAir\crews\{id}.json`:

```json
{
  "peopleId": "uuid-or-my-pilot",
  "name": "Display Name",
  "role": "Captain | First Officer | Flight Attendant",
  "isUserProfile": false,
  "oa": {
    "hours": 5247.3,
    "flights": 412,
    "companyId": "uuid"
  },
  "background": {
    "flightHours": 5247.3,
    "experienceLevel": "Senior Captain",
    "specialty": "...",
    "certifications": ["ATPL", "Type-rated on B737", "LOFT current"]
  },
  "personality": {
    "style": "...",
    "communicationPreference": "...",
    "humor": "...",
    "authorityLevel": "..."
  },
  "operationalPreferences": {
    "procedureStyle": "...",
    "crewInteraction": "..."
  },
  "cabinManagementPreferences": {
    "serviceStyle": "...",
    "passengerAnnouncements": "..."
  },
  "customNotes": "",
  "siApiKey": null,
  "lastUpdated": "2026-03-11T00:00:00.000Z",
  "createdAt": "2026-03-11T00:00:00.000Z"
}
```

Note: `operationalPreferences` applies to Captain/FO; `cabinManagementPreferences` applies to FAs. Fields not applicable to a role are omitted.

---

## Risk Notes

- **SI `va_api_key`**: ✅ Key is in hand — full end-to-end test is possible from Step 6 onwards on Day 1. Add it to credentials in Step 1.
- **Large `CrewProfileEditorV2.jsx`**: This will be the largest single component in the project. Use `multi_replace_string_in_file` for all edits after initial creation to avoid truncation issues.
- **Profile schema migration**: Existing saved profiles (6 JSON files in `data/crew-profiles/`) use the old schema. On load, `crewProfileManager.load()` should do a schema migration if `background` is missing.
