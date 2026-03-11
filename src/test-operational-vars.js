/**
 * Simple sequential test for operational variables
 * Tests one variable at a time for fuel/weight data
 */

const { open, Protocol, SimConnectDataType, SimConnectPeriod, SimConnectConstants } = require('node-simconnect');

async function testOperationalVar(varName, unit) {
    console.log(`\n📝 Testing: "${varName}" (${unit})\n`);

    return new Promise((resolve) => {
        (async () => {
            try {
                const recvOpen = await open(`Test ${varName}`, Protocol.KittyHawk);
                const handle = recvOpen.handle;

                const DEF_ID = 0;
                const REQ_ID = 0;
                let dataReceived = false;

                const timeoutHandle = setTimeout(() => {
                    if (!dataReceived) {
                        console.log('❌ No data received (timeout) - Variable may not exist\n');
                    }
                    handle.close();
                    resolve();
                }, 2000);

                handle.on('simObjectData', (data) => {
                    if (data.requestID === REQ_ID && !dataReceived) {
                        dataReceived = true;
                        clearTimeout(timeoutHandle);

                        try {
                            let buf;
                            let bufOffset = 0;

                            if (data.data.buffer && data.data.buffer.buffer) {
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

                            if (buf && buf.length >= bufOffset + 32) {
                                const testValue = buf.readDoubleLE(bufOffset + 24);

                                if (testValue === 0) {
                                    console.log(`⚠️  Value: 0 (variable exists but is 0)`);
                                } else if (Math.abs(testValue) > 1e-100 && isFinite(testValue)) {
                                    console.log(`✅ Value: ${testValue.toFixed(1)} ${unit}`);
                                    console.log(`   This variable appears to work!\n`);
                                } else {
                                    console.log(`❌ Invalid value: ${testValue} (likely not available)`);
                                }
                            } else {
                                console.log('❌ Buffer size wrong for 4 variables\n');
                            }
                        } catch (error) {
                            console.log(`❌ Error processing: ${error.message}\n`);
                        }

                        handle.close();
                        resolve();
                    }
                });

                // Define 3 known vars + 1 test var
                handle.addToDataDefinition(DEF_ID, 'L:JF_RJ_FMC_LNAV_heading', 'Degrees', SimConnectDataType.FLOAT64);
                handle.addToDataDefinition(DEF_ID, 'L:JF_RJ_ADC1_indicated_altitude', 'Feet', SimConnectDataType.FLOAT64);
                handle.addToDataDefinition(DEF_ID, 'L:JF_RJ_ADC1_airspeed_indicated', 'Knots', SimConnectDataType.FLOAT64);
                handle.addToDataDefinition(DEF_ID, varName, unit, SimConnectDataType.FLOAT64);

                handle.requestDataOnSimObject(
                    REQ_ID,
                    DEF_ID,
                    SimConnectConstants.OBJECT_ID_USER,
                    SimConnectPeriod.ONCE
                );

            } catch (error) {
                console.log(`❌ Error: ${error.message}\n`);
                resolve();
            }
        })();
    });
}

async function runTests() {
    console.log('🧪 Testing Operational Variable Names\n');

    const varsToTest = [
        { name: 'FUEL TOTAL WEIGHT', unit: 'Pounds' },
        { name: 'TOTAL WEIGHT', unit: 'Pounds' },
        { name: 'EMPTY WEIGHT', unit: 'Pounds' },
        { name: 'MAXIMUM GROSS WEIGHT', unit: 'Pounds' },
        { name: 'CURRENT WEIGHT', unit: 'Pounds' },
        { name: 'PAYLOAD WEIGHT', unit: 'Pounds' }
    ];

    for (const variable of varsToTest) {
        await testOperationalVar(variable.name, variable.unit);
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log('\n🏁 All tests complete!\n');
    process.exit(0);
}

runTests().catch(error => {
    console.error('Fatal error:', error.message);
    process.exit(1);
});
