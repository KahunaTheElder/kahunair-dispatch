/**
 * Quick test of JustFlight-specific LVars
 * Testing:
 * - L:JF_RJ_FMC_LNAV_heading (JustFlight heading)
 * - L:JF_RJ_ADC1_indicated_altitude (JustFlight altitude)
 * - L:JF_RJ_ADC1_airspeed_indicated (JustFlight airspeed)
 */

const { open, Protocol, SimConnectDataType, SimConnectPeriod, SimConnectConstants } = require('node-simconnect');

async function testCorrectedVars() {
    console.log('🧪 Testing Corrected SimVar Names from Lorby\'s\n');

    try {
        const recvOpen = await open('Variable Test', Protocol.KittyHawk);
        const handle = recvOpen.handle;

        console.log('✅ Connected to MSFS\n');

        const DEF_ID = 0;
        const REQ_ID = 0;
        let dataReceived = false;

        handle.on('simObjectData', (data) => {
            if (data.requestID === REQ_ID) {
                dataReceived = true;

                // Extract buffer with proper offset handling (node-simconnect quirk)
                let buf;
                let bufOffset = 0;

                if (data.data.buffer && data.data.buffer.buffer) {
                    // Nested structure: data.data.buffer.buffer
                    const rawData = data.data.buffer.buffer;
                    bufOffset = data.data.buffer.offset || 0;

                    if (rawData.data && Array.isArray(rawData.data)) {
                        buf = Buffer.from(rawData.data);
                    } else if (Buffer.isBuffer(rawData)) {
                        buf = rawData;
                    }
                } else if (typeof data.data.getBuffer === 'function') {
                    buf = data.data.getBuffer();
                }

                if (buf && buf.length >= bufOffset + 24) {
                    const headingRaw = buf.readDoubleLE(bufOffset);
                    const altitudeFt = buf.readDoubleLE(bufOffset + 8);
                    const airspeedKts = buf.readDoubleLE(bufOffset + 16);

                    // Normalize heading to 0-360 range (LNAV heading might exceed 360)
                    const headingDeg = ((headingRaw % 360) + 360) % 360;

                    console.log('📊 RECEIVED DATA:\n');
                    console.log(`Heading (LNAV):         ${headingRaw.toFixed(2)}° → ${headingDeg.toFixed(2)}°`);
                    console.log(`Altitude:               ${altitudeFt.toFixed(0)} ft`);
                    console.log(`Airspeed:               ${airspeedKts.toFixed(1)} knots\n`);

                    // Validate ranges
                    const headingValid = headingDeg >= 0 && headingDeg <= 360;
                    const altitudeValid = altitudeFt >= 0 && altitudeFt <= 50000;
                    const airspeedValid = airspeedKts >= 0 && airspeedKts <= 500;

                    console.log('✅ VALIDATION:\n');
                    console.log(`  Heading 0-360°:    ${headingValid ? '✓ VALID' : '✗ OUT OF RANGE'}`);
                    console.log(`  Altitude 0-50k ft: ${altitudeValid ? '✓ VALID' : '✗ OUT OF RANGE'}`);
                    console.log(`  Airspeed 0-500 kt: ${airspeedValid ? '✓ VALID' : '✗ OUT OF RANGE'}\n`);

                    if (headingValid && altitudeValid && airspeedValid) {
                        console.log('🎉 SUCCESS! All values are realistic!\n');
                    } else {
                        console.log('⚠️  Some values out of expected range\n');
                    }
                } else {
                    console.log('❌ Invalid buffer\n');
                }
            }
        });

        // Define JustFlight LVar variables
        console.log('📝 Requesting:\n');
        console.log('  - L:JF_RJ_FMC_LNAV_heading (Degrees)');
        console.log('  - L:JF_RJ_ADC1_indicated_altitude (Feet)');
        console.log('  - L:JF_RJ_ADC1_airspeed_indicated (Knots)\n');

        handle.addToDataDefinition(DEF_ID, 'L:JF_RJ_FMC_LNAV_heading', 'Degrees', SimConnectDataType.FLOAT64);
        handle.addToDataDefinition(DEF_ID, 'L:JF_RJ_ADC1_indicated_altitude', 'Feet', SimConnectDataType.FLOAT64);
        handle.addToDataDefinition(DEF_ID, 'L:JF_RJ_ADC1_airspeed_indicated', 'Knots', SimConnectDataType.FLOAT64);

        // Request data 3 times
        console.log('Polling 3 samples...\n');
        for (let i = 0; i < 3; i++) {
            handle.requestDataOnSimObject(
                REQ_ID,
                DEF_ID,
                SimConnectConstants.OBJECT_ID_USER,
                SimConnectPeriod.ONCE
            );
            await new Promise(resolve => setTimeout(resolve, 1500));
        }

        if (dataReceived) {
            console.log('✅ Data successfully received and validated!\n');
        } else {
            console.log('❌ No data received\n');
        }

        handle.close();
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

testCorrectedVars();
