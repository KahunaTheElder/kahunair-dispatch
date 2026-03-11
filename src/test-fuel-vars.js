/**
 * Test fuel quantity variable names
 */

const { open, Protocol, SimConnectDataType, SimConnectPeriod, SimConnectConstants } = require('node-simconnect');

async function testFuelVar(varName, unit) {
    return new Promise((resolve) => {
        (async () => {
            try {
                const recvOpen = await open('Fuel Test', Protocol.KittyHawk);
                const handle = recvOpen.handle;
                const timeoutHandle = setTimeout(() => {
                    console.log(`❌ ${varName} (${unit}) - No response`);
                    handle.close();
                    resolve();
                }, 1500);

                handle.on('simObjectData', (data) => {
                    clearTimeout(timeoutHandle);
                    try {
                        let buf, bufOffset = 0;
                        if (data.data.buffer && data.data.buffer.buffer) {
                            const rawData = data.data.buffer.buffer;
                            bufOffset = data.data.buffer.offset || 0;
                            if (rawData.data && Array.isArray(rawData.data)) {
                                buf = Buffer.from(rawData.data);
                            }
                        }
                        if (buf && buf.length >= bufOffset + 32) {
                            const value = buf.readDoubleLE(bufOffset + 24);
                            if (isFinite(value) && Math.abs(value) > 0.1) {
                                console.log(`✅ ${varName} (${unit}): ${value.toFixed(1)}`);
                            } else {
                                console.log(`⚠️  ${varName} (${unit}): ${value.toFixed(1)} (zero or unavailable)`);
                            }
                        } else {
                            console.log(`❌ ${varName} (${unit}) - Buffer wrong size`);
                        }
                    } catch (e) {
                        console.log(`❌ ${varName} (${unit}) - Error: ${e.message}`);
                    }
                    handle.close();
                    resolve();
                });

                handle.addToDataDefinition(0, 'L:JF_RJ_FMC_LNAV_heading', 'Degrees', SimConnectDataType.FLOAT64);
                handle.addToDataDefinition(0, 'L:JF_RJ_ADC1_indicated_altitude', 'Feet', SimConnectDataType.FLOAT64);
                handle.addToDataDefinition(0, 'L:JF_RJ_ADC1_airspeed_indicated', 'Knots', SimConnectDataType.FLOAT64);
                handle.addToDataDefinition(0, varName, unit, SimConnectDataType.FLOAT64);
                handle.requestDataOnSimObject(0, 0, SimConnectConstants.OBJECT_ID_USER, SimConnectPeriod.ONCE);
            } catch (e) {
                console.log(`❌ ${varName} (${unit}) - Connection error`);
                resolve();
            }
        })();
    });
}

async function runTests() {
    const fuelVars = [
        { name: 'FUEL TOTAL QUANTITY', unit: 'Gallons' },
        { name: 'FUEL TOTAL QUANTITY', unit: 'Pounds' },
        { name: 'FUEL QUANTITY', unit: 'Gallons' },
        { name: 'FUEL LEFT MAIN QUANTITY', unit: 'Gallons' },
        { name: 'FUEL RIGHT MAIN QUANTITY', unit: 'Gallons' },
        { name: 'PAYLOAD STATION WEIGHT:1', unit: 'Pounds' },
        { name: 'PAYLOAD STATION WEIGHT', unit: 'Pounds' }
    ];

    console.log('Testing Fuel Variables:\n');

    for (const fuelVar of fuelVars) {
        await testFuelVar(fuelVar.name, fuelVar.unit);
        await new Promise(r => setTimeout(r, 300));
    }

    console.log('\nTests complete');
    process.exit(0);
}

runTests().catch(error => {
    console.error('Error:', error.message);
    process.exit(1);
});
