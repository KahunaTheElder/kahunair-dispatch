/**
 * SimConnect Service for KahunaAir Dispatch
 * Manages real-time telemetry data from MSFS 2024
 * Uses node-simconnect for full SimConnect API access (including GPS Variables)
 */

const { open, Protocol, SimConnectDataType, SimConnectPeriod, SimConnectConstants } = require('node-simconnect');
const logger = require('./logger');

// Data definition IDs
const DEF_ID_TELEMETRY = 0;  // numeric (polled every second)
const DEF_ID_NAMES = 1;  // string station names (fetched once on connect)
const REQ_ID_TELEMETRY = 0;
const REQ_ID_NAMES = 1;

// Numeric variables registered in DEF_ID_TELEMETRY (in buffer order):
// [0]  PLANE HEADING DEGREES MAGNETIC
// [1]  INDICATED ALTITUDE
// [2]  AIRSPEED INDICATED
// [3]  TOTAL WEIGHT
// [4]  EMPTY WEIGHT
// [5]  FUEL TOTAL QUANTITY WEIGHT
// [6]  GPS GROUND SPEED
// [7]  VERTICAL SPEED
// [8]  GPS POSITION LAT
// [9]  GPS POSITION LON
// [10] SIM ON GROUND
// [11-25] PAYLOAD STATION WEIGHT:1..15
// [26] GPS ETE
const NUMERIC_VAR_COUNT = 27;
const STATION_COUNT = 15; // SDK max

// Station name classification (checked in priority order)
const CAT_SKIP = 'skip';
const CAT_CARGO = 'cargo';
const CAT_CREW = 'crew';
const CAT_PAX = 'pax';
const SKIP_RE = /do not alter|ballast|structural/i;
const CARGO_RE = /cargo|freight|baggage|bag|hold/i;
const CREW_RE = /\bpilot\b|co.?pilot|first officer|crew|attendant|steward|purser/i;
const PAX_RE = /\bzone\b|pax|passenger|seat|row/i;

function classifyStation(name) {
    if (!name || SKIP_RE.test(name)) return CAT_SKIP;
    if (CARGO_RE.test(name)) return CAT_CARGO;
    if (CREW_RE.test(name)) return CAT_CREW;
    if (PAX_RE.test(name)) return CAT_PAX;
    return 'unknown';
}

/** Integer GCD — used to derive per-pax weight from station multiples */
function gcd(a, b) { return b < 1 ? a : gcd(b, a % b); }

class SimConnectService {
    constructor() {
        this.handle = null;
        this.isConnected = false;
        this.telemetry = null;
        this.lastUpdateTime = null;
        this.updateInterval = null;
        this.listeners = [];
        this.reconnectAttempts = 0;
        this.reconnectDelay = 2000; // ms — backs off to 30s max, retries indefinitely
        this._firstPollLogged = false;
        // Station names fetched once on connect, cached for the session
        this.stationNames = null;   // string[] length STATION_COUNT, or null if not yet received
        this._namesTimeout = null;
        this._namesRefreshPending = false;
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

            // Define data requests
            this._defineTelemetryDataDefinition();
            this._defineNamesDefinition();

            // Fetch station names once; start numeric polling when they arrive
            // (or fall back after 3 s if SimConnect doesn't return them)
            this._namesTimeout = setTimeout(() => {
                if (!this.stationNames) {
                    logger.warn('[SimConnect] Station names not received within 3s; using unknown categories');
                    this.stationNames = new Array(STATION_COUNT).fill('');
                    this._startPolling();
                }
            }, 3000);

            this.handle.requestDataOnSimObject(
                REQ_ID_NAMES, DEF_ID_NAMES,
                SimConnectConstants.OBJECT_ID_USER,
                SimConnectPeriod.ONCE, 0, 0, 0, 0
            );

            return true;
        } catch (error) {
            logger.error('[SimConnect] Failed to connect:', error?.message || 'Unknown error');
            this.isConnected = false;
            this._scheduleReconnect();
            return false;
        }
    }

    /**
     * Define numeric telemetry data definition.
     * All standard SimVars — no aircraft-specific LVars.
     * Registers 10 flight/weight vars + 15 payload station weights.
     * @private
     */
    _defineTelemetryDataDefinition() {
        const vars = [
            ['PLANE HEADING DEGREES MAGNETIC', 'Degrees'],
            ['INDICATED ALTITUDE', 'Feet'],
            ['AIRSPEED INDICATED', 'Knots'],
            ['TOTAL WEIGHT', 'Pounds'],
            ['EMPTY WEIGHT', 'Pounds'],
            ['FUEL TOTAL QUANTITY WEIGHT', 'Pounds'],
            ['GPS GROUND SPEED', 'Knots'],
            ['VERTICAL SPEED', 'Feet per minute'],
            ['GPS POSITION LAT', 'Degrees'],
            ['GPS POSITION LON', 'Degrees'],
            ['SIM ON GROUND', 'Bool'],
        ];
        // Append payload station weight slots 1..15
        for (let i = 1; i <= STATION_COUNT; i++) {
            vars.push([`PAYLOAD STATION WEIGHT:${i}`, 'Pounds']);
        }
        // GPS ETE — follows active flight plan route; 0 when no destination programmed
        vars.push(['GPS ETE', 'Seconds']);
        try {
            for (const [name, unit] of vars) {
                this.handle.addToDataDefinition(DEF_ID_TELEMETRY, name, unit, SimConnectDataType.FLOAT64);
            }
            logger.debug(`[SimConnect] Numeric definitions registered (${vars.length} variables: flight + ${STATION_COUNT} payload stations)`);
        } catch (error) {
            logger.error('[SimConnect] Failed to define telemetry data:', error.message);
        }
    }

    /**
     * Define station-name string definition (fetched once on connect).
     * @private
     */
    _defineNamesDefinition() {
        try {
            for (let i = 1; i <= STATION_COUNT; i++) {
                this.handle.addToDataDefinition(
                    DEF_ID_NAMES,
                    `PAYLOAD STATION NAME:${i}`,
                    null,
                    SimConnectDataType.STRING32
                );
            }
            logger.debug(`[SimConnect] Name definitions registered (${STATION_COUNT} station name strings)`);
        } catch (error) {
            logger.error('[SimConnect] Failed to define station names:', error.message);
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
            if (data.requestID === REQ_ID_NAMES) {
                this._processNamesData(data);
            } else if (data.requestID === REQ_ID_TELEMETRY) {
                this._processTelemetryData(data);
            }
        } catch (error) {
            logger.error('[SimConnect] Error handling sim object data:', error.message);
        }
    }

    /**
     * Process the one-shot station name response and start polling.
     * @private
     */
    _processNamesData(data) {
        try {
            const names = this._readStringsFromBuffer(data, STATION_COUNT, 32);
            this.stationNames = names;
            if (this._namesTimeout) { clearTimeout(this._namesTimeout); this._namesTimeout = null; }
            const summary = names.map((n, i) => `${i + 1}:"${n || '??'}"(${classifyStation(n)})`).join(', ');
            logger.info(`[SimConnect] Station names received — ${summary}`);
            this._startPolling();
        } catch (error) {
            logger.error('[SimConnect] Failed to read station names:', error.message);
            this.stationNames = new Array(STATION_COUNT).fill('');
            this._startPolling();
        }
    }

    /**
     * Extract null-terminated ASCII strings from a SimConnect buffer.
     * @private
     */
    _readStringsFromBuffer(data, count, bytesPerString) {
        let buf = data.data;
        let offset = 0;
        if (typeof buf.readDoubleLE !== 'function') {
            if (buf.buffer && buf.buffer.buffer) {
                const raw = buf.buffer.buffer;
                buf = raw.data && Array.isArray(raw.data) ? Buffer.from(raw.data)
                    : Buffer.isBuffer(raw) ? raw
                        : raw instanceof ArrayBuffer ? Buffer.from(raw)
                            : null;
                if (!buf) throw new Error('Cannot extract inner buffer');
                offset = 28;
            } else if (buf.buffer && buf.buffer instanceof ArrayBuffer) {
                buf = Buffer.from(buf.buffer, buf.byteOffset || 0, buf.byteLength);
                offset = 0;
            }
        }
        const strings = [];
        for (let i = 0; i < count; i++) {
            const slice = buf.slice(offset, offset + bytesPerString);
            const nullIdx = slice.indexOf(0);
            strings.push(slice.toString('ascii', 0, nullIdx >= 0 ? nullIdx : bytesPerString).trim());
            offset += bytesPerString;
        }
        return strings;
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

            // ── Read NUMERIC_VAR_COUNT FLOAT64 values from buffer ────────────────
            const readDouble = (buffer instanceof DataView)
                ? (off) => buffer.getFloat64(off, true)
                : (off) => buffer.readDoubleLE(off);

            let offset = bufferOffset;
            const vals = [];
            for (let i = 0; i < NUMERIC_VAR_COUNT; i++) {
                vals.push(readDouble(offset));
                offset += 8;
            }

            // Named slots (matches _defineTelemetryDataDefinition registration order)
            const headingRaw = vals[0];
            const altitudeFeet = vals[1];
            const airspeedKnots = vals[2];
            const totalWeightLbs = vals[3];
            const emptyWeightLbs = vals[4];
            const fuelWeightLbs = vals[5];  // FUEL TOTAL QUANTITY WEIGHT — already lbs, no KG bug
            const groundSpeedKnots = vals[6];
            const verticalSpeedFpm = vals[7];
            const planeLat = vals[8];
            const planeLon = vals[9];
            const onGround = vals[10] > 0.5;
            const stationWeights = vals.slice(11, 11 + STATION_COUNT); // [0]=stn1 … [14]=stn15
            const gpsEteSeconds = vals[26] || 0;  // GPS ETE: 0 when no dest programmed

            // ── Classify payload stations by name ────────────────────────────────
            // If names are all empty but the aircraft has payload weight, the names weren't
            // captured yet (SC connected before aircraft loaded / Start Flight scene change
            // without a full disconnect). Re-request once to pick up the real aircraft names.
            const allNamesEmpty = !this.stationNames || this.stationNames.every(n => !n);
            const estimatedPayload = Math.max(0, totalWeightLbs - emptyWeightLbs - fuelWeightLbs);
            if (allNamesEmpty && estimatedPayload > 50 && !this._namesRefreshPending) {
                this._namesRefreshPending = true;
                logger.info('[SimConnect] Station names empty but payload detected — re-requesting names for loaded aircraft');
                setTimeout(() => {
                    this._namesRefreshPending = false;
                    if (!this.isConnected || !this.handle) return;
                    try {
                        this.handle.requestDataOnSimObject(
                            REQ_ID_NAMES, DEF_ID_NAMES,
                            SimConnectConstants.OBJECT_ID_USER,
                            SimConnectPeriod.ONCE, 0, 0, 0, 0
                        );
                    } catch (e) {
                        logger.warn('[SimConnect] Names re-request failed:', e.message);
                    }
                }, 2000);
            }
            const names = this.stationNames || new Array(STATION_COUNT).fill('');
            let paxWeightLbs = 0;
            let cargoWeightLbs = 0;
            const paxStationWeights = [];  // individual pax-zone weights for GCD count derivation
            const stationDetails = [];     // emitted for boarding/deboarding UI

            for (let i = 0; i < STATION_COUNT; i++) {
                const name = names[i] || '';
                const weight = stationWeights[i] || 0;
                const cat = classifyStation(name);
                stationDetails.push({ index: i + 1, name, weight, category: cat });
                if (cat === CAT_PAX && weight > 0.5) {
                    paxWeightLbs += weight;
                    paxStationWeights.push(Math.round(weight));
                } else if (cat === CAT_CARGO && weight > 0.5) {
                    cargoWeightLbs += weight;
                }
            }

            // ── Derive pax count: total pax weight ÷ 170 lbs per person ────────
            const PAX_WEIGHT_PER_PERSON = 170;
            const paxCount = paxWeightLbs > 0 ? Math.round(paxWeightLbs / PAX_WEIGHT_PER_PERSON) : 0;

            // ── Derived weights ───────────────────────────────────────────────────
            const headingDegrees = ((headingRaw % 360) + 360) % 360;
            const payloadWeightLbs = Math.max(0, totalWeightLbs - emptyWeightLbs - fuelWeightLbs);
            const zeroFuelWeightLbs = emptyWeightLbs + paxWeightLbs + cargoWeightLbs;

            logger.debug(
                `[SimConnect] HDG:${headingDegrees.toFixed(1)}° ALT:${altitudeFeet.toFixed(0)}ft ` +
                `IAS:${airspeedKnots.toFixed(1)}kt FUEL:${fuelWeightLbs.toFixed(0)}lbs ` +
                `PAX:${paxCount}(${paxWeightLbs.toFixed(0)}lbs) CARGO:${cargoWeightLbs.toFixed(0)}lbs ` +
                `ONGROUND:${onGround}`
            );

            // ── Build telemetry object ────────────────────────────────────────────
            this.telemetry = {
                position: {
                    heading: headingDegrees,
                    lat: planeLat || 0,
                    lon: planeLon || 0
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
                    total: fuelWeightLbs,
                    usableTotal: fuelWeightLbs
                },
                weight: {
                    current: totalWeightLbs,
                    empty: emptyWeightLbs,
                    maxGross: 0,
                    payload: payloadWeightLbs,
                    zeroFuelWeight: zeroFuelWeightLbs,
                },
                passengers: {
                    count: paxCount,
                    weight: paxWeightLbs
                },
                cargo: {
                    weight: cargoWeightLbs
                },
                // Per-station detail — enables boarding/deboarding animation in UI
                payloadStations: stationDetails,
                onGround,
                navigation: {
                    nextWaypoint: null,
                    nextWaypointDistance: null,
                    eteSeconds: gpsEteSeconds > 0 ? gpsEteSeconds : null,
                    eteMinutes: gpsEteSeconds > 0 ? Math.round(gpsEteSeconds / 60) : null
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
                    `  Fuel: ${Math.round(fuelWeightLbs)} lbs (direct SimVar, no KG correction)\n` +
                    `  Passengers: ${paxCount} pax (${Math.round(paxWeightLbs)} lbs, GCD-derived)\n` +
                    `  Cargo: ${Math.round(cargoWeightLbs)} lbs (station-name-classified)\n` +
                    `  Total Weight: ${Math.round(totalWeightLbs)} lbs (Empty: ${Math.round(emptyWeightLbs)} lbs)\n` +
                    `  Position: ${planeLat?.toFixed(4)}°N ${planeLon?.toFixed(4)}°E\n` +
                    `  On ground: ${onGround}`
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
        this.stationNames = null;  // reset so reconnect re-fetches for the new aircraft
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
        this.stationNames = null;  // reset so reconnect re-fetches for the new aircraft
        this._stopPolling();
        this._scheduleReconnect();
    }

    /**
     * Schedule reconnection attempt
     * @private
     */
    _scheduleReconnect() {
        this.reconnectAttempts++;
        // Back off: 2s → 4s → 8s → … → 30s max. Retries indefinitely until MSFS starts.
        const delay = Math.min(this.reconnectDelay * Math.pow(1.5, Math.min(this.reconnectAttempts - 1, 8)), 30000);
        logger.info(
            `[SimConnect] Scheduling reconnect attempt ${this.reconnectAttempts} in ${Math.round(delay / 1000)}s (MSFS not yet running)`
        );

        setTimeout(() => {
            this.connect();
        }, delay);
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
     * Returns the cached station name classifications for external inspection.
     * Useful for logging or diagnostics.
     */
    getStationInfo() {
        if (!this.stationNames) return null;
        return this.stationNames.map((name, i) => ({
            index: i + 1,
            name,
            category: classifyStation(name)
        }));
    }
}

// Export singleton instance
module.exports = new SimConnectService();
