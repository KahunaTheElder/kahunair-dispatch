/**
 * Extract raw data from the nested buffer structure properly
 */

const { open, Protocol, SimConnectDataType, SimConnectPeriod, SimConnectConstants } = require('node-simconnect');

async function extractLVarData() {
    console.log('🔧 Testing correct buffer extraction\n');

    try {
        const recvOpen = await open('Extract LVAR', Protocol.KittyHawk);
        const handle = recvOpen.handle;

        console.log('✅ Connected to MSFS\n');

        const DEF_ID = 0;
        const REQ_ID = 0;
        let sampleCount = 0;

        handle.on('simObjectData', (data) => {
            if (data.requestID === REQ_ID) {
                sampleCount++;
                console.log(`\n📊 SAMPLE ${sampleCount}:`);

                // The raw buffer structure is nested - we need to get the actual data
                const rawBuffer = data.data.buffer ? data.data.buffer.buffer : data.data;
                const offset = data.data.buffer ? data.data.buffer.offset : 0;

                console.log(`   Raw buffer type: ${rawBuffer.type || 'unknown'}`);
                console.log(`   Raw buffer length: ${rawBuffer.length}`);
                console.log(`   Offset from RawBuffer: ${offset}`);

                // Convert data array to actual Buffer if needed
                let buf;
                if (Buffer.isBuffer(rawBuffer)) {
                    buf = rawBuffer;
                } else if (rawBuffer.data && Array.isArray(rawBuffer.data)) {
                    buf = Buffer.from(rawBuffer.data);
                }

                if (buf && offset >= 0 && offset + 8 <= buf.length) {
                    // Read the FLOAT64 at the offset position
                    const altitude = buf.readDoubleLE(offset);
                    console.log(`   ✅ Altitude (at offset ${offset}): ${altitude.toFixed(1)} ft`);

                    // Also show hex and some context
                    console.log(`   Hex at offset: ${buf.slice(offset, offset + 8).toString('hex')}`);
                } else {
                    console.log(`   ⚠️  Cannot read - offset ${offset} + 8 > buffer length ${buf?.length}`);
                    if (buf) {
                        console.log(`   Full buffer hex: ${buf.toString('hex')}`);
                        console.log(`   Last 16 bytes: ${buf.slice(-16).toString('hex')}`);
                    }
                }

                if (sampleCount >= 3) {
                    handle.close();
                    process.exit(0);
                }
            }
        });

        console.log('📝 Defining: L:JF_RJ_ADC1_indicated_altitude\n');
        handle.addToDataDefinition(
            DEF_ID,
            'L:JF_RJ_ADC1_indicated_altitude',
            'Feet',
            SimConnectDataType.FLOAT64
        );

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

        setTimeout(() => {
            console.log('\n❌ Timeout - no data received');
            handle.close();
            process.exit(1);
        }, 7000);

    } catch (err) {
        console.error(`❌ Error: ${err.message}`);
        process.exit(1);
    }
}

extractLVarData();
