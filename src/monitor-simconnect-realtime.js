/**
 * Real-Time SimConnect Monitor for JustFlight Avro RJ-100
 * Logs all incoming data for analysis
 * 
 * This tool helps identify:
 * 1. What data is actually being sent by MSFS
 * 2. Patterns in the data (endianness, data types, units)
 * 3. Whether data corresponds to aircraft state
 */

const { open, Protocol, SimConnectDataType, SimConnectPeriod, SimConnectConstants } = require('node-simconnect');
const fs = require('fs');
const path = require('path');

const logFile = path.join('logs', 'simconnect-monitor.log');

function log(msg) {
    const timestamp = new Date().toISOString();
    const fullMsg = `[${timestamp}] ${msg}`;
    console.log(fullMsg);
    try {
        fs.appendFileSync(logFile, fullMsg + '\n');
    } catch (e) {
        // Ignore write errors
    }
}

async function monitorTelemetry() {
    log('🔍 Real-Time SimConnect Monitor for Avro RJ-100');
    log('Logging all incoming data for analysis...\n');

    try {
        const recvOpen = await open('Telemetry Monitor', Protocol.KittyHawk);
        const handle = recvOpen.handle;

        log(`✅ Connected to MSFS`);
        log(`App Name: ${recvOpen.applicationName}`);
        log(`App Version: ${recvOpen.applicationVersion}\n`);

        let dataCount = 0;
        const sampleBuffer = Buffer.alloc(1024); // Log samples

        // Listen to ALL data events
        handle.on('simObjectData', (data) => {
            dataCount++;

            if (dataCount % 5 === 0) {
                // Log every 5th sample (reduce spam)
                try {
                    let buf = data.data;
                    if (typeof buf.getBuffer === 'function') {
                        buf = buf.getBuffer();
                    }

                    log(`\n📊 Sample #${dataCount}:`);
                    log(`  Request ID: ${data.requestID}`);
                    log(`  Define ID: ${data.defineID}`);
                    log(`  Object ID: ${data.objectID}`);
                    log(`  Buffer Length: ${buf.length}`);
                    log(`  Hex (first 64 bytes): ${buf.toString('hex', 0, Math.min(64, buf.length))}`);

                    // Try to interpret as different data types
                    if (buf.length >= 8) {
                        log(`  As FLOAT64 [0]: ${buf.readDoubleLE(0)}`);
                        log(`  As FLOAT64 [8]: ${buf.readDoubleLE(8)}`);
                        log(`  As FLOAT64 [16]: ${buf.readDoubleLE(16)}`);
                    }

                    if (buf.length >= 4) {
                        log(`  As INT32 [0]: ${buf.readInt32LE(0)}`);
                        log(`  As INT32 [4]: ${buf.readInt32LE(4)}`);
                    }

                    if (buf.length >= 2) {
                        log(`  As INT16 [0]: ${buf.readInt16LE(0)}`);
                        log(`  As INT16 [2]: ${buf.readInt16LE(2)}`);
                    }

                    // Try common unit conversions
                    if (buf.length >= 8) {
                        const val = buf.readDoubleLE(0);
                        const valDegrees = (val * 180) / Math.PI;
                        const valPercent = val * 100;
                        const valFeet = val;
                        log(`  Unit conversions: rad->deg=${valDegrees.toFixed(2)}, percent=${valPercent.toFixed(2)}, feet=${valFeet.toFixed(2)}`);
                    }
                } catch (e) {
                    log(`  Error parsing data: ${e.message}`);
                }
            }

            if (dataCount % 100 === 0) {
                log(`\n⏱️  Received ${dataCount} data packets so far...`);
            }
        });

        // Define data request for core variables
        log('📝 Setting up core variable request...\n');

        const DEF_ID = 0;
        const REQ_ID = 0;

        try {
            handle.addToDataDefinition(DEF_ID, 'PLANE HEADING DEGREES TRUE', 'Radians', SimConnectDataType.FLOAT64);
            handle.addToDataDefinition(DEF_ID, 'INDICATED ALTITUDE', 'Feet', SimConnectDataType.FLOAT64);
            handle.addToDataDefinition(DEF_ID, 'AIRSPEED INDICATED', 'Knots', SimConnectDataType.FLOAT64);

            log('✓ Data definition registered');
            log('✓ Starting continuous polling...\n');

            // Request data continuously
            const pollInterval = setInterval(() => {
                try {
                    handle.requestDataOnSimObject(
                        REQ_ID,
                        DEF_ID,
                        SimConnectConstants.OBJECT_ID_USER,
                        SimConnectPeriod.ONCE
                    );
                } catch (e) {
                    log(`Poll error: ${e.message}`);
                }
            }, 2000);

            // Run for 30 seconds then exit
            log('📊 Monitoring for 30 seconds (check logs/simconnect-monitor.log)...\n');
            setTimeout(() => {
                clearInterval(pollInterval);
                log('\n✅ Monitoring complete. Samples logged to simconnect-monitor.log');
                log(`Total samples collected: ${dataCount}`);
                log('\nAnalysis tips:');
                log('1. Look for patterns in hex data - should change between samples if in flight');
                log('2. Check float64 conversions - should be realistic values');
                log('3. Search for HEADING pattern: 0-2π radians, or 0-360° after conversion');
                log('4. Search for ALTITUDE pattern: positive feet values');
                log('5. If all samples identical, aircraft may be paused or parked');
                handle.close();
                process.exit(0);
            }, 30000);

        } catch (error) {
            log(`❌ Setup error: ${error.message}`);
            handle.close();
            process.exit(1);
        }

    } catch (error) {
        log(`❌ Fatal error: ${error.message}`);
        process.exit(1);
    }
}

monitorTelemetry();
