/**
 * LVAR Enumeration Tool for JustFlight Avro Professional RJ-100
 * 
 * LVARs (Local Variables) are aircraft-specific variables stored in the aircraft systems.
 * We can enumerate them by attempting to access known LVAR naming patterns.
 * 
 * Common JustFlight LVAR patterns:
 * - JF_*_* (JustFlight specific)
 * - A:* (simvar accessed as LVAR in some contexts)
 * - L:* (pure LVAR namespace in some aircraft)
 */

const { open, Protocol, SimConnectDataType, SimConnectPeriod, SimConnectConstants } = require('node-simconnect');

// Common LVAR patterns and names seen in RJ-100 and similar turboprops
const COMMON_LVARS = [
    // JustFlight naming
    'JF_RJ100_HEADING',
    'JF_RJ100_ALTITUDE',
    'JF_RJ100_AIRSPEED',

    // Generic turboprop LVARs
    'SIM_AIRCRAFT_HEADING',
    'SIM_FLIGHT_ALTITUDE',
    'SIM_AIRSPEED',
    'SIM_GROUNDSPEED',

    // Engine-related (turboprop)
    'PROP_RPM_1',
    'ENG_N1_PERCENT_1',
    'ENG_FUEL_FLOW_PPH_1',

    // Navigation
    'NAV_ACTIVE_FREQ_1',
    'NAV_STANDBY_FREQ_1',
    'COM_ACTIVE_FREQ_1',

    // Waypoint/Navigation
    'NEXT_WPT_ID',
    'NEXT_WPT_DISTANCE',
    'NEXT_WPT_BEARING',
    'NEXT_WPT_ETE_MINS',

    // Aircraft state
    'GEAR_DOWN',
    'LANDING_LIGHTS_ON',
    'STROBE_LIGHTS_ON',
    'NAV_LIGHTS_ON',

    // Autopilot (common in turboprops)
    'AUTOPILOT_ENABLED',
    'AUTOPILOT_HEADING_LOCK',
    'AUTOPILOT_ALTITUDE_LOCK',
];

async function discoverLVARs() {
    console.log('🔍 LVAR Discovery Tool for JustFlight Avro Professional RJ-100\n');
    console.log('Attempting to detect available Local Variables (LVARs)...\n');

    try {
        const recvOpen = await open('LVAR Discovery', Protocol.KittyHawk);
        const handle = recvOpen.handle;

        const discoveredLVARs = {};
        let requestCount = 0;
        const maxRequests = 50; // Limit to reasonable number

        // Set up listener for client data
        handle.on('clientData', (data) => {
            if (data.data) {
                const buf = data.data.getBuffer ? data.data.getBuffer() : data.data;
                discoveredLVARs[data.defineID] = {
                    buffer: buf.toString('hex'),
                    length: buf.length,
                    value: buf.length >= 8 ? buf.readDoubleLE(0) : 'N/A'
                };
                console.log(`✓ Got data from LVAR ${data.defineID}: ${buf.toString('hex').slice(0, 16)}...`);
            }
        });

        // Try to enumerate through registry patterns
        // In MSFS, LVARs are often accessed using specific naming conventions
        console.log('Testing known LVAR patterns:\n');

        for (let i = 0; i < Math.min(COMMON_LVARS.length, maxRequests); i++) {
            const lvarName = COMMON_LVARS[i];
            const defId = i;

            try {
                // This is the key: mapClientDataNameToID maps LVAR names to IDs
                const result = handle.mapClientDataNameToID(lvarName, defId);
                console.log(`  → Mapped: ${lvarName} (DefID: ${defId})`);

                // Create client data definition
                // We'll add one FLOAT64 field to read the value
                handle.addToClientDataDefinition(
                    defId,
                    0,                           // offset in buffer
                    SimConnectDataType.FLOAT64,  // or INT32, STRING, etc.
                    0.0,                         // epsilon
                    defId                        // datum ID
                );

                requestCount++;
            } catch (e) {
                // LVAR doesn't exist or not accessible
                console.log(`  ✗ Failed: ${lvarName} - ${e.message}`);
            }
        }

        console.log(`\n📤 Sending requests for ${requestCount} potential LVARs...\n`);

        // Request all client data in parallel
        for (let i = 0; i < Math.min(COMMON_LVARS.length, maxRequests); i++) {
            try {
                handle.requestClientData(
                    i,                                 // clientDataId (using index as ID)
                    i,                                 // dataRequestId
                    i,                                 // clientDataDefinitionId
                    0,                                 // period (once)
                    0                                  // flags
                );
            } catch (e) {
                // Request failed - LVAR doesn't exist
            }
        }

        // Wait for responses
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Analyze results
        console.log('\n' + '='.repeat(70));
        console.log('📊 LVAR Discovery Results:');
        console.log('='.repeat(70) + '\n');

        if (Object.keys(discoveredLVARs).length > 0) {
            console.log(`✅ Found ${Object.keys(discoveredLVARs).length} responsive LVARs:\n`);
            Object.entries(discoveredLVARs).forEach(([defId, data]) => {
                const lvarName = COMMON_LVARS[defId] || `LVAR_${defId}`;
                console.log(`  ${lvarName}:`);
                console.log(`    Value: ${data.value}`);
                console.log(`    Buffer: ${data.buffer}`);
                console.log();
            });
        } else {
            console.log('⚠️  No LVARs responded to discovery queries.\n');
            console.log('This could mean:');
            console.log('1. The Avro RJ-100 uses different LVAR naming');
            console.log('2. LVARs are protected/read-only');
            console.log('3. Aircraft requires special access method\n');
        }

        // Try alternative approach: use enum method if available
        console.log('\n' + '='.repeat(70));
        console.log('🔧 Trying alternative enumeration method...');
        console.log('='.repeat(70) + '\n');

        // Check if handle has enumeration methods
        console.log('Available methods on handle:');
        const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(handle))
            .filter(m => m.includes('enum') || m.includes('Enum'));

        if (methods.length > 0) {
            console.log('Found enumeration methods:', methods);
        } else {
            console.log('No enumeration methods found on handle');
        }

        console.log('\n💡 Recommendations:');
        console.log('1. Check JustFlight documentation for custom LVAR list');
        console.log('2. Look for aircraft .lua files in Community folder');
        console.log('3. Use SimConnect Spy utility to monitor LVAR names');
        console.log('4. Check MSFS forums for RJ-100 telemetry integration');

        handle.close();
        process.exit(0);

    } catch (error) {
        console.error('\n❌ Error during LVAR discovery:', error.message);
        console.error('\nTroubleshooting:');
        console.error('- Ensure MSFS 2024 is running');
        console.error('- Ensure JustFlight Avro RJ-100 is loaded and in flight');
        console.error('- Check that SimConnect is responding (it is if you see "Successfully connected")');
        process.exit(1);
    }
}

discoverLVARs();
