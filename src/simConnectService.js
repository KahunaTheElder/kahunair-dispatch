/**
 * SimConnect Service for KahunaAir Dispatch
 * Manages real-time telemetry data from MSFS 2024
 * Uses node-simconnect for full SimConnect API access (including GPS Variables)
 */

const { open, Protocol, SimConnectDataType, SimConnectPeriod, SimConnectConstants } = require('node-simconnect');
const logger = require('./logger');

// Data definition IDs
const DEF_ID_TELEMETRY = 0;
const REQ_ID_TELEMETRY = 0;

class SimConnectService {
    constructor() {
        this.handle = null;
        this.isConnected = false;
        this.telemetry = null;
        this.lastUpdateTime = null;
        this.updateInterval = null;
        this.listeners = [];
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 2000; // ms
        this._firstPollLogged = false;
    }

    /**
     * Initialize SimConnect connection
     * @returns {Promise<boolean>} - True if connection successful
     */
    async connect() {
        try {
            const recvOpen = await open('KahunaAir Dispatch', Protocol.KittyHawk);
            this.handle = recvOpen.handle;
            this.isConnected = true;

            logger.info(`[SimConnect] Successfully connected to ${recvOpen.applicationName}`);

            // Set up event listeners
            this.handle.on('simObjectData', (data) => this._handleSimObjectData(data));
            this.handle.on('exception', (exception) => this._handleException(exception));
            this.handle.on('quit', () => this._handleQuit());
            this.handle.on('close', () => this._handleClose());

            // Define telemetry data request
            this._defineTelemetryDataDefinition();

            // Start polling
            this._startPolling();

            return true;
        } catch (error) {
            logger.error('[SimConnect] Failed to connect:', error?.message || 'Unknown error');
            this.isConnected = false;
            this._scheduleReconnect();
            return false;
        }
    }

    /**
     * Define telemetry data request (6 variables: 3 JustFlight LVars + 3 operational)
     * Using JustFlight LVars for core flight + standard SimVars for fuel/weight/pax
     * @private
     */
    _defineTelemetryDataDefinition() {
        try {
            // Core flight telemetry (3 JustFlight LVars)
            this.handle.addToDataDefinition(
                DEF_ID_TELEMETRY,
                'L:JF_RJ_FMC_LNAV_heading',
                'Degrees',
                SimConnectDataType.FLOAT64
            );
            this.handle.addToDataDefinition(
                DEF_ID_TELEMETRY,
                'L:JF_RJ_ADC1_indicated_altitude',
                'Feet',
                SimConnectDataType.FLOAT64
            );
            this.handle.addToDataDefinition(
                DEF_ID_TELEMETRY,
                'L:JF_RJ_ADC1_airspeed_indicated',
                'Knots',
                SimConnectDataType.FLOAT64
            );

            // Weight data (MSFS standard)
            this.handle.addToDataDefinition(
                DEF_ID_TELEMETRY,
                'TOTAL WEIGHT',
                'Pounds',
                SimConnectDataType.FLOAT64
            );
            this.handle.addToDataDefinition(
                DEF_ID_TELEMETRY,
                'EMPTY WEIGHT',
                'Pounds',
                SimConnectDataType.FLOAT64
            );

            // Fuel, cargo, and passenger data (JustFlight 146 specific LVars)
            this.handle.addToDataDefinition(
                DEF_ID_TELEMETRY,
                'L:146_FuelWeight_LB',
                'Pounds',
                SimConnectDataType.FLOAT64
            );
            this.handle.addToDataDefinition(
                DEF_ID_TELEMETRY,
                'L:146_CargoWeight_LB',
                'Pounds',
                SimConnectDataType.FLOAT64
            );
            this.handle.addToDataDefinition(
                DEF_ID_TELEMETRY,
                'L:146_PaxQty',
                'Number',
                SimConnectDataType.FLOAT64
            );
            this.handle.addToDataDefinition(
                DEF_ID_TELEMETRY,
                'L:146_PaxWeight_LB',
                'Pounds',
                SimConnectDataType.FLOAT64
            );

            // Ground speed
            this.handle.addToDataDefinition(
                DEF_ID_TELEMETRY,
                'GPS GROUND SPEED',
                'Knots',
                SimConnectDataType.FLOAT64
            );

            // Vertical speed (feet per minute)
            this.handle.addToDataDefinition(
                DEF_ID_TELEMETRY,
                'VERTICAL SPEED',
                'Feet per minute',
                SimConnectDataType.FLOAT64
            );

            // Distance remaining to GPS destination (meters) — used to compute ETE
            this.handle.addToDataDefinition(
                DEF_ID_TELEMETRY,
                'GPS GROUND DISTANCE',
                'Meters',
                SimConnectDataType.FLOAT64
            );

            logger.debug('[SimConnect] Telemetry data definitions registered (12 variables: flight, weight, fuel, cargo, pax, groundspeed, vertical-speed, ete)');
        } catch (error) {
            logger.error('[SimConnect] Failed to define telemetry data:', error.message);
        }
    }

    /**
     * Start periodic telemetry polling
     * @private
     */
    _startPolling() {
        if (this.updateInterval) {
            logger.warn('[SimConnect] _startPolling called but interval already exists');
            return;
        }

        logger.info('[SimConnect] Starting telemetry polling (1s interval for 1Hz updates)');

        // Poll every 1 second - provides 1Hz update rate for real-time telemetry display
        this.updateInterval = setInterval(() => {
            this._pollTelemetry();
        }, 1000);

        // Immediately trigger first poll
        logger.info('[SimConnect] Triggering first poll immediately');
        this._pollTelemetry();
    }

    /**
     * Poll telemetry data from SimConnect
     * @private
     */
    _pollTelemetry() {
        if (!this.isConnected || !this.handle) {
            logger.debug('[SimConnect] _pollTelemetry: not connected yet');
            return;
        }

        try {
            this.handle.requestDataOnSimObject(
                REQ_ID_TELEMETRY,
                DEF_ID_TELEMETRY,
                SimConnectConstants.OBJECT_ID_USER,
                SimConnectPeriod.ONCE,
                0,
                0,
                0,
                0
            );
        } catch (error) {
            logger.error('[SimConnect] Poll request failed:', error.message);
        }
    }

    /**
     * Handle incoming SimObject data
     * @private
     */
    _handleSimObjectData(data) {
        try {
            if (data.requestID === REQ_ID_TELEMETRY) {
                this._processTelemetryData(data);
            }
        } catch (error) {
            logger.error('[SimConnect] Error handling sim object data:', error.message);
        }
    }

    /**
     * Process telemetry data from SimConnect
     * @private
     */
    async _processTelemetryData(data) {
        try {
            let buffer = data.data;
            let bufferOffset = 0;

            // Handle RawBuffer from node-simconnect
            // RawBuffer wraps the actual data - need to extract the underlying buffer
            if (typeof buffer.readDoubleLE !== 'function') {
                if (buffer.buffer && buffer.buffer.buffer) {
                    const rawData = buffer.buffer.buffer;

                    if (rawData.data && Array.isArray(rawData.data)) {
                        // It's a nested object with a data array
                        buffer = Buffer.from(rawData.data);
                    } else if (Buffer.isBuffer(rawData)) {
                        buffer = rawData;
                    } else if (rawData instanceof ArrayBuffer) {
                        buffer = Buffer.from(rawData);
                    } else {
                        logger.debug('[SimConnect] Unexpected buffer structure');
                        throw new Error('Cannot extract buffer from RawBuffer structure');
                    }

                    // SimConnect includes a 28-byte header before the data
                    bufferOffset = 28;
                } else if (typeof buffer.getBuffer === 'function') {
                    // Fallback to getBuffer() method
                    buffer = buffer.getBuffer();
                } else if (buffer.buffer && buffer.buffer instanceof ArrayBuffer) {
                    // It might be a TypedArray - preserve byte offset
                    bufferOffset = buffer.byteOffset || 0;
                    buffer = Buffer.from(buffer.buffer, bufferOffset, buffer.byteLength);
                } else {
                    logger.debug('[SimConnect] Unknown buffer type:', Object.prototype.toString.call(buffer));
                    throw new Error(`Cannot process buffer of type ${Object.prototype.toString.call(buffer)}`);
                }
            }

            return this._processBufferData(buffer, bufferOffset);
        } catch (error) {
            logger.error('[SimConnect] Telemetry processing error:', error.message);
            if (error.stack) {
                logger.debug('[SimConnect] Stack:', error.stack);
            }
        }
    }

    async _processBufferData(bufferInput, bufferOffset = 0) {
        try {
            let buffer = bufferInput;

            // If it's a Node.js Buffer, use it directly
            if (!Buffer.isBuffer(buffer) && !(buffer instanceof DataView)) {
                // Try to create a DataView from the underlying ArrayBuffer
                if (buffer.buffer && buffer.buffer instanceof ArrayBuffer) {
                    // It's likely a typed array - create DataView
                    buffer = new DataView(buffer.buffer, buffer.byteOffset || 0, buffer.byteLength);
                } else if (buffer instanceof ArrayBuffer) {
                    buffer = new DataView(buffer);
                } else {
                    logger.error('[SimConnect] Cannot create DataView from buffer:', Object.prototype.toString.call(buffer));
                    throw new Error('Cannot process buffer');
                }
            }

            logger.debug(`[SimConnect] Buffer length: ${buffer.byteLength || buffer.length} bytes, data offset: ${bufferOffset}`);

            // Read 12 variables from the offset position
            let offset = bufferOffset;

            let headingRaw, altitudeFeet, airspeedKnots, totalWeightLbs, emptyWeightLbs, fuelWeightLbs, cargoWeightLbs, paxQuantity, paxWeightLbs, groundSpeedKnots, verticalSpeedFpm, eteSeconds;

            // Debug: Show expected buffer structure
            logger.debug(`[SimConnect] 28-byte header, then 12 FLOAT64 variables (8 bytes each):`);
            logger.debug(`[SimConnect]   [28-35] Heading, [36-43] Altitude, [44-51] Airspeed`);
            logger.debug(`[SimConnect]   [52-59] Total Wt, [60-67] Empty Wt, [68-75] Fuel`);
            logger.debug(`[SimConnect]   [76-83] Cargo, [84-91] PaxQty, [92-99] PaxWt, [100-107] GroundSpeed, [108-115] VerticalSpeed, [116-123] GPS ETE`);

            if (buffer instanceof DataView) {
                // Use DataView methods
                headingRaw = buffer.getFloat64(offset, true);
                offset += 8;
                altitudeFeet = buffer.getFloat64(offset, true);
                offset += 8;
                airspeedKnots = buffer.getFloat64(offset, true);
                offset += 8;
                totalWeightLbs = buffer.getFloat64(offset, true);
                offset += 8;
                emptyWeightLbs = buffer.getFloat64(offset, true);
                offset += 8;
                fuelWeightLbs = buffer.getFloat64(offset, true);
                offset += 8;
                cargoWeightLbs = buffer.getFloat64(offset, true);
                offset += 8;
                paxQuantity = buffer.getFloat64(offset, true);
                offset += 8;
                paxWeightLbs = buffer.getFloat64(offset, true);
                offset += 8;
                groundSpeedKnots = buffer.getFloat64(offset, true);
                offset += 8;
                verticalSpeedFpm = buffer.getFloat64(offset, true);
                offset += 8;
                eteSeconds = buffer.getFloat64(offset, true);
            } else {
                // Use Node.js Buffer methods
                headingRaw = buffer.readDoubleLE(offset);
                offset += 8;
                altitudeFeet = buffer.readDoubleLE(offset);
                offset += 8;
                airspeedKnots = buffer.readDoubleLE(offset);
                offset += 8;
                totalWeightLbs = buffer.readDoubleLE(offset);
                offset += 8;
                emptyWeightLbs = buffer.readDoubleLE(offset);
                offset += 8;
                fuelWeightLbs = buffer.readDoubleLE(offset);
                offset += 8;
                cargoWeightLbs = buffer.readDoubleLE(offset);
                offset += 8;
                paxQuantity = buffer.readDoubleLE(offset);
                offset += 8;
                paxWeightLbs = buffer.readDoubleLE(offset);
                offset += 8;
                groundSpeedKnots = buffer.readDoubleLE(offset);
                offset += 8;
                verticalSpeedFpm = buffer.readDoubleLE(offset);
                offset += 8;
                eteSeconds = buffer.readDoubleLE(offset);
            }

            // Debug: Show expected buffer structure
            logger.debug(`[SimConnect] Buffer length: ${buffer.byteLength || buffer.length} bytes, data offset: ${bufferOffset}`);
            logger.debug(`[SimConnect]   [28-35] Heading, [36-43] Altitude, [44-51] Airspeed`);
            logger.debug(`[SimConnect]   [52-59] Total Wt, [60-67] Empty Wt, [68-75] Fuel`);
            logger.debug(`[SimConnect]   [76-83] Cargo, [84-91] PaxQty, [92-99] PaxWt`);

            // Normalize heading to 0-360 range
            const headingDegrees = ((headingRaw % 360) + 360) % 360;

            // IMPORTANT: SimConnect returns fuel and cargo in KILOGRAMS despite requesting pounds
            // Both values are exactly 2.20462x too high, so divide to convert KG to LBS
            const fuelWeightLbs_Corrected = fuelWeightLbs / 2.20462;
            const cargoWeightLbs_Corrected = cargoWeightLbs / 2.20462;

            // Debug: Log all raw values from buffer
            logger.debug(`[SimConnect] RAW from buffer - Heading: ${headingRaw.toFixed(2)}, Altitude: ${altitudeFeet.toFixed(1)}, Airspeed: ${airspeedKnots.toFixed(1)}`);
            logger.debug(`[SimConnect] RAW weights - Total: ${totalWeightLbs.toFixed(1)}, Empty: ${emptyWeightLbs.toFixed(1)}, Fuel: ${fuelWeightLbs.toFixed(1)}, Cargo: ${cargoWeightLbs.toFixed(1)}`);
            logger.debug(`[SimConnect] CORRECTED weights - Fuel: ${fuelWeightLbs_Corrected.toFixed(1)}, Cargo: ${cargoWeightLbs_Corrected.toFixed(1)}`);
            logger.debug(`[SimConnect] RAW pax - Count: ${paxQuantity.toFixed(1)}, Weight: ${paxWeightLbs.toFixed(1)}`);

            // Calculate Zero Fuel Weight (empty weight + cargo + passengers)
            const zeroFuelWeightLbs = emptyWeightLbs + cargoWeightLbs_Corrected + paxWeightLbs;

            // Calculate payload (total weight - empty weight)
            const payloadWeightLbs = Math.max(0, totalWeightLbs - emptyWeightLbs);

            logger.debug(
                `[SimConnect] Processed values - ` +
                `HDG: ${headingDegrees.toFixed(2)}°, ` +
                `ALT: ${altitudeFeet.toFixed(0)}ft, ` +
                `IAS: ${airspeedKnots.toFixed(1)}kt, ` +
                `FUEL: ${fuelWeightLbs.toFixed(1)}lbs, ` +
                `ZFW: ${zeroFuelWeightLbs.toFixed(1)}lbs, ` +
                `PAX: ${paxQuantity.toFixed(0)} pax`
            );

            // GPS GROUND DISTANCE is in meters; compute ETE from distance / ground speed
            const distanceMeters = eteSeconds; // variable reused for distance
            const distanceNm = distanceMeters / 1852;
            const computedEteSeconds = (groundSpeedKnots > 5)
                ? Math.round((distanceNm / groundSpeedKnots) * 3600)
                : 0;

            // Build telemetry object with all operational data
            this.telemetry = {
                position: {
                    heading: headingDegrees
                },
                altitude: {
                    indicated: altitudeFeet
                },
                speed: {
                    airspeed: airspeedKnots,
                    groundSpeed: groundSpeedKnots,
                    verticalSpeed: verticalSpeedFpm || 0
                },
                fuel: {
                    total: fuelWeightLbs_Corrected,
                    usableTotal: fuelWeightLbs_Corrected,  // Assume all fuel is usable
                    leftMain: 0,  // Individual tank data not available
                    centerMain: 0,
                    rightMain: 0
                },
                weight: {
                    current: totalWeightLbs,
                    empty: emptyWeightLbs,
                    maxGross: 0,
                    payload: payloadWeightLbs,
                    zeroFuelWeight: zeroFuelWeightLbs,
                    loadPercent: payloadWeightLbs > 0 ? (payloadWeightLbs / (totalWeightLbs - emptyWeightLbs) * 100) : 0
                },
                passengers: {
                    count: Math.round(paxQuantity)
                },
                cargo: {
                    weight: cargoWeightLbs_Corrected
                },
                navigation: {
                    nextWaypoint: null,
                    nextWaypointDistance: null,
                    eteSeconds: computedEteSeconds,
                    eteMinutes: Math.round(computedEteSeconds / 60)
                },
                timestamp: Date.now()
            };

            this.lastUpdateTime = new Date();
            this._notifyListeners();

            if (!this._firstPollLogged) {
                logger.info(
                    `[SimConnect] ✅ First telemetry poll SUCCESS!\n` +
                    `  Heading: ${headingDegrees.toFixed(1)}°\n` +
                    `  Altitude: ${Math.round(altitudeFeet)} ft\n` +
                    `  Airspeed: ${Math.round(airspeedKnots)} kts\n` +
                    `  Ground Speed: ${Math.round(groundSpeedKnots)} kts\n` +
                    `  Fuel: ${Math.round(fuelWeightLbs)} lbs\n` +
                    `  Zero Fuel Weight: ${Math.round(zeroFuelWeightLbs)} lbs\n` +
                    `  Cargo: ${Math.round(cargoWeightLbs)} lbs\n` +
                    `  Passengers: ${Math.round(paxQuantity)} pax\n` +
                    `  Total Weight: ${Math.round(totalWeightLbs)} lbs (Empty: ${Math.round(emptyWeightLbs)} lbs)\n` +
                    `  ETE to Destination: ${Math.round(computedEteSeconds / 60)} min (${distanceNm.toFixed(1)} nm @ ${Math.round(groundSpeedKnots)} kts)`
                );
                this._firstPollLogged = true;
            }
        } catch (error) {
            logger.error('[SimConnect] Buffer processing error:', error.message);
            if (error.stack) {
                logger.debug('[SimConnect] Stack:', error.stack);
            }
        }
    }

    /**
     * Handle SimConnect exception
     * @private
     */
    _handleException(exception) {
        logger.warn('[SimConnect] Exception:', exception);
    }

    /**
     * Handle simulator quit
     * @private
     */
    _handleQuit() {
        logger.warn('[SimConnect] Simulator closed connection');
        this.isConnected = false;
        this._stopPolling();
        this._scheduleReconnect();
    }

    /**
     * Handle connection close
     * @private
     */
    _handleClose() {
        logger.warn('[SimConnect] Connection closed unexpectedly');
        this.isConnected = false;
        this._stopPolling();
        this._scheduleReconnect();
    }

    /**
     * Schedule reconnection attempt
     * @private
     */
    _scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            logger.error('[SimConnect] Max reconnection attempts reached');
            return;
        }

        this.reconnectAttempts++;
        logger.info(
            `[SimConnect] Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} ` +
            `in ${this.reconnectDelay}ms`
        );

        setTimeout(() => {
            this.connect();
        }, this.reconnectDelay);
    }

    /**
     * Stop periodic polling
     * @private
     */
    _stopPolling() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
            logger.info('[SimConnect] Stopped telemetry polling');
        }
    }

    /**
     * Notify all listeners of telemetry update
     * @private
     */
    _notifyListeners() {
        this.listeners.forEach(callback => {
            try {
                callback(this.telemetry, this.isConnected);
            } catch (error) {
                logger.error('[SimConnect] Listener error:', error.message);
            }
        });
    }

    /**
     * Register listener for telemetry updates
     * @param {Function} callback - Called with (telemetry, isConnected)
     * @returns {Function} - Unregister function
     */
    onTelemetryUpdate(callback) {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(cb => cb !== callback);
        };
    }

    /**
     * Get current telemetry data
     * @returns {Object|null} - Telemetry object or null if not connected
     */
    getTelemetry() {
        if (this.telemetry) {
            return this.telemetry;
        }
        return null;
    }

    /**
     * Get connection status
     * @returns {boolean}
     */
    getConnectionStatus() {
        return this.isConnected;
    }

    /**
     * Get last update timestamp
     * @returns {Date|null}
     */
    getLastUpdateTime() {
        return this.lastUpdateTime;
    }

    /**
     * Disconnect from SimConnect
     */
    disconnect() {
        this._stopPolling();
        this.isConnected = false;
        if (this.handle) {
            try {
                this.handle = null;
            } catch (error) {
                logger.debug('[SimConnect] Error during disconnect:', error.message);
            }
        }
        logger.info('[SimConnect] Disconnected');
    }

    /**
     * Calculate passenger count from payload weight (simplified)
     * @private
     */
    async _calculatePassengerCount() {
        try {
            // Simplified version: return null since we don't have easy access to
            // individual payload stations via node-simconnect basic queries
            // In the future, this could be enhanced with individual station queries
            return null;
        } catch (error) {
            logger.debug(`[SimConnect] Passenger count calculation failed: ${error.message}`);
            return null;
        }
    }
}

// Export singleton instance
module.exports = new SimConnectService();
