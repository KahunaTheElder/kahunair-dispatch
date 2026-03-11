/**
 * Debug script to capture raw buffer values from SimConnect
 * Tests if MSFS is sending data but we're just reading it wrong
 */

const { open, Protocol, SimConnectDataType, SimConnectPeriod, SimConnectConstants } = require('node-simconnect');

async function debugLVarValues() {
    console.log('🔍 DEBUG: Raw SimConnect Buffer Inspection\n');

    try {
        const recvOpen = await open('Debug LVAR', Protocol.KittyHawk);
        const handle = recvOpen.handle;

        console.log('✅ Connected to MSFS\n');

        const DEF_ID = 0;
        const REQ_ID = 0;
        let sampleCount = 0;

        handle.on('simObjectData', (data) => {
            if (data.requestID === REQ_ID) {
                sampleCount++;
                console.log(`\n📊 SAMPLE ${sampleCount}:`);
                console.log(`   Raw data object: ${JSON.stringify(data, null, 2)}`);

                // Get buffer
                let buf;
                if (data.data && typeof data.data.getBuffer === 'function') {
                    buf = data.data.getBuffer();
                    console.log(`   ${data.data.constructor.name}.getBuffer() called`);
                } else if (Buffer.isBuffer(data.data)) {
                    buf = data.data;
                    console.log(`   data.data is already a Buffer`);
                } else if (data.data) {
                    console.log(`   data.data type: ${typeof data.data}, constructor: ${data.data.constructor.name}`);
                    console.log(`   data.data keys: ${Object.keys(data.data)}`);
                    if (data.data._buffer) buf = data.data._buffer;
                    else if (data.data.buffer) buf = data.data.buffer;
                }

                if (buf) {
                    console.log(`   Buffer length: ${buf.length}`);
                    console.log(`   Buffer hex: ${buf.toString('hex')}`);

                    // Try reading as FLOAT64 at different offsets
                    console.log(`\n   Reading FLOAT64 values:`);
                    for (let i = 0; i <= buf.length - 8; i += 8) {
                        const val = buf.readDoubleLE(i);
                        console.log(`     Offset ${i}: ${val} (hex: ${buf.readBigUInt64LE(i).toString(16)})`);
                    }
                } else {
                    console.log(`   ❌ Could not extract buffer from data`);
                }

                if (sampleCount >= 3) {
                    handle.close();
                    process.exit(0);
                }
            }
        });

        // Request just the altitude LVar
        console.log('📝 Defining: L:JF_RJ_ADC1_indicated_altitude (Feet, FLOAT64)\n');
        handle.addToDataDefinition(
            DEF_ID,
            'L:JF_RJ_ADC1_indicated_altitude',
            'Feet',
            SimConnectDataType.FLOAT64
        );

        console.log('Polling 3 samples with 2-second delay...\n');
        for (let i = 0; i < 3; i++) {
            handle.requestDataOnSimObject(
                REQ_ID,
                DEF_ID,
                SimConnectConstants.OBJECT_ID_USER,
                SimConnectPeriod.ONCE
            );
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        setTimeout(() => {
            console.log('\n❌ Timeout: No data received after 6 seconds');
            handle.close();
            process.exit(1);
        }, 7000);

    } catch (err) {
        console.error(`❌ Error: ${err.message}`);
        console.error(err.stack);
        process.exit(1);
    }
}

debugLVarValues();
