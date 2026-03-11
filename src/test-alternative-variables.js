/**
 * Test alternative SimVars and LVARs to find available telemetry
 * When standard SimVars return garbage, we need to try LVAR-style names
 */

const { open, Protocol, SimConnectDataType, SimConnectPeriod, SimConnectConstants } = require('node-simconnect');

const DEF_ID = 0;
const REQ_ID = 0;

// Test multiple variable name combinations
const VARIABLE_SETS = [
    {
        name: "Standard SimVars (current)",
        vars: [
            { name: 'PLANE HEADING DEGREES TRUE', units: 'Radians' },
            { name: 'INDICATED ALTITUDE', units: 'Feet' },
            { name: 'AIRSPEED INDICATED', units: 'Knots' }
        ]
    },
    {
        name: "True Heading variations",
        vars: [
            { name: 'Plane Heading Degrees True', units: 'Radians' },
            { name: 'HEADING GYRO', units: 'Radians' },
            { name: 'PLANE HEADING DEGREES MAGNETIC', units: 'Radians' }
        ]
    },
    {
        name: "Altitude alternatives",
        vars: [
            { name: 'ALTITUDE', units: 'Feet' },
            { name: 'PLANE ALT ABOVE GROUND', units: 'Feet' },
            { name: 'INDICATED ALTITUDE:0', units: 'Feet' }
        ]
    },
    {
        name: "Airspeed alternatives",
        vars: [
            { name: 'AIRSPEED TRUE', units: 'Knots' },
            { name: 'AIRSPEED BARBER POLE', units: 'Knots' },
            { name: 'VELOCITY BODY Y', units: 'Feet per second' }
        ]
    },
    {
        name: "Simpler approach - just engine state",
        vars: [
            { name: 'ENG1 N1', units: 'Percent' },
            { name: 'GENERAL ENG THROTTLE LEVER POSITION:1', units: 'Percent' }
        ]
    }
];

async function testVariableSet(varSet) {
    console.log(`\n\n${'='.repeat(70)}`);
    console.log(`Testing: ${varSet.name}`);
    console.log(`${'='.repeat(70)}`);

    try {
        const recvOpen = await open(`Test-${varSet.name}`, Protocol.KittyHawk);
        const handle = recvOpen.handle;

        let dataReceived = false;
        const results = [];

        handle.on('simObjectData', (data) => {
            if (data.requestID === REQ_ID) {
                dataReceived = true;
                const buf = data.data.getBuffer ? data.data.getBuffer() : data.data;

                console.log(`✅ Data received! Buffer: ${buf.toString('hex')}`);
                results.push(buf.toString('hex'));
            }
        });

        // Clear any previous definition
        try {
            handle.clearDataDefinition(DEF_ID);
        } catch (e) {
            // ignore
        }

        // Add variables to definition
        for (const variable of varSet.vars) {
            try {
                handle.addToDataDefinition(
                    DEF_ID,
                    variable.name,
                    variable.units,
                    SimConnectDataType.FLOAT64
                );
                console.log(`  ✓ Added: "${variable.name}" [${variable.units}]`);
            } catch (e) {
                console.log(`  ✗ Failed to add: "${variable.name}" - ${e.message}`);
            }
        }

        // Request data
        console.log(`\nRequesting data...`);
        try {
            handle.requestDataOnSimObject(
                REQ_ID,
                DEF_ID,
                SimConnectConstants.OBJECT_ID_USER,
                SimConnectPeriod.ONCE
            );
        } catch (e) {
            console.log(`❌ Request failed: ${e.message}`);
        }

        // Wait for response
        await new Promise(resolve => setTimeout(resolve, 2000));

        if (dataReceived && results.length > 0) {
            console.log(`\n✅ SUCCESS: Got response with garbage data pattern:`);
            console.log(`   This variable set may need adjustment`);
        } else if (!dataReceived) {
            console.log(`\n⚠️  No response received - check variable names`);
        }

        handle.close();

    } catch (error) {
        console.error(`❌ Error: ${error.message}`);
    }
}

async function runTests() {
    console.log('Testing Multiple Variable Configurations');
    console.log('Make sure MSFS is running with an active 2+ hour flight\n');

    for (const varSet of VARIABLE_SETS) {
        await testVariableSet(varSet);
        // Small delay between tests
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`\n\n${'='.repeat(70)}`);
    console.log('Test Complete');
    console.log(`${'='.repeat(70)}`);
    console.log('\nRecommendations:');
    console.log('1. If all tests return garbage data, the variables themselves may be invalid');
    console.log('2. Try looking up variable names specific to your aircraft type');
    console.log('3. Consider using H:vars (premium addon feature) for more accurate data');
    console.log('4. Check MSFS community forums for aircraft-specific variable lists');

    process.exit(0);
}

runTests().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
