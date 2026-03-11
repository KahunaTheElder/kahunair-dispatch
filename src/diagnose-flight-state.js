/**
 * MSFS Flight State Diagnostic
 * Determines if the aircraft is actually in a flying state
 * and identifies why data isn't changing
 */

const { open, Protocol, SimConnectDataType, SimConnectPeriod, SimConnectConstants } = require('node-simconnect');

async function diagnoseFlightState() {
    console.log('🔍 MSFS Flight State Diagnostic\n');
    console.log('Checking aircraft state to determine why telemetry is not updating...\n');

    try {
        const recvOpen = await open('Flight Diagnostic', Protocol.KittyHawk);
        const handle = recvOpen.handle;

        console.log('✅ Connected to MSFS\n');

        // Check SIM_ON_GROUND variable
        console.log('📍 Checking aircraft position...');

        const DEF_ID = 0;
        const REQ_ID = 0;
        let receivedData = false;
        let onGround = null;
        let simRate = null;

        handle.on('simObjectData', (data) => {
            if (data.requestID === REQ_ID) {
                receivedData = true;
                const buf = data.data.getBuffer ? data.data.getBuffer() : data.data;

                // Read INT32 for SIM ON GROUND (0 = in air, 1 = on ground)
                // Read INT32 for SIM RATE (1 = normal, 0 = paused)
                if (buf.length >= 8) {
                    onGround = buf.readInt32LE(0);
                    simRate = buf.readInt32LE(4);

                    console.log(`  SIM ON GROUND: ${onGround === 1 ? '✓ ON GROUND' : onGround === 0 ? '✗ IN AIR' : '? Unknown'}`);
                    console.log(`  SIM RATE: ${simRate === 0 ? '⏸️  PAUSED' : simRate === 1 ? '▶️  RUNNING' : '? ' + simRate}\n`);
                }
            }
        });

        // Request SIM ON GROUND and SIM RATE
        handle.addToDataDefinition(DEF_ID, 'SIM ON GROUND', 'Bool', SimConnectDataType.INT32);
        handle.addToDataDefinition(DEF_ID, 'SIM RATE', 'Number', SimConnectDataType.INT32);

        handle.requestDataOnSimObject(
            REQ_ID,
            DEF_ID,
            SimConnectConstants.OBJECT_ID_USER,
            SimConnectPeriod.ONCE
        );

        // Wait for response
        await new Promise(resolve => setTimeout(resolve, 2000));

        if (receivedData) {
            console.log('💡 Diagnostic Results:\n');

            if (simRate === 0) {
                console.log('🛑 PROBLEM: Simulation is PAUSED');
                console.log('   ACTION REQUIRED:');
                console.log('   1. In MSFS, press ESC to return to flight');
                console.log('   2. Press ALT+P (or use menu) to unpause simulation');
                console.log('   3. Verify time is running (check clock bottom right)\n');
            }

            if (onGround === 1) {
                console.log('🛬 Aircraft is ON GROUND');
                console.log('   HINT: Telemetry will only show change if you:');
                console.log('   1. Advance throttle and start engines');
                console.log('   2. Taxi and take off');
                console.log('   3. Or load a flight already in the air (Free Flight → Advanced)\n');
            } else if (onGround === 0) {
                console.log('✈️  Aircraft is IN AIR');
                console.log('   But telemetry is still showing garbage - possible causes:');
                console.log('   1. MSFS window lost focus - click in MSFS to give it focus');
                console.log('   2. Aircraft is loading/initializing - wait 30 seconds');
                console.log('   3. Third-party aircraft has custom telemetry - need LVAR research');
                console.log('   4. SimConnect connection issue - restart MSFS\n');
            }

            console.log('🔧 Troubleshooting Steps:');
            console.log('   1. ✓ Verify aircraft is loaded (see 3D model in cockpit)');
            console.log('   2. ✓ Verify flight is active (clock advancing, instruments live)');
            console.log('   3. ✓ Verify simulation NOT paused (check status bar)');
            console.log('   4. ✓ Click in MSFS window to give it focus');
            console.log('   5. ✓ Try starting engines if on ground');
            console.log('   6. ✓ Take off or reload flight already in air\n');

        } else {
            console.log('❌ No diagnostic data received');
        }

        // Check what variables are actually accessible
        console.log('\n📊 Testing which variables are accessible:\n');

        const testVars = [
            { name: 'PLANE LATITUDE', units: 'Degrees' },
            { name: 'PLANE LONGITUDE', units: 'Degrees' },
            { name: 'PLANE ALTITUDE', units: 'Feet' },
            { name: 'VELOCITY WORLD X', units: 'Meters per second' },
            { name: 'VELOCITY WORLD Y', units: 'Meters per second' },
            { name: 'VELOCITY WORLD Z', units: 'Meters per second' }
        ];

        for (const variable of testVars) {
            try {
                const testDefId = 10 + testVars.indexOf(variable);
                handle.addToDataDefinition(testDefId, variable.name, variable.units, SimConnectDataType.FLOAT64);
                console.log(`  ✓ ${variable.name} [${variable.units}]`);
            } catch (e) {
                console.log(`  ✗ ${variable.name} - Error: ${e.message}`);
            }
        }

        handle.close();
        process.exit(0);

    } catch (error) {
        console.error('\n❌ Fatal error:', error.message);
        console.error('\nEnsure:');
        console.error('- MSFS 2024 is running');
        console.error('- An aircraft is loaded');
        console.error('- SimConnect is responding');
        process.exit(1);
    }
}

diagnoseFlightState();
