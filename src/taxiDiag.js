/**
 * TAXI BIAS DIAGNOSTIC — SimConnect Facility API
 *
 * Fetches EGLL's complete taxi graph (TAXI_POINT, TAXI_PATH, TAXI_NAME,
 * TAXI_PARKING) from SimConnect and prints gate coordinates under four
 * BIAS_X / BIAS_Z axis-orientation hypotheses.
 *
 * Purpose: Determine the correct BIAS → lat/lon conversion so we can
 * cross-reference SI taxi_path waypoints with SimConnect taxiway node names.
 *
 * Usage:   node src/taxiDiag.js
 * Requires MSFS running with SimConnect enabled.
 *
 * Method:
 *   1. Pick a gate from the printed table
 *   2. Start a flight positioned at that exact gate in MSFS
 *   3. Observe the live GPS readout at the bottom of this terminal
 *   4. Match those GPS coords against the H_A / H_B / H_C / H_D columns
 *      to identify which bias-axis interpretation is correct
 *   5. Report back — that interpretation becomes the production formula
 */

'use strict';

const path = require('path');
const fs = require('fs');

const {
    open, Protocol, SimConnectDataType, SimConnectPeriod, SimConnectConstants,
    FacilityDataType,
} = require('node-simconnect');

// ── SimConnect definition / request IDs ──────────────────────────────────────
const DEF_FACILITY = 1;
const DEF_GPS = 2;
const REQ_FACILITY = 1;
const REQ_GPS = 2;

const AIRPORT_ICAO = 'EGLL';

// ── Lookup tables (from SimConnect SDK docs) ──────────────────────────────────
const PARK_TYPE_NAMES = [
    'NONE', 'RAMP_GA', 'RAMP_GA_SMALL', 'RAMP_GA_MEDIUM', 'RAMP_GA_LARGE',
    'RAMP_CARGO', 'RAMP_MIL_CARGO', 'RAMP_MIL_COMBAT',
    'GATE_SMALL', 'GATE_MEDIUM', 'GATE_HEAVY',
    'DOCK_GA', 'FUEL', 'VEHICLE', 'RAMP_GA_EXTRA', 'GATE_EXTRA',
];

const PARK_NAME_ENUMS = [
    'NONE', 'PARKING', 'N_PARKING', 'NE_PARKING', 'E_PARKING',
    'SE_PARKING', 'S_PARKING', 'SW_PARKING', 'W_PARKING', 'NW_PARKING',
    'GATE', 'DOCK',
    'GATE_A', 'GATE_B', 'GATE_C', 'GATE_D', 'GATE_E', 'GATE_F',
    'GATE_G', 'GATE_H', 'GATE_I', 'GATE_J', 'GATE_K', 'GATE_L',
    'GATE_M', 'GATE_N', 'GATE_O', 'GATE_P', 'GATE_Q', 'GATE_R',
    'GATE_S', 'GATE_T', 'GATE_U', 'GATE_V', 'GATE_W', 'GATE_X',
    'GATE_Y', 'GATE_Z',
];

// Sort priority for PARK_TYPE — gates first, then ramps, then others
const TYPE_PRIORITY = { 10: 0, 15: 1, 9: 2, 8: 3, 11: 4, 4: 5, 3: 6, 1: 7 };

// ── Bias → lat/lon under four axis hypotheses ─────────────────────────────────
//
//  The SimConnect SDK doc describes:
//    BIAS_X = "bias from airport reference along the longitudinal axis"
//    BIAS_Z = "bias from airport reference along the latitudinal axis"
//  Axis orientation is undocumented — we test four candidates below.
//
//  H_A: Z = north (+), X = east (+)   ← most common 3D-world convention
//  H_B: Z = south (+), X = east (+)
//  H_C: X = north (+), Z = east (+)   ← swapped (longitudinal = along runway?)
//  H_D: X = south (+), Z = east (+)
//
function biasToLatLon(airLat, airLon, biasX, biasZ) {
    const cosLat = Math.cos(airLat * Math.PI / 180);
    const mPerDegLat = 111111;
    const mPerDegLon = 111111 * cosLat;
    return {
        hA: { lat: airLat + biasZ / mPerDegLat, lon: airLon + biasX / mPerDegLon },
        hB: { lat: airLat - biasZ / mPerDegLat, lon: airLon + biasX / mPerDegLon },
        hC: { lat: airLat + biasX / mPerDegLat, lon: airLon + biasZ / mPerDegLon },
        hD: { lat: airLat - biasX / mPerDegLat, lon: airLon + biasZ / mPerDegLon },
    };
}

function fmt(v, dp = 6) { return v >= 0 ? ` ${v.toFixed(dp)}` : v.toFixed(dp); }
function fmtCoord(lat, lon) { return `${fmt(lat)}°N ${fmt(lon)}°E`; }

// ── State ─────────────────────────────────────────────────────────────────────
let airportRef = null;
const parkings = [];
const taxiPoints = [];
const taxiPaths = [];
const taxiNames = [];

let gpsLat = null, gpsLon = null;
let facilityDone = false;
let handle = null;

// ── Entry point ───────────────────────────────────────────────────────────────
async function main() {
    console.log(`\n${'═'.repeat(72)}`);
    console.log(` EGLL Taxi Bias Diagnostic — SimConnect Facility API`);
    console.log(`${'═'.repeat(72)}\n`);
    console.log(' Connecting to SimConnect...');

    let recvOpen;
    try {
        recvOpen = await open('TaxiDiag', Protocol.KittyHawk);
    } catch (err) {
        console.error(` ✗ Connection failed: ${err?.message || err}`);
        console.error('   Make sure MSFS is running before starting this diagnostic.');
        process.exit(1);
    }

    handle = recvOpen.handle;
    console.log(` ✓ Connected to ${recvOpen.applicationName}\n`);

    // ── Event handlers ─────────────────────────────────────────────────────
    handle.on('simObjectData', handleGpsData);
    handle.on('facilityData', handleFacilityData);
    handle.on('facilityDataEnd', handleFacilityDataEnd);
    handle.on('exception', (e) => console.error('\n[SimConnect exception]', JSON.stringify(e)));
    handle.on('quit', () => { console.log('\n[SimConnect] Simulator closed.'); process.exit(0); });
    handle.on('close', () => { console.log('\n[SimConnect] Connection closed.'); process.exit(0); });

    // ── GPS polling definition ─────────────────────────────────────────────
    handle.addToDataDefinition(DEF_GPS, 'GPS POSITION LAT', 'Degrees', SimConnectDataType.FLOAT64);
    handle.addToDataDefinition(DEF_GPS, 'GPS POSITION LON', 'Degrees', SimConnectDataType.FLOAT64);
    handle.requestDataOnSimObject(
        REQ_GPS, DEF_GPS,
        SimConnectConstants.OBJECT_ID_USER,
        SimConnectPeriod.SECOND, 0, 0, 0, 0
    );

    // ── Build EGLL facility data definition ───────────────────────────────
    //
    //  OPEN/CLOSE brackets must match exactly.
    //  Fields within each entity are read back in this exact order.
    //
    handle.addToFacilityDefinition(DEF_FACILITY, 'OPEN AIRPORT');
    handle.addToFacilityDefinition(DEF_FACILITY, 'LATITUDE');         // FLOAT64
    handle.addToFacilityDefinition(DEF_FACILITY, 'LONGITUDE');        // FLOAT64

    // TAXI_PARKING — gate/ramp positions (bias relative to airport ARP)
    handle.addToFacilityDefinition(DEF_FACILITY, 'OPEN TAXI_PARKING');
    handle.addToFacilityDefinition(DEF_FACILITY, 'TYPE');             // INT32  (PARK_TYPE_NAMES index)
    handle.addToFacilityDefinition(DEF_FACILITY, 'NAME');             // INT32  (PARK_NAME_ENUMS index)
    handle.addToFacilityDefinition(DEF_FACILITY, 'SUFFIX');           // INT32  (same enum as NAME)
    handle.addToFacilityDefinition(DEF_FACILITY, 'NUMBER');           // UINT32 (sequential number)
    handle.addToFacilityDefinition(DEF_FACILITY, 'HEADING');          // FLOAT32 (degrees true)
    handle.addToFacilityDefinition(DEF_FACILITY, 'RADIUS');           // FLOAT32 (meters)
    handle.addToFacilityDefinition(DEF_FACILITY, 'BIAS_X');           // FLOAT32 (meters from ARP)
    handle.addToFacilityDefinition(DEF_FACILITY, 'BIAS_Z');           // FLOAT32 (meters from ARP)
    handle.addToFacilityDefinition(DEF_FACILITY, 'CLOSE TAXI_PARKING');

    // TAXI_POINT — graph nodes (intersections, gate entrances)
    // These are what SI's taxi_path lat/lon waypoints correspond to
    handle.addToFacilityDefinition(DEF_FACILITY, 'OPEN TAXI_POINT');
    handle.addToFacilityDefinition(DEF_FACILITY, 'TYPE');             // INT32
    handle.addToFacilityDefinition(DEF_FACILITY, 'BIAS_X');          // FLOAT32
    handle.addToFacilityDefinition(DEF_FACILITY, 'BIAS_Z');          // FLOAT32
    handle.addToFacilityDefinition(DEF_FACILITY, 'CLOSE TAXI_POINT');

    // TAXI_PATH — graph edges (segments between nodes)
    handle.addToFacilityDefinition(DEF_FACILITY, 'OPEN TAXI_PATH');
    handle.addToFacilityDefinition(DEF_FACILITY, 'START');            // INT32  (TAXI_POINT index)
    handle.addToFacilityDefinition(DEF_FACILITY, 'END');              // INT32  (TAXI_POINT index)
    handle.addToFacilityDefinition(DEF_FACILITY, 'NAME_INDEX');       // UINT32 (→ TAXI_NAME lookup)
    handle.addToFacilityDefinition(DEF_FACILITY, 'CLOSE TAXI_PATH');

    // TAXI_NAME — taxiway labels ("A", "B", "J4", etc.)
    handle.addToFacilityDefinition(DEF_FACILITY, 'OPEN TAXI_NAME');
    handle.addToFacilityDefinition(DEF_FACILITY, 'NAME');             // STRING32
    handle.addToFacilityDefinition(DEF_FACILITY, 'CLOSE TAXI_NAME');

    handle.addToFacilityDefinition(DEF_FACILITY, 'CLOSE AIRPORT');

    console.log(` Requesting ${AIRPORT_ICAO} facility data — this may take a few seconds...`);
    handle.requestFacilityData(DEF_FACILITY, REQ_FACILITY, AIRPORT_ICAO);
}

// ── GPS handler ───────────────────────────────────────────────────────────────
function handleGpsData(data) {
    if (data.requestID !== REQ_GPS) return;
    try {
        // Extract the underlying Node.js Buffer from node-simconnect's RawBuffer wrapper
        let buf = data.data;
        let offset = 28; // SimConnect prepends a 28-byte header before field data
        if (buf && buf.buffer && buf.buffer.buffer) {
            const raw = buf.buffer.buffer;
            if (raw.data && Array.isArray(raw.data)) {
                buf = Buffer.from(raw.data);
            } else if (Buffer.isBuffer(raw)) {
                buf = raw;
            } else if (raw instanceof ArrayBuffer) {
                buf = Buffer.from(raw);
            } else { return; }
        } else { return; }

        gpsLat = buf.readDoubleLE(offset);
        gpsLon = buf.readDoubleLE(offset + 8);

        if (facilityDone) {
            process.stdout.write(
                `\r  [GPS]  ${gpsLat.toFixed(6)}°N   ${gpsLon.toFixed(6)}°E   `
            );
        }
    } catch (_e) { /* silent — GPS optional */ }
}

// ── Facility-data event handler ───────────────────────────────────────────────
// recv.data is a RawBuffer, position already advanced past the 7-int header
// inside RecvFacilityData constructor. Read fields in exact definition order.
function handleFacilityData(recv) {
    const buf = recv.data;
    try {
        switch (recv.type) {

            case FacilityDataType.AIRPORT: {
                airportRef = {
                    lat: buf.readFloat64(),
                    lon: buf.readFloat64(),
                };
                break;
            }

            case FacilityDataType.TAXI_PARKING: {
                const type = buf.readInt32();
                const nameEnum = buf.readInt32();
                const suffix = buf.readInt32();
                const number = buf.readUint32();
                const heading = buf.readFloat32();
                const radius = buf.readFloat32();
                const biasX = buf.readFloat32();
                const biasZ = buf.readFloat32();
                parkings.push({
                    idx: recv.itemIndex,
                    type, nameEnum, suffix, number,
                    heading, radius, biasX, biasZ,
                });
                break;
            }

            case FacilityDataType.TAXI_POINT: {
                const type = buf.readInt32();
                const biasX = buf.readFloat32();
                const biasZ = buf.readFloat32();
                taxiPoints.push({ idx: recv.itemIndex, type, biasX, biasZ });
                break;
            }

            case FacilityDataType.TAXI_PATH: {
                const start = buf.readInt32();
                const end = buf.readInt32();
                const nameIndex = buf.readUint32();
                taxiPaths.push({ idx: recv.itemIndex, start, end, nameIndex });
                break;
            }

            case FacilityDataType.TAXI_NAME: {
                // STRING32 — RawBuffer reads 32 bytes, strip null padding
                const raw = buf.readString32();
                const name = raw.replace(/\0/g, '').trim();
                taxiNames.push({ idx: recv.itemIndex, name });
                break;
            }
        }
    } catch (e) {
        console.error(`\n[facilityData] Parse error for type ${recv.type} idx ${recv.itemIndex}: ${e.message}`);
    }
}

// ── Facility data complete ────────────────────────────────────────────────────
function handleFacilityDataEnd(recv) {
    if (recv.userRequestId !== REQ_FACILITY) return;

    console.log(` ✓ Facility data received.\n`);
    printResults();
    saveJson();
    facilityDone = true;

    console.log('\n' + '─'.repeat(72));
    console.log(' Live aircraft GPS (1 Hz, Ctrl+C to exit):');
    console.log('─'.repeat(72));
    if (gpsLat !== null) {
        console.log(`  [GPS]  ${gpsLat.toFixed(6)}°N   ${gpsLon.toFixed(6)}°E`);
    } else {
        console.log('  Waiting for GPS fix...');
    }
}

// ── Print results ─────────────────────────────────────────────────────────────
function printResults() {
    if (!airportRef) {
        console.error(' ✗ No airport reference data received.');
        return;
    }

    const { lat: airLat, lon: airLon } = airportRef;
    const hr = '═'.repeat(72);
    const div = '─'.repeat(72);

    console.log(hr);
    console.log(` ${AIRPORT_ICAO} — SimConnect Facility Data`);
    console.log(hr);
    console.log(` Airport Reference (ARP):  ${fmt(airLat)}°N   ${fmt(airLon)}°E`);
    console.log('');
    console.log(' Taxi Graph Summary:');
    console.log(`   TAXI_POINTS : ${String(taxiPoints.length).padStart(4)}  (graph nodes — intersections & gate entrances)`);
    console.log(`   TAXI_PATHS  : ${String(taxiPaths.length).padStart(4)}  (graph edges — runway/taxiway segments)`);
    console.log(`   TAXI_NAMES  : ${String(taxiNames.length).padStart(4)}  (taxiway labels used by NAME_INDEX in each path)`);
    console.log(`   PARKING     : ${String(parkings.length).padStart(4)}  (ramps, gates, cargo spots)`);

    // ── Taxi Names ────────────────────────────────────────────────────────
    if (taxiNames.length > 0) {
        console.log('\n' + hr);
        console.log(' TAXI NAMES  (NAME_INDEX → taxiway label)');
        console.log(div);
        const cols = 8;
        for (let i = 0; i < taxiNames.length; i += cols) {
            const row = taxiNames.slice(i, i + cols)
                .map(n => `[${String(n.idx).padStart(3)}] ${(n.name || '""').padEnd(6)}`)
                .join('  ');
            console.log('  ' + row);
        }
    }

    // ── Parking spots ────────────────────────────────────────────────────
    console.log('\n' + hr);
    console.log(' PARKING SPOTS  (bias → lat/lon under four axis hypotheses)');
    console.log('');
    console.log('  H_A: biasZ = north (+),  biasX = east (+)   ← most common 3D world convention');
    console.log('  H_B: biasZ = south (+),  biasX = east (+)');
    console.log('  H_C: biasX = north (+),  biasZ = east (+)   ← longitudinal = runway-aligned?');
    console.log('  H_D: biasX = south (+),  biasZ = east (+)');
    console.log(div);

    // Sort: GATE_HEAVY first, then by type priority, then by item index
    const sorted = [...parkings].sort((a, b) => {
        const pa = TYPE_PRIORITY[a.type] ?? 99;
        const pb = TYPE_PRIORITY[b.type] ?? 99;
        return pa !== pb ? pa - pb : a.idx - b.idx;
    });

    // Show up to 60 spots
    const display = sorted.slice(0, 60);

    const header =
        'Idx   Type           Name-Num   Hdg°  ' +
        'BIAS_X(m)   BIAS_Z(m)  │  H_A lat/lon                │  H_B lat/lon                │  H_C lat/lon                │  H_D lat/lon';
    console.log('  ' + header);
    console.log('  ' + '─'.repeat(header.length));

    let suggestion = null;

    for (const p of display) {
        const typeName = PARK_TYPE_NAMES[p.type] || `TYPE_${p.type}`;
        const nameStr = PARK_NAME_ENUMS[p.nameEnum] || `NAME_${p.nameEnum}`;
        const sfxStr = p.suffix > 0 ? `/${PARK_NAME_ENUMS[p.suffix] || p.suffix}` : '';
        const label = `${nameStr}${sfxStr} #${p.number}`;
        const { hA, hB, hC, hD } = biasToLatLon(airLat, airLon, p.biasX, p.biasZ);

        // Pick first GATE_HEAVY as the test suggestion
        if (!suggestion && p.type === 10) suggestion = { p, hA, hB, hC, hD };

        const row = [
            String(p.idx).padStart(3),
            typeName.padEnd(14),
            label.padEnd(12),
            p.heading.toFixed(1).padStart(5),
            (p.biasX >= 0 ? '+' : '') + p.biasX.toFixed(1).padStart(10),
            (p.biasZ >= 0 ? '+' : '') + p.biasZ.toFixed(1).padStart(10),
            '│',
            `${fmt(hA.lat)}  ${fmt(hA.lon)}`,
            '│',
            `${fmt(hB.lat)}  ${fmt(hB.lon)}`,
            '│',
            `${fmt(hC.lat)}  ${fmt(hC.lon)}`,
            '│',
            `${fmt(hD.lat)}  ${fmt(hD.lon)}`,
        ].join('  ');
        console.log('  ' + row);
    }

    if (sorted.length > display.length) {
        console.log(`  ... (${sorted.length - display.length} more spots — see taxiDiag_EGLL.json for full list)`);
    }

    // ── Test suggestion ───────────────────────────────────────────────────
    if (suggestion) {
        const { p, hA, hB, hC, hD } = suggestion;
        const typeName = PARK_TYPE_NAMES[p.type] || `TYPE_${p.type}`;
        const nameStr = PARK_NAME_ENUMS[p.nameEnum] || p.nameEnum;
        const sfxStr = p.suffix > 0 ? `/${PARK_NAME_ENUMS[p.suffix] || p.suffix}` : '';
        console.log('\n' + hr);
        console.log(' ★  RECOMMENDED TEST GATE');
        console.log(div);
        console.log(`    Idx    : ${p.idx}`);
        console.log(`    Type   : ${typeName}`);
        console.log(`    Name   : ${nameStr}${sfxStr} #${p.number}`);
        console.log(`    Heading: ${p.heading.toFixed(1)}°   Radius: ${p.radius.toFixed(1)} m`);
        console.log(`    BIAS_X : ${p.biasX >= 0 ? '+' : ''}${p.biasX.toFixed(2)} m`);
        console.log(`    BIAS_Z : ${p.biasZ >= 0 ? '+' : ''}${p.biasZ.toFixed(2)} m`);
        console.log('');
        console.log(`    Predicted position by hypothesis:`);
        console.log(`      H_A → ${fmtCoord(hA.lat, hA.lon)}`);
        console.log(`      H_B → ${fmtCoord(hB.lat, hB.lon)}`);
        console.log(`      H_C → ${fmtCoord(hC.lat, hC.lon)}`);
        console.log(`      H_D → ${fmtCoord(hD.lat, hD.lon)}`);
        console.log('');
        console.log('    ► Start a flight at this gate, then compare your GPS coordinates above.');
        console.log('      Tell me which column (H_A / H_B / H_C / H_D) matches your actual position.');
        console.log(hr);
    }
}

// ── Save full dataset to JSON ─────────────────────────────────────────────────
function saveJson() {
    const outDir = path.join(__dirname, '..', 'logs');
    const outFile = path.join(outDir, `taxiDiag_${AIRPORT_ICAO}.json`);

    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    // Enrich parkings with decoded name strings and all 4 hypothesis coords
    const { lat: airLat, lon: airLon } = airportRef;
    const enrichedParkings = parkings.map(p => ({
        ...p,
        typeName: PARK_TYPE_NAMES[p.type] || `TYPE_${p.type}`,
        nameLabel: PARK_NAME_ENUMS[p.nameEnum] || `NAME_${p.nameEnum}`,
        sufLabel: p.suffix > 0 ? (PARK_NAME_ENUMS[p.suffix] || p.suffix) : '',
        ...biasToLatLon(airLat, airLon, p.biasX, p.biasZ),
    }));

    const output = {
        generated: new Date().toISOString(),
        airport: { icao: AIRPORT_ICAO, ...airportRef },
        counts: {
            taxiPoints: taxiPoints.length,
            taxiPaths: taxiPaths.length,
            taxiNames: taxiNames.length,
            parkings: parkings.length,
        },
        taxiNames,
        parkings: enrichedParkings,
        taxiPoints,
        taxiPaths,
    };

    fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
    console.log(`\n Full dataset saved → ${outFile}`);
}

// ── Run ───────────────────────────────────────────────────────────────────────
main().catch(err => {
    console.error('\n[taxiDiag] Fatal:', err?.message || err);
    process.exit(1);
});
