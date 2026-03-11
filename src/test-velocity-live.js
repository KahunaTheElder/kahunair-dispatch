/**
 * Test velocity data directly
 * This will tell us if the aircraft data connection is actually live
 * Velocity should change if aircraft is moving
 */

const { open, Protocol, SimConnectDataType, SimConnectPeriod, SimConnectConstants } = require('node-simconnect');

async function testVelocity() {
    console.log('🚀 Testing VELOCITY data (fundamental aircraft movement)\n');
    console.log('If these values change, aircraft data is live and we need LVAR approach\n');

    try {
        const recvOpen = await open('Velocity Test', Protocol.KittyHawk);
        const handle = recvOpen.handle;

        const DEF_ID = 0;
        const REQ_ID = 0;
        const samples = [];

        handle.on('simObjectData', (data) => {
            if (data.requestID === REQ_ID) {
                const buf = data.data.getBuffer ? data.data.getBuffer() : data.data;

                if (buf.length >= 24) {
                    const velX = buf.readDoubleLE(0);
                    const velY = buf.readDoubleLE(8);
                    const velZ = buf.readDoubleLE(16);

                    samples.push({ velX, velY, velZ });

                    const sample = samples.length;
                    console.log(`Sample ${sample}: X=${velX.toFixed(3)} Y=${velY.toFixed(3)} Z=${velZ.toFixed(3)}`);
                }
            }
        });

        console.log('📝 Requesting: VELOCITY WORLD X/Y/Z\n');

        handle.addToDataDefinition(DEF_ID, 'VELOCITY WORLD X', 'Meters per second', SimConnectDataType.FLOAT64);
        handle.addToDataDefinition(DEF_ID, 'VELOCITY WORLD Y', 'Meters per second', SimConnectDataType.FLOAT64);
        handle.addToDataDefinition(DEF_ID, 'VELOCITY WORLD Z', 'Meters per second', SimConnectDataType.FLOAT64);

        console.log('Collecting 5 samples at 2-second intervals...\n');

        for (let i = 0; i < 5; i++) {
            handle.requestDataOnSimObject(
                REQ_ID,
                DEF_ID,
                SimConnectConstants.OBJECT_ID_USER,
                SimConnectPeriod.ONCE
            );
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        // Analyze
        console.log('\n📊 Analysis:\n');

        if (samples.length === 0) {
            console.log('❌ No data received');
        } else {
            const allIdentical = samples.every(s =>
                s.velX === samples[0].velX &&
                s.velY === samples[0].velY &&
                s.velZ === samples[0].velZ
            );

            if (allIdentical) {
                console.log('⚠️  All velocity samples are IDENTICAL');
                console.log('   This means SimConnect is returning the SAME data every time');
                console.log('   NOT updating with actual aircraft velocity\n');

                if (samples[0].velX === 0 && samples[0].velY === 0 && samples[0].velZ === 0) {
                    console.log('   All zeros = aircraft not moving (parked/idle)');
                } else {
                    console.log('   Non-zero but static = SimConnect issue or aircraft not moving');
                }
            } else {
                console.log('✅ VALUES ARE CHANGING!');
                console.log('   This proves SimConnect IS transmitting live aircraft data');
                console.log('   Issue: The HEADING/ALTITUDE/AIRSPEED variables aren\'t the right ones');
                console.log('   Solution: Must use RJ-100 specific LVARs\n');
            }

            // Calculate velocity magnitude
            const firstVel = Math.sqrt(
                samples[0].velX ** 2 +
                samples[0].velY ** 2 +
                samples[0].velZ ** 2
            );
            const lastVel = Math.sqrt(
                samples[samples.length - 1].velX ** 2 +
                samples[samples.length - 1].velY ** 2 +
                samples[samples.length - 1].velZ ** 2
            );

            console.log(`First velocity magnitude: ${firstVel.toFixed(2)} m/s`);
            console.log(`Last velocity magnitude: ${lastVel.toFixed(2)} m/s`);

            // Convert to knots for reference
            const knotsFirst = firstVel * 1.94384; // m/s to knots
            const knotsLast = lastVel * 1.94384;
            console.log(`First velocity: ${knotsFirst.toFixed(1)} knots`);
            console.log(`Last velocity: ${knotsLast.toFixed(1)} knots`);
        }

        handle.close();
        process.exit(0);

    } catch (error) {
        console.error('\n❌ Error:', error.message);
        process.exit(1);
    }
}

testVelocity();
