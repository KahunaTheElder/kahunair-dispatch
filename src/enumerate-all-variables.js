/**
 * Comprehensive SimVar and LVAR Enumerator
 * 
 * This tool systematically tests hundreds of known SimVar and LVAR names
 * to find which ones are actually available on the JustFlight RJ-100.
 * 
 * Usage: node src/enumerate-all-variables.js
 * Compare output against Lorby's Axis & Ohs to identify variable names
 */

const { open, Protocol, SimConnectDataType, SimConnectPeriod, SimConnectConstants } = require('node-simconnect');
const fs = require('fs');
const path = require('path');

const logFile = path.join('logs', 'variable-enumeration.log');

// Clear previous log
try {
    fs.writeFileSync(logFile, '');
} catch (e) {
    // ignore
}

function log(msg) {
    const timestamp = new Date().toISOString();
    const fullMsg = `[${timestamp}] ${msg}`;
    console.log(fullMsg);
    try {
        fs.appendFileSync(logFile, fullMsg + '\n');
    } catch (e) {
        // Ignore write errors
    }
}

// Comprehensive list of common SimVars and LVAR patterns
const VARIABLES_TO_TEST = [
    // === Standard Flight Data ===
    { name: 'PLANE HEADING DEGREES TRUE', units: 'Radians', type: 'FLOAT64' },
    { name: 'PLANE HEADING DEGREES MAGNETIC', units: 'Radians', type: 'FLOAT64' },
    { name: 'HEADING GYRO', units: 'Radians', type: 'FLOAT64' },
    { name: 'INDICATED ALTITUDE', units: 'Feet', type: 'FLOAT64' },
    { name: 'ALTITUDE', units: 'Feet', type: 'FLOAT64' },
    { name: 'PLANE ALTITUDE', units: 'Feet', type: 'FLOAT64' },
    { name: 'AIRSPEED INDICATED', units: 'Knots', type: 'FLOAT64' },
    { name: 'AIRSPEED TRUE', units: 'Knots', type: 'FLOAT64' },
    { name: 'AIRSPEED BARBER POLE', units: 'Knots', type: 'FLOAT64' },
    { name: 'VERTICAL SPEED', units: 'Feet per second', type: 'FLOAT64' },
    { name: 'VERTICAL SPEED NEEDLE', units: 'Feet per second', type: 'FLOAT64' },

    // === Position Data ===
    { name: 'PLANE LATITUDE', units: 'Degrees', type: 'FLOAT64' },
    { name: 'PLANE LONGITUDE', units: 'Degrees', type: 'FLOAT64' },
    { name: 'PLANE ALT ABOVE GROUND', units: 'Feet', type: 'FLOAT64' },
    { name: 'SIM ON GROUND', units: 'Bool', type: 'INT32' },

    // === Velocity ===
    { name: 'VELOCITY WORLD X', units: 'Meters per second', type: 'FLOAT64' },
    { name: 'VELOCITY WORLD Y', units: 'Meters per second', type: 'FLOAT64' },
    { name: 'VELOCITY WORLD Z', units: 'Meters per second', type: 'FLOAT64' },

    // === Engine Data (Turboprop) ===
    { name: 'ENG1 N1', units: 'Percent', type: 'FLOAT64' },
    { name: 'ENG2 N1', units: 'Percent', type: 'FLOAT64' },
    { name: 'ENG1 N2', units: 'Percent', type: 'FLOAT64' },
    { name: 'ENG1 POWER LEVER POSITION', units: 'Percent', type: 'FLOAT64' },
    { name: 'ENG1 PROPELLER LEVER POSITION', units: 'Percent', type: 'FLOAT64' },
    { name: 'ENG1 FUEL FLOW PPH', units: 'Pounds per hour', type: 'FLOAT64' },
    { name: 'ENG1 TORQUE', units: 'Foot pounds', type: 'FLOAT64' },

    // === Trim Settings ===
    { name: 'ELEVATOR TRIM POSITION', units: 'Radians', type: 'FLOAT64' },
    { name: 'AILERON TRIM', units: 'Radians', type: 'FLOAT64' },
    { name: 'RUDDER TRIM', units: 'Radians', type: 'FLOAT64' },

    // === Flight Surface Positions ===
    { name: 'FLAPS HANDLE INDEX', units: 'Number', type: 'INT32' },
    { name: 'GEAR HANDLE POSITION', units: 'Bool', type: 'INT32' },
    { name: 'SPOILERS HANDLE POSITION', units: 'Percent', type: 'FLOAT64' },
    { name: 'LEADING EDGE FLAPS LEFT PERCENT', units: 'Percent', type: 'FLOAT64' },

    // === Navigation ===
    { name: 'GPS WP NEXT ID', units: 'String', type: 'STRING' },
    { name: 'GPS WP NEXT DISTANCE', units: 'Meters', type: 'FLOAT64' },
    { name: 'GPS WP NEXT BEARING', units: 'Degrees', type: 'FLOAT64' },
    { name: 'GPS WP NEXT ETE', units: 'Seconds', type: 'FLOAT64' },

    // === Transponder ===
    { name: 'TRANSPONDER CODE:1', units: 'Number', type: 'INT32' },
    { name: 'TRANSPONDER IDENT:1', units: 'Bool', type: 'INT32' },

    // === Lights ===
    { name: 'STROBE LIGHT', units: 'Bool', type: 'INT32' },
    { name: 'LANDING LIGHT', units: 'Bool', type: 'INT32' },
    { name: 'TAXI LIGHT', units: 'Bool', type: 'INT32' },
    { name: 'NAV LIGHTS', units: 'Bool', type: 'INT32' },
    { name: 'BEACON LIGHTS', units: 'Bool', type: 'INT32' },

    // === Autopilot ===
    { name: 'AUTOPILOT MASTER', units: 'Bool', type: 'INT32' },
    { name: 'AUTOPILOT HEADING LOCK', units: 'Bool', type: 'INT32' },
    { name: 'AUTOPILOT ALTITUDE LOCK', units: 'Bool', type: 'INT32' },
    { name: 'AUTOPILOT APPROACH HOLD', units: 'Bool', type: 'INT32' },

    // === Controls ===
    { name: 'YOKE X POSITION', units: 'Percent', type: 'FLOAT64' },
    { name: 'YOKE Y POSITION', units: 'Percent', type: 'FLOAT64' },
    { name: 'RUDDER PEDAL POSITION', units: 'Percent', type: 'FLOAT64' },
    { name: 'THROTTLE LOWER LIMIT', units: 'Percent', type: 'FLOAT64' },

    // === JustFlight Specific LVARs (hypothesis) ===
    { name: 'JF_RJ100_HEADING', units: 'Degrees', type: 'FLOAT64' },
    { name: 'JF_RJ100_ALTITUDE', units: 'Feet', type: 'FLOAT64' },
    { name: 'JF_RJ100_AIRSPEED', units: 'Knots', type: 'FLOAT64' },
    { name: 'JF_RJ100_VERTICAL_SPEED', units: 'FPM', type: 'FLOAT64' },
    { name: 'JF_RJ100_NAV_DISTANCE', units: 'NM', type: 'FLOAT64' },
    { name: 'JF_RJ100_NAV_ETE', units: 'Minutes', type: 'FLOAT64' },
    { name: 'JF_RJ100_NAV_ID', units: 'String', type: 'STRING' },

    // === Generic LVAR patterns ===
    { name: 'RJ_HEADING', units: 'Degrees', type: 'FLOAT64' },
    { name: 'RJ_ALTITUDE', units: 'Feet', type: 'FLOAT64' },
    { name: 'RJ_AIRSPEED', units: 'Knots', type: 'FLOAT64' },
    { name: 'AIRCRAFT_HEADING', units: 'Degrees', type: 'FLOAT64' },
    { name: 'AIRCRAFT_ALTITUDE', units: 'Feet', type: 'FLOAT64' },
];

async function enumerateVariables() {
    log('🔍 COMPREHENSIVE SIMVAR/LVAR ENUMERATOR');
    log('Testing ' + VARIABLES_TO_TEST.length + ' common variables\n');

    try {
        const recvOpen = await open('Variable Enumerator', Protocol.KittyHawk);
        const handle = recvOpen.handle;

        log('✅ Connected to MSFS\n');

        const results = {};
        let successCount = 0;
        let testCount = 0;

        // Test each variable
        for (let i = 0; i < VARIABLES_TO_TEST.length; i++) {
            const variable = VARIABLES_TO_TEST[i];
            const defId = i;
            testCount++;

            try {
                // Map data type
                let dataType;
                switch (variable.type) {
                    case 'FLOAT64': dataType = SimConnectDataType.FLOAT64; break;
                    case 'INT32': dataType = SimConnectDataType.INT32; break;
                    case 'STRING': dataType = SimConnectDataType.STRING256; break;
                    default: dataType = SimConnectDataType.FLOAT64;
                }

                // Add to definition
                handle.addToDataDefinition(
                    defId,
                    variable.name,
                    variable.units,
                    dataType
                );

                // Try to request it
                handle.requestDataOnSimObject(
                    defId,
                    defId,
                    SimConnectConstants.OBJECT_ID_USER,
                    SimConnectPeriod.ONCE
                );

                results[defId] = {
                    name: variable.name,
                    units: variable.units,
                    type: variable.type,
                    found: false,
                    value: null,
                    hex: null
                };

            } catch (e) {
                // Variable doesn't exist or error
                results[defId] = {
                    name: variable.name,
                    units: variable.units,
                    type: variable.type,
                    found: false,
                    error: e.message
                };
            }
        }

        // Listen for responses
        let responseCount = 0;
        handle.on('simObjectData', (data) => {
            const defId = data.defineID;
            if (results[defId]) {
                responseCount++;
                const buf = data.data.getBuffer ? data.data.getBuffer() : data.data;

                try {
                    let value = null;
                    if (buf.length >= 8) {
                        // Try to read as different types
                        if (results[defId].type === 'FLOAT64') {
                            value = buf.readDoubleLE(0);
                        } else if (results[defId].type === 'INT32') {
                            value = buf.readInt32LE(0);
                        } else if (results[defId].type === 'STRING') {
                            // String - try to read null-terminated
                            value = buf.toString('utf8', 0, buf.indexOf(0) || buf.length);
                        }
                    }

                    results[defId].found = true;
                    results[defId].value = value;
                    results[defId].hex = buf.toString('hex', 0, Math.min(16, buf.length));
                } catch (e) {
                    results[defId].found = false;
                    results[defId].error = e.message;
                }
            }
        });

        // Wait for responses
        log('📤 Sent ' + testCount + ' variable requests');
        log('⏳ Waiting for responses (5 seconds)...\n');
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Output results
        log('\n' + '='.repeat(80));
        log('📊 VARIABLE ENUMERATION RESULTS');
        log('='.repeat(80) + '\n');

        const found = Object.entries(results).filter(([_, r]) => r.found);
        const notFound = Object.entries(results).filter(([_, r]) => !r.found);

        log(`✅ FOUND: ${found.length}/${testCount} variables responded\n`);

        if (found.length > 0) {
            log('RESPONSIVE VARIABLES:\n');
            found.forEach(([defId, result]) => {
                log(`  ${result.name}`);
                log(`    Units: ${result.units}`);
                log(`    Value: ${result.value !== null ? result.value : 'N/A'}`);
                log(`    Hex: ${result.hex}`);
                log('');
            });

            // Save results to JSON for analysis
            const jsonFile = path.join('logs', 'enumeration-results.json');
            fs.writeFileSync(jsonFile, JSON.stringify(found, null, 2));
            log(`\n📁 Results saved to: ${jsonFile}\n`);
        } else {
            log('❌ No variables responded\n');
        }

        log('NON-RESPONSIVE VARIABLES (first 20):\n');
        notFound.slice(0, 20).forEach(([defId, result]) => {
            log(`  ✗ ${result.name}`);
        });

        if (notFound.length > 20) {
            log(`  ... and ${notFound.length - 20} more\n`);
        }

        // Instructions
        log('\n' + '='.repeat(80));
        log('📋 NEXT STEPS');
        log('='.repeat(80) + '\n');

        log('1. Open Lorby\'s Axis & Ohs in MSFS');
        log('2. Look for variables matching the "RESPONSIVE VARIABLES" above');
        log('3. Check their values against what Lorby\'s shows');
        log('4. Note any patterns (esp. heading, altitude, airspeed values)');
        log('5. Share variable names that match current flight state\n');

        log('💾 Full results saved to:');
        log(`   - Text log: ${logFile}`);
        log(`   - JSON data: logs/enumeration-results.json\n`);

        handle.close();
        process.exit(0);

    } catch (error) {
        log('\n❌ Fatal error: ' + error.message);
        process.exit(1);
    }
}

log('Starting enumeration - ensure MSFS window is focused with active flight\n');
setTimeout(enumerateVariables, 1000);
