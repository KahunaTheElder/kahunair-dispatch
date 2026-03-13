/**
 * SimConnect Diagnostic — LVar vs SimVar comparison
 *
 * Polls the current JustFlight LVars alongside their standard SimVar equivalents
 * so we can verify they return matching values before migrating.
 *
 * Usage:  node src/simConnectDiag.js
 * Requires MSFS to be running with the JustFlight BAe 146 loaded.
 */

const { open, Protocol, SimConnectDataType, SimConnectPeriod, SimConnectConstants } = require('node-simconnect');

// Three separate data definitions
const DEF_LVARS   = 1;
const DEF_SIMVARS = 2;
const DEF_NAMES   = 3;  // string SimVars — separate definition required
const REQ_LVARS   = 1;
const REQ_SIMVARS = 2;
const REQ_NAMES   = 3;

// ── LVars currently in use ──────────────────────────────────────────────────
const LVARS = [
  { name: 'L:JF_RJ_FMC_LNAV_heading',        unit: 'Degrees',  label: 'Heading (deg)'       },
  { name: 'L:JF_RJ_ADC1_indicated_altitude',  unit: 'Feet',     label: 'Altitude (ft)'       },
  { name: 'L:JF_RJ_ADC1_airspeed_indicated',  unit: 'Knots',    label: 'IAS (kts)'           },
  { name: 'L:146_FuelWeight_LB',              unit: 'Pounds',   label: 'Fuel (lbs)*'         },
  { name: 'L:146_CargoWeight_LB',             unit: 'Pounds',   label: 'Cargo (lbs)*'        },
  { name: 'L:146_PaxQty',                     unit: 'Number',   label: 'Pax count'           },
  { name: 'L:146_PaxWeight_LB',               unit: 'Pounds',   label: 'Pax weight (lbs)'   },
];

// ── Standard SimVar candidates ───────────────────────────────────────────────
// Order must match LVARS 1-for-1 for the comparison table
const SIMVARS = [
  { name: 'PLANE HEADING DEGREES MAGNETIC',   unit: 'Degrees',  label: 'Heading (deg)'       },
  { name: 'INDICATED ALTITUDE',               unit: 'Feet',     label: 'Altitude (ft)'       },
  { name: 'AIRSPEED INDICATED',               unit: 'Knots',    label: 'IAS (kts)'           },
  { name: 'FUEL TOTAL QUANTITY WEIGHT',       unit: 'Pounds',   label: 'Fuel (lbs)'          },
  // Cargo: no universal SimVar for cargo weight alone.
  // Best approximation: total payload minus fuel vs empty weight
  // We'll use TOTAL WEIGHT - EMPTY WEIGHT - FUEL here, but read the three components:
  // For simplicity in this diagnostic, request TOTAL WEIGHT
  { name: 'TOTAL WEIGHT',                     unit: 'Pounds',   label: 'Total weight (lbs)'  },
  // Pax count: no universal SimVar. Request NUMBER OF ENGINES as a placeholder
  // to keep buffer alignment – this will show N/A in output
  { name: 'TOTAL WEIGHT',                     unit: 'Pounds',   label: '(no universal pax SimVar)' },
  // Pax weight: closest is PAYLOAD STATION WEIGHT:1 for station 1 (varies by aircraft)
  { name: 'EMPTY WEIGHT',                     unit: 'Pounds',   label: 'Empty weight (lbs)'  },
];

// Max stations to probe — SDK documents 15 as the hard maximum
// Note: JustFlight BAe 146 reports PAYLOAD STATION COUNT=18 but stations 15-18
// are "DO NOT ALTER" balance weights outside the normal payload range. Probing
// to 15 captures all genuinely useful pax/cargo/crew stations.
const MAX_STATIONS = 15;

// Extra SimVars to read for the derived cargo/pax calculation (appended after SIMVARS)
const EXTRA_SIMVARS = [
  { name: 'EMPTY WEIGHT',               unit: 'Pounds',  label: 'Empty weight'        },
  { name: 'FUEL TOTAL QUANTITY WEIGHT', unit: 'Pounds',  label: 'Fuel weight'         },
  { name: 'PAYLOAD STATION COUNT',      unit: 'Number',  label: 'Station count'       },
  // Payload stations 1–30
  ...Array.from({ length: MAX_STATIONS }, (_, i) => ({
    name: `PAYLOAD STATION WEIGHT:${i + 1}`,
    unit: 'Pounds',
    label: `Payload station ${i + 1}`
  })),
  // Additional SimVars that may be useful universally
  { name: 'PLANE ALT ABOVE GROUND',     unit: 'Feet',    label: 'Alt above ground'    },
  { name: 'SIM ON GROUND',              unit: 'Bool',    label: 'On ground'           },
  { name: 'NUMBER OF ENGINES',          unit: 'Number',  label: 'Engine count'        },
  { name: 'GENERAL ENG FUEL USED SINCE START:1', unit: 'Gallons', label: 'Fuel used eng 1' },
];

function readStrings(data, count, bytesPerString) {
  let buf = data.data;
  let offset = 0;

  if (typeof buf.readDoubleLE !== 'function') {
    if (buf.buffer && buf.buffer.buffer) {
      const raw = buf.buffer.buffer;
      buf = raw.data && Array.isArray(raw.data) ? Buffer.from(raw.data)
          : Buffer.isBuffer(raw)                ? raw
          : raw instanceof ArrayBuffer          ? Buffer.from(raw)
          : null;
      if (!buf) throw new Error('Cannot extract inner buffer');
      offset = 28;
    } else if (buf.buffer && buf.buffer instanceof ArrayBuffer) {
      offset = buf.byteOffset || 0;
      buf = Buffer.from(buf.buffer, offset, buf.byteLength);
      offset = 0;
    } else {
      throw new Error('Unknown buffer type');
    }
  }

  const strings = [];
  for (let i = 0; i < count; i++) {
    try {
      const slice = buf.slice(offset, offset + bytesPerString);
      const nullIdx = slice.indexOf(0);
      strings.push(slice.toString('ascii', 0, nullIdx >= 0 ? nullIdx : bytesPerString).trim());
    } catch {
      strings.push('');
    }
    offset += bytesPerString;
  }
  return strings;
}

function readDoubles(data, count) {
  let buf = data.data;
  let offset = 0;

  // Unwrap RawBuffer same way as simConnectService
  if (typeof buf.readDoubleLE !== 'function') {
    if (buf.buffer && buf.buffer.buffer) {
      const raw = buf.buffer.buffer;
      buf = raw.data && Array.isArray(raw.data) ? Buffer.from(raw.data)
          : Buffer.isBuffer(raw)                ? raw
          : raw instanceof ArrayBuffer          ? Buffer.from(raw)
          : null;
      if (!buf) throw new Error('Cannot extract inner buffer');
      offset = 28; // SimConnect 28-byte header
    } else if (buf.buffer && buf.buffer instanceof ArrayBuffer) {
      offset = buf.byteOffset || 0;
      buf = Buffer.from(buf.buffer, offset, buf.byteLength);
      offset = 0;
    } else {
      throw new Error('Unknown buffer type: ' + Object.prototype.toString.call(buf));
    }
  }

  const values = [];
  for (let i = 0; i < count; i++) {
    try {
      values.push(buf.readDoubleLE(offset));
    } catch {
      values.push(NaN);
    }
    offset += 8;
  }
  return values;
}

function fmt(v, decimals = 1) {
  if (v === undefined || v === null || isNaN(v)) return '    ---';
  return v.toFixed(decimals).padStart(10);
}

async function run() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║         SimConnect LVar vs SimVar Diagnostic                 ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  console.log('Connecting to MSFS...');

  let handle;
  try {
    const { handle: h } = await open('KahunaAir Diag', Protocol.KittyHawk);
    handle = h;
    console.log('✓ Connected\n');
  } catch (e) {
    console.error('✗ Could not connect to SimConnect:', e.message);
    console.error('  → Make sure MSFS is running with the JF BAe 146 loaded.');
    process.exit(1);
  }

  // Register LVars definition
  let lvarRegErrors = 0;
  for (const v of LVARS) {
    try {
      handle.addToDataDefinition(DEF_LVARS, v.name, v.unit, SimConnectDataType.FLOAT64);
    } catch (e) {
      console.warn(`  ⚠ LVar register failed: ${v.name} — ${e.message}`);
      lvarRegErrors++;
    }
  }

  // Register SimVars definition
  for (const v of [...SIMVARS, ...EXTRA_SIMVARS]) {
    try {
      handle.addToDataDefinition(DEF_SIMVARS, v.name, v.unit, SimConnectDataType.FLOAT64);
    } catch (e) {
      console.warn(`  ⚠ SimVar register failed: ${v.name} — ${e.message}`);
    }
  }

  // Register station NAME string definition — must be separate from numeric defs
  for (let i = 1; i <= MAX_STATIONS; i++) {
    try {
      handle.addToDataDefinition(DEF_NAMES, `PAYLOAD STATION NAME:${i}`, null, SimConnectDataType.STRING32);
    } catch (e) {
      console.warn(`  ⚠ Name register failed: PAYLOAD STATION NAME:${i} — ${e.message}`);
    }
  }

  let lvarValues   = null;
  let simvarValues = null;
  let stationNames = null;

  handle.on('simObjectData', (data) => {
    if (data.requestID === REQ_LVARS) {
      try { lvarValues = readDoubles(data, LVARS.length); }
      catch (e) { console.error('Error reading LVar buffer:', e.message); lvarValues = []; }
    }
    if (data.requestID === REQ_SIMVARS) {
      try { simvarValues = readDoubles(data, SIMVARS.length + EXTRA_SIMVARS.length); }
      catch (e) { console.error('Error reading SimVar buffer:', e.message); simvarValues = []; }
    }
    if (data.requestID === REQ_NAMES) {
      try { stationNames = readStrings(data, MAX_STATIONS, 32); }
      catch (e) { console.error('Error reading Names buffer:', e.message); stationNames = []; }
    }

    if (lvarValues && simvarValues && stationNames) {
      printResults(lvarValues, simvarValues, stationNames);
      handle.close();
      process.exit(0);
    }
  });

  handle.on('exception', (ex) => {
    console.error('SimConnect exception:', JSON.stringify(ex));
  });

  // Request all three in one shot
  handle.requestDataOnSimObject(REQ_LVARS,   DEF_LVARS,   SimConnectConstants.OBJECT_ID_USER, SimConnectPeriod.ONCE, 0, 0, 0, 0);
  handle.requestDataOnSimObject(REQ_SIMVARS, DEF_SIMVARS, SimConnectConstants.OBJECT_ID_USER, SimConnectPeriod.ONCE, 0, 0, 0, 0);
  handle.requestDataOnSimObject(REQ_NAMES,   DEF_NAMES,   SimConnectConstants.OBJECT_ID_USER, SimConnectPeriod.ONCE, 0, 0, 0, 0);

  // Timeout if no data received
  setTimeout(() => {
    console.error('\n✗ Timed out waiting for SimConnect data (10s).');
    console.error('  → Is MSFS running and in a flight session with aircraft loaded?');
    handle.close();
    process.exit(1);
  }, 10000);
}

function printResults(lvars, simvars, stationNames) {
  const SEP = '─'.repeat(72);

  // ── Extra SimVar index map ──────────────────────────────────────────────
  // EXTRA_SIMVARS layout (offset from simvars[SIMVARS.length]):
  //   [0]       = EMPTY WEIGHT
  //   [1]       = FUEL TOTAL QTY WEIGHT
  //   [2]       = PAYLOAD STATION COUNT
  //   [3..32]   = PAYLOAD STATION WEIGHT:1..30
  //   [33]      = PLANE ALT ABOVE GROUND
  //   [34]      = SIM ON GROUND
  //   [35]      = NUMBER OF ENGINES
  //   [36]      = GENERAL ENG FUEL USED SINCE START:1
  const extra = simvars.slice(SIMVARS.length);
  const emptyWeight    = extra[0];
  const fuelSimVar     = extra[1];
  const stationCount   = Math.round(extra[2]) || 0;
  const stations       = Array.from({ length: MAX_STATIONS }, (_, i) => extra[3 + i]);
  const altAboveGround = extra[3 + MAX_STATIONS];
  const onGround       = extra[4 + MAX_STATIONS];
  const engineCount    = extra[5 + MAX_STATIONS];
  const fuelUsedEng1   = extra[6 + MAX_STATIONS];

  const totalWeight    = simvars[4];           // slot 4 in SIMVARS = TOTAL WEIGHT
  const payloadDerived = totalWeight - emptyWeight - fuelSimVar;

  // Sum all non-zero stations
  const nonZeroStations = stations
    .map((w, i) => ({ idx: i + 1, w }))
    .filter(s => !isNaN(s.w) && s.w > 0.5);  // ignore floating-point noise
  const stationTotal = nonZeroStations.reduce((sum, s) => sum + s.w, 0);

  // ── LVar vs SimVar comparison table ────────────────────────────────────
  console.log('\n' + SEP);
  console.log('LVAR vs SIMVAR COMPARISON (current LVar → standard SimVar candidate)');
  console.log(SEP);
  console.log('Metric'.padEnd(26) + 'LVar value'.padStart(14) + 'SimVar value'.padStart(14) + '  Match?');
  console.log(SEP);

  const rows = [
    { label: 'Heading (deg)',       lv: lvars[0], sv: simvars[0], tol: 5 },
    { label: 'Altitude (ft)',       lv: lvars[1], sv: simvars[1], tol: 50 },
    { label: 'IAS (kts)',           lv: lvars[2], sv: simvars[2], tol: 2 },
    { label: 'Fuel (LVar raw/2.2)', lv: lvars[3] / 2.20462, sv: fuelSimVar, tol: 5 },
    { label: 'Cargo (LVar raw/2.2)',lv: lvars[4] / 2.20462, sv: null, note: `vs derived payload: ${isNaN(payloadDerived)?'---':payloadDerived.toFixed(1)} lbs` },
    { label: 'Pax count',           lv: lvars[5], sv: null, note: '(no universal SimVar for pax count)' },
    { label: 'Pax weight (lbs)',    lv: lvars[6], sv: null, note: `total station wt: ${stationTotal.toFixed(1)} lbs (${nonZeroStations.length} stations)` },
  ];

  for (const r of rows) {
    const lStr = fmt(r.lv);
    const sStr = r.sv != null ? fmt(r.sv) : '       N/A';
    let match;
    if (r.note) {
      match = `  → ${r.note}`;
    } else if (isNaN(r.lv) || isNaN(r.sv)) {
      match = '  ✗ one/both NaN';
    } else if (Math.abs(r.lv - r.sv) <= r.tol) {
      match = '  ✓';
    } else if (Math.abs(r.lv - r.sv) <= r.tol * 5) {
      match = `  ~ diff ${(r.sv - r.lv).toFixed(1)}`;
    } else {
      match = `  ✗ MISMATCH diff ${(r.sv - r.lv).toFixed(0)}`;
    }
    console.log(r.label.padEnd(26) + lStr + sStr + match);
  }

  // ── Aircraft/weight summary ─────────────────────────────────────────────
  console.log('\n' + SEP);
  console.log('WEIGHT & STATION BREAKDOWN');
  console.log(SEP);
  console.log(`  TOTAL WEIGHT            :${fmt(totalWeight)} lbs`);
  console.log(`  EMPTY WEIGHT            :${fmt(emptyWeight)} lbs`);
  console.log(`  FUEL (SimVar)           :${fmt(fuelSimVar)} lbs`);
  console.log(`  Derived payload (T-E-F) :${fmt(payloadDerived)} lbs  ← universal cargo+pax proxy`);
  console.log(`  PAYLOAD STATION COUNT   :${fmt(stationCount, 0)} (SimConnect-reported)`);
  console.log(`  Non-zero stations total :${fmt(stationTotal)} lbs  across ${nonZeroStations.length} active stations`);
  console.log('');
  console.log('  Active payload stations:');
  if (nonZeroStations.length === 0) {
    console.log('    (none — aircraft may be empty or on ground with no payload loaded)');
  } else {
    for (const s of nonZeroStations) {
      const name = (stationNames && stationNames[s.idx - 1]) || '';
      const nameStr = name ? `  "${name}"` : '';
      console.log(`    Station ${String(s.idx).padStart(2)}  :${fmt(s.w)} lbs${nameStr}`);
    }
  }

  // ── Station name classification summary ─────────────────────────────────
  if (stationNames) {
    const uniqueNames = [...new Set(stationNames.filter(n => n))].sort();
    if (uniqueNames.length > 0) {
      console.log('');
      console.log('  All distinct station names reported by SimConnect:');
      for (const n of uniqueNames) {
        const matching = stationNames
          .map((name, i) => ({ name, idx: i + 1, w: stations[i] }))
          .filter(s => s.name === n);
        const wStr = matching.map(s => `stn ${s.idx} = ${isNaN(s.w) ? '---' : s.w.toFixed(1)} lbs`).join(', ');
        console.log(`    "${n}"  →  ${wStr}`);
      }
    }
  }
  // ── Passenger weight extrapolation ─────────────────────────────────────
  console.log('\n' + SEP);
  console.log('PASSENGER WEIGHT EXTRAPOLATION');
  console.log(SEP);
  // Classify each named station
  const PAX_RE   = /zone|pax|passenger|seat|cabin|row/i;
  const CARGO_RE = /cargo|freight|baggage|bag|hold/i;
  const CREW_RE  = /pilot|crew|attendant|steward|purser/i;
  const SKIP_RE  = /do not alter|ballast|fuel|structural/i;

  const classified = stations.map((w, i) => {
    const name = (stationNames && stationNames[i]) || '';
    const weight = isNaN(w) ? 0 : w;
    let cat = 'unknown';
    if (!name || SKIP_RE.test(name))   cat = 'skip';
    else if (CARGO_RE.test(name))       cat = 'cargo';
    else if (CREW_RE.test(name))        cat = 'crew';
    else if (PAX_RE.test(name))         cat = 'pax';
    return { idx: i + 1, name, weight, cat };
  }).filter(s => s.weight > 0.5);

  const paxStations   = classified.filter(s => s.cat === 'pax');
  const cargoStations = classified.filter(s => s.cat === 'cargo');
  const crewStations  = classified.filter(s => s.cat === 'crew');
  const skipStations  = classified.filter(s => s.cat === 'skip');

  const paxTotalWeight   = paxStations.reduce((a, s) => a + s.weight, 0);
  const cargoTotalWeight = cargoStations.reduce((a, s) => a + s.weight, 0);
  const crewTotalWeight  = crewStations.reduce((a, s) => a + s.weight, 0);

  // Known pax count from LVar — used to derive per-pax weight
  const knownPaxCount = lvars[5];  // L:146_PaxQty
  const perPaxWeight  = (knownPaxCount > 0) ? paxTotalWeight / knownPaxCount : NaN;

  // Find the smallest non-zero station weight among pax stations — likely = 1 pax
  const minPaxStationWeight = paxStations.reduce((min, s) => Math.min(min, s.weight), Infinity);
  // Round per-pax weight to nearest 5 lbs for a clean number
  const perPaxRounded = Math.round(perPaxWeight / 5) * 5;

  console.log(`  Station classification:`);
  console.log(`    Pax   stations: ${paxStations.map(s => `stn ${s.idx} "${s.name}" ${s.weight.toFixed(1)} lbs`).join(', ')}`);
  console.log(`    Cargo stations: ${cargoStations.map(s => `stn ${s.idx} "${s.name}" ${s.weight.toFixed(1)} lbs`).join(', ')}`);
  console.log(`    Crew  stations: ${crewStations.map(s => `stn ${s.idx} "${s.name}" ${s.weight.toFixed(1)} lbs`).join(', ')}`);
  console.log(`    Skip  stations: ${skipStations.map(s => `stn ${s.idx} "${s.name}"(${s.weight.toFixed(0)} lbs)`).join(', ')}`);
  console.log('');
  console.log(`  Pax station total weight   :${fmt(paxTotalWeight)} lbs`);
  console.log(`  Known pax count (LVar)     : ${knownPaxCount}`);
  console.log(`  → Per-pax weight (derived) :${fmt(perPaxWeight)} lbs  (rounded: ${perPaxRounded} lbs)`);
  console.log(`  → Smallest pax-station wt  :${fmt(minPaxStationWeight)} lbs  (= ${(minPaxStationWeight / perPaxRounded).toFixed(1)} pax at ${perPaxRounded} lbs/pax)`);
  console.log('');
  console.log(`  Cargo weight (sum cargo stations) :${fmt(cargoTotalWeight)} lbs`);
  console.log(`  Crew weight  (sum crew stations)  :${fmt(crewTotalWeight)} lbs`);
  console.log('');

  if (!isNaN(perPaxRounded) && perPaxRounded > 0) {
    console.log('  Per-station pax count back-calculation:');
    for (const s of paxStations) {
      const derivedCount = Math.round(s.weight / perPaxRounded);
      const check = Math.abs(s.weight - derivedCount * perPaxRounded) < 1 ? '✓' : `⚠ residual ${(s.weight - derivedCount * perPaxRounded).toFixed(1)} lbs`;
      console.log(`    Stn ${String(s.idx).padStart(2)}  "${s.name}"  ${s.weight.toFixed(1)} lbs  → ${derivedCount} pax  ${check}`);
    }
    const derivedTotal = paxStations.reduce((sum, s) => sum + Math.round(s.weight / perPaxRounded), 0);
    console.log(`  → Derived total pax count: ${derivedTotal}  (LVar says: ${knownPaxCount})`);
    console.log(`  → Match: ${derivedTotal === Math.round(knownPaxCount) ? '✓ EXACT' : `✗ off by ${derivedTotal - Math.round(knownPaxCount)}`}`);
  }
  // ── Aircraft context ────────────────────────────────────────────────────
  console.log('\n' + SEP);
  console.log('AIRCRAFT CONTEXT');
  console.log(SEP);
  console.log(`  On ground               : ${onGround > 0.5 ? 'YES' : 'NO'}`);
  console.log(`  Alt above ground        :${fmt(altAboveGround)} ft`);
  console.log(`  Number of engines       :${fmt(engineCount, 0)}`);
  console.log(`  Fuel used eng 1 (gal)   :${fmt(fuelUsedEng1, 1)}`);

  // ── LVar raw correction note ────────────────────────────────────────────
  console.log('\n' + SEP);
  console.log('NOTES');
  console.log(SEP);
  console.log('  * L:146_FuelWeight_LB and L:146_CargoWeight_LB return KG despite unit=Pounds.');
  console.log('    Corrected above by dividing raw LVar value by 2.20462.');
  console.log(`    Fuel  raw LVar:${fmt(lvars[3])} KG  → corrected:${fmt(lvars[3] / 2.20462)} lbs`);
  console.log(`    Cargo raw LVar:${fmt(lvars[4])} KG  → corrected:${fmt(lvars[4] / 2.20462)} lbs`);
  console.log(`    FUEL TOTAL QTY WEIGHT SimVar:${fmt(fuelSimVar)} lbs`);
  console.log('');
  console.log('  PAYLOAD STATION WEIGHT:n is aircraft-model-defined (varies by aircraft).');
  console.log('  The derived payload (TOTAL-EMPTY-FUEL) is aircraft-agnostic and reliable.');
  console.log('  Pax count has no universal SimVar equivalent.');
  console.log('');
}

run().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
