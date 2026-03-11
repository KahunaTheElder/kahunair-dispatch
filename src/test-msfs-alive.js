/**
 * Test if MSFS SimConnect is alive at all
 * Try to get ANY data (position, velocity, system state)
 */

const { open, Protocol, SimConnectDataType, SimConnectPeriod, SimConnectConstants } = require('node-simconnect');

async function testMSFSAlive() {
    console.log('🔍 Testing if MSFS SimConnect is alive and responding...\n');

    try {
        const recvOpen = await open('Status Check', Protocol.KittyHawk);
        const handle = recvOpen.handle;

        console.log(`✅ Connected to: ${recvOpen.applicationName}`);
        console.log(`   SimConnect version: ${recvOpen.applicationVersion}\n`);

        let responseCount = 0;
        const DEF_ID = 0;
        const REQ_ID = 0;

        handle.on('simObjectData', (data) => {
            if (data.requestID === REQ_ID) {
                responseCount++;
                const buf = data.data.getBuffer ? data.data.getBuffer() : data.data;

                // Try to parse as position data (3 doubles = 24 bytes)
                if (buf.length >= 24) {
                    try {
                        const lat = buf.readDoubleLE(0);
                        const lon = buf.readDoubleLE(8);
                        const alt = buf.readDoubleLE(16);

                        console.log(`📍 Position attempt (response #${responseCount}):`);
                        console.log(`   Latitude: ${lat} (valid range: -90 to 90)`);
                        console.log(`   Longitude: ${lon} (valid range: -180 to 180)`);
                        console.log(`   Altitude: ${alt} feet (valid range: 0 to 50000)`);

                        if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
                            console.log(`   ✅ VALID POSITION DATA RECEIVED!\n`);
                        } else {
                            console.log(`   ⚠️  Out of range - likely garbage\n`);
                        }
                    } catch (e) {
                        console.log(`   ❌ Error parsing: ${e.message}\n`);
                    }
                }
            }
        });

        // Try simple position request
        console.log('Trying to get PLANE LATITUDE/LONGITUDE/ALTITUDE...\n');

        handle.addToDataDefinition(
            DEF_ID,
            'PLANE LATITUDE',
            'Degrees',
            SimConnectDataType.FLOAT64
        );
        handle.addToDataDefinition(
            DEF_ID,
            'PLANE LONGITUDE',
            'Degrees',
            SimConnectDataType.FLOAT64
        );
        handle.addToDataDefinition(
            DEF_ID,
            'PLANE ALTITUDE',
            'Feet',
            SimConnectDataType.FLOAT64
        );

        console.log('Requesting position data (should be reliable)...');
        handle.requestDataOnSimObject(
            REQ_ID,
            DEF_ID,
            SimConnectConstants.OBJECT_ID_USER,
            SimConnectPeriod.ONCE
        );

        // Wait for responses
        let startTime = Date.now();
        while (Date.now() - startTime < 5000 && responseCount === 0) {
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        if (responseCount > 0) {
            console.log(`\n🟢 SUCCESS: MSFS is responding with data`);
            console.log(`   The aircraft exists and has a flight context`);
            console.log(`   Issue: Data values are still garbage/zero`);
            console.log(`\n   Possible causes:`);
            console.log(`   1. Aircraft type doesn't support standard SimVars`);
            console.log(`   2. MSFS needs focus/window activation`);
            console.log(`   3. Flight is paused or in unusual state`);
        } else {
            console.log(`\n🔴 FAILURE: No data received after 5 seconds`);
            console.log(`   Either:`);
            console.log(`   1. MSFS is not running with an active flight`);
            console.log(`   2. No aircraft is loaded`);
            console.log(`   3. SimConnect connection is one-way only`);
        }

        handle.close();
        process.exit(0);

    } catch (error) {
        console.error(`\n❌ Fatal error: ${error.message}`);
        console.error(`\nMake sure:`);
        console.error(`- MSFS 2024 is running`);
        console.error(`- A flight is loaded (not at menu)`);
        console.error(`- An aircraft is visible on screen`);
        process.exit(1);
    }
}

testMSFSAlive();
