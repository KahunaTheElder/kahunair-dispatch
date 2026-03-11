/**
 * Test basic SimConnect variable retrieval
 * Verifies that variable names are correct and MSFS is sending data
 */

const { open, Protocol, SimConnectDataType, SimConnectPeriod, SimConnectConstants } = require('node-simconnect');
const logger = require('./logger');

const DEF_ID = 0;
const REQ_ID = 0;

async function testVariables() {
    console.log('🧪 Testing SimConnect variable retrieval...');
    console.log('Make sure MSFS 2024 is running with an active flight loaded.\n');

    try {
        // Connect to MSFS
        console.log('📡 Connecting to MSFS...');
        const recvOpen = await open('SimConnect Test', Protocol.KittyHawk);
        const handle = recvOpen.handle;
        console.log(`✅ Connected: ${recvOpen.applicationName}\n`);

        // Track received data
        let dataReceived = false;
        const samples = [];

        // Listen for data
        handle.on('simObjectData', (data) => {
            if (data.requestID === REQ_ID) {
                dataReceived = true;
                const buf = data.data.getBuffer ? data.data.getBuffer() : data.data;

                console.log(`\n📊 Data received! Buffer size: ${buf.length} bytes`);
                console.log(`     Hex: ${buf.toString('hex')}`);

                // Try to read as FLOAT64 values
                if (buf.length >= 24) {
                    try {
                        const val1 = buf.readDoubleLE(0);
                        const val2 = buf.readDoubleLE(8);
                        const val3 = buf.readDoubleLE(16);

                        console.log(`     Val1: ${val1} (expect radians 0-6.28)`);
                        console.log(`     Val2: ${val2} (expect feet 0-50000)`);
                        console.log(`     Val3: ${val3} (expect knots 0-500)`);

                        samples.push({ val1, val2, val3 });
                    } catch (e) {
                        console.log(`     ❌ Error reading values: ${e.message}`);
                    }
                }
            }
        });

        // Define data (core 3 variables)
        console.log('📝 Defining data variables...');
        try {
            handle.addToDataDefinition(
                DEF_ID,
                'PLANE HEADING DEGREES TRUE',
                'Radians',
                SimConnectDataType.FLOAT64
            );
            handle.addToDataDefinition(
                DEF_ID,
                'INDICATED ALTITUDE',
                'Feet',
                SimConnectDataType.FLOAT64
            );
            handle.addToDataDefinition(
                DEF_ID,
                'AIRSPEED INDICATED',
                'Knots',
                SimConnectDataType.FLOAT64
            );
            console.log('✅ Data definitions registered\n');
        } catch (e) {
            console.log(`❌ Error defining data: ${e.message}\n`);
            return;
        }

        // Request data 5 times
        console.log('📤 Requesting telemetry data (5 samples, 2-second intervals)...\n');
        for (let i = 0; i < 5; i++) {
            console.log(`⏱️  Request ${i + 1}/5...`);
            try {
                handle.requestDataOnSimObject(
                    REQ_ID,
                    DEF_ID,
                    SimConnectConstants.OBJECT_ID_USER,
                    SimConnectPeriod.ONCE
                );
            } catch (e) {
                console.log(`   ❌ Request failed: ${e.message}`);
            }

            // Wait 2 seconds before next request
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        // Analyze results
        console.log('\n📈 Analysis:');
        if (!dataReceived) {
            console.log('❌ NO DATA RECEIVED from MSFS');
            console.log('   Possible causes:');
            console.log('   - MSFS window not in focus?');
            console.log('   - No active flight loaded?');
            console.log('   - Variable names incorrect for MSFS 2024?');
            console.log('   - SimConnect not running?');
        } else if (samples.length > 0) {
            // Check if values are realistic
            let allZero = samples.every(s => s.val2 === 0);
            let allSame = samples.every(s => s.val1 === samples[0].val1);

            if (allZero && allSame) {
                console.log('⚠️  All samples identical and zero - likely no active flight');
                console.log('   Recommendations:');
                console.log('   1. Load a flight in MSFS (via Free Flight or IFR menu)');
                console.log('   2. Click in MSFS window to give it focus');
                console.log('   3. Verify aircraft is actually loaded (see 3D model)');
            } else if (samples.some(s => s.val1 > 0.001 && s.val1 < 6.28 && s.val2 > 0 && s.val2 < 50000)) {
                console.log('✅ VALID DATA RECEIVED!');
                console.log('   Your MSFS connection is working properly');
                console.log('   Variables and units are correct');
            } else {
                console.log('⚠️  Data received but values out of expected range');
                console.log('   May need to adjust variable names or units');
            }
        }

        handle.close();
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Fatal error:', error.message);
        console.error('\nMake sure:');
        console.error('- MSFS 2024 is running');
        console.error('- Flight is loaded (not at menu/hangar)');
        console.error('- Aircraft is positioned (on runway or in air)');
        process.exit(1);
    }
}

testVariables();
