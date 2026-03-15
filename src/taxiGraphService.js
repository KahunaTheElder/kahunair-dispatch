'use strict';

/**
 * TaxiGraphService — SimConnect Facility API taxi-path resolver
 *
 * Fetches the taxi graph (TAXI_POINT, TAXI_PATH, TAXI_NAME) for a given
 * airport ICAO via SimConnect, caches it for the session, then resolves
 * SayIntentions.AI taxi_path waypoints into a clean taxiway-name sequence.
 *
 * Formula confirmed March 2026 at EGLL (<0.5m lat error across two gates):
 *   lat = airRefLat + biasZ / 111111
 *   lon = airRefLon + biasX / (111111 × cos(airRefLat × π/180))
 *   where biasZ = northing (+north), biasX = easting (+east)
 */

const { FacilityDataType } = require('node-simconnect');
const logger = require('./logger');

// Facility definition ID — above simConnectService's 0 (telemetry) and 1 (names)
const DEF_FACILITY = 10;

// Request IDs start at 100, well clear of simConnectService's 0 and 1
let _reqCounter = 100;

// Maximum distance (metres) to snap an SI waypoint to a TAXI_POINT node
const SNAP_THRESHOLD_M = 50;

const R_EARTH = 6371000;

function haversine(la1, lo1, la2, lo2) {
    const dLat = (la2 - la1) * Math.PI / 180;
    const dLon = (lo2 - lo1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R_EARTH * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

class TaxiGraphService {
    constructor() {
        // The SimConnect handle we have event listeners registered on
        this._listeningHandle = null;
        this._defRegistered = false;

        // ICAO → resolved graph { pts[], taxiNames[], edgeMap }
        this._cache = new Map();

        // reqId → { icao, airportRef, taxiPoints[], taxiPaths[], taxiNames[], timeout }
        this._pending = new Map();
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Resolve SI taxi_path waypoints to a clean taxiway-name sequence.
     *
     * Non-blocking: returns the resolved route array from cache when available,
     * or null on the first call (while the graph is fetched in the background).
     * The next poll cycle (15 s) will return the full route.
     *
     * @param {Array}  siWaypoints  cf.taxi_path — array of {heading, point:{lat,lon}}
     * @param {string} icao         Departure/origin airport ICAO
     * @returns {string[]|null}     e.g. ['C','B','L28','N1B'] or null
     */
    getRoute(siWaypoints, icao) {
        if (!Array.isArray(siWaypoints) || siWaypoints.length === 0 || !icao) return null;

        // Lazy require avoids circular-dependency at module-load time
        let simConnectService;
        try { simConnectService = require('./simConnectService'); } catch (_) { return null; }

        const handle = simConnectService?.handle;
        if (!handle) return null;

        this._ensureListeners(handle);

        // Fast path — return from cache
        if (this._cache.has(icao)) {
            return this._resolveRoute(this._cache.get(icao), siWaypoints);
        }

        // Background fetch — caller gets null this cycle, route on next poll
        const alreadyPending = [...this._pending.values()].some(p => p.icao === icao);
        if (!alreadyPending) {
            this._startFetch(handle, icao);
        }
        return null;
    }

    /** Evict all cached graphs (call on new flight detection if desired) */
    clearCache() {
        this._cache.clear();
        logger.info('[TaxiGraph] Cache cleared');
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    /**
     * Register event listeners on the current SimConnect handle.
     * Detects handle replacement (reconnects) and resets state accordingly.
     */
    _ensureListeners(handle) {
        if (handle === this._listeningHandle) return;

        if (this._listeningHandle) {
            logger.info('[TaxiGraph] SimConnect handle replaced — clearing cache');
            this._cache.clear();
            for (const p of this._pending.values()) clearTimeout(p.timeout);
            this._pending.clear();
            this._defRegistered = false;
        }

        this._listeningHandle = handle;
        this._registerDef(handle);
        handle.on('facilityData',    (recv) => this._onFacilityData(recv));
        handle.on('facilityDataEnd', (recv) => this._onFacilityDataEnd(recv));
        logger.info('[TaxiGraph] Facility listeners registered on SimConnect handle');
    }

    _registerDef(handle) {
        if (this._defRegistered) return;

        handle.addToFacilityDefinition(DEF_FACILITY, 'OPEN AIRPORT');
        handle.addToFacilityDefinition(DEF_FACILITY, 'LATITUDE');
        handle.addToFacilityDefinition(DEF_FACILITY, 'LONGITUDE');

        handle.addToFacilityDefinition(DEF_FACILITY, 'OPEN TAXI_POINT');
        handle.addToFacilityDefinition(DEF_FACILITY, 'TYPE');      // INT32 — read and discarded
        handle.addToFacilityDefinition(DEF_FACILITY, 'BIAS_X');    // FLOAT32 easting  (m from ARP)
        handle.addToFacilityDefinition(DEF_FACILITY, 'BIAS_Z');    // FLOAT32 northing (m from ARP)
        handle.addToFacilityDefinition(DEF_FACILITY, 'CLOSE TAXI_POINT');

        handle.addToFacilityDefinition(DEF_FACILITY, 'OPEN TAXI_PATH');
        handle.addToFacilityDefinition(DEF_FACILITY, 'START');       // INT32  TAXI_POINT index
        handle.addToFacilityDefinition(DEF_FACILITY, 'END');          // INT32  TAXI_POINT index
        handle.addToFacilityDefinition(DEF_FACILITY, 'NAME_INDEX');   // UINT32 → TAXI_NAME array
        handle.addToFacilityDefinition(DEF_FACILITY, 'TYPE');         // INT32  0=taxi 1=runway 2=parking…
        handle.addToFacilityDefinition(DEF_FACILITY, 'CLOSE TAXI_PATH');

        handle.addToFacilityDefinition(DEF_FACILITY, 'OPEN TAXI_NAME');
        handle.addToFacilityDefinition(DEF_FACILITY, 'NAME');        // STRING32 taxiway label
        handle.addToFacilityDefinition(DEF_FACILITY, 'CLOSE TAXI_NAME');

        handle.addToFacilityDefinition(DEF_FACILITY, 'CLOSE AIRPORT');

        this._defRegistered = true;
        logger.info(`[TaxiGraph] Facility definition registered (DEF=${DEF_FACILITY})`);
    }

    _startFetch(handle, icao) {
        const reqId = _reqCounter++;
        if (_reqCounter > 9999) _reqCounter = 100;

        const timeout = setTimeout(() => {
            if (this._pending.has(reqId)) {
                logger.warn(`[TaxiGraph] Timeout waiting for ${icao} facility data (reqId=${reqId})`);
                this._pending.delete(reqId);
            }
        }, 30000);

        this._pending.set(reqId, {
            icao,
            airportRef: null,
            taxiPoints: [],
            taxiPaths:  [],
            taxiNames:  [],
            timeout,
        });

        logger.info(`[TaxiGraph] Requesting facility data for ${icao} (reqId=${reqId})`);
        handle.requestFacilityData(DEF_FACILITY, reqId, icao);
    }

    _onFacilityData(recv) {
        const pending = this._pending.get(recv.userRequestId);
        if (!pending) return;

        const buf = recv.data;
        try {
            switch (recv.type) {
                case FacilityDataType.AIRPORT:
                    pending.airportRef = {
                        lat: buf.readFloat64(),
                        lon: buf.readFloat64(),
                    };
                    break;

                case FacilityDataType.TAXI_POINT:
                    buf.readInt32(); // TYPE field — consumed, not used for routing
                    pending.taxiPoints.push({
                        idx:   recv.itemIndex,
                        biasX: buf.readFloat32(),
                        biasZ: buf.readFloat32(),
                    });
                    break;

                case FacilityDataType.TAXI_PATH:
                    pending.taxiPaths.push({
                        start:     buf.readInt32(),
                        end:       buf.readInt32(),
                        nameIndex: buf.readUint32(),
                        isRunway:  buf.readInt32() === 1,  // TYPE: 0=taxiway 1=runway surface
                    });
                    break;

                case FacilityDataType.TAXI_NAME:
                    pending.taxiNames.push({
                        idx:  recv.itemIndex,
                        name: buf.readString32().replace(/\0/g, '').trim(),
                    });
                    break;
            }
        } catch (e) {
            logger.warn(`[TaxiGraph] Parse error type=${recv.type} idx=${recv.itemIndex}: ${e.message}`);
        }
    }

    _onFacilityDataEnd(recv) {
        const pending = this._pending.get(recv.userRequestId);
        if (!pending) return;

        this._pending.delete(recv.userRequestId);
        clearTimeout(pending.timeout);

        const { icao, airportRef, taxiPoints, taxiPaths, taxiNames } = pending;

        if (!airportRef) {
            logger.warn(`[TaxiGraph] No airport reference received for ${icao}`);
            return;
        }

        const cosLat = Math.cos(airportRef.lat * Math.PI / 180);

        // Convert TAXI_POINT biases to lat/lon — H_A formula, confirmed EGLL March 2026
        const pts = taxiPoints.map(p => ({
            idx: p.idx,
            lat: airportRef.lat + p.biasZ / 111111,
            lon: airportRef.lon + p.biasX / (111111 * cosLat),
        }));

        // Bi-directional edge map: 'startIdx_endIdx' → { nameIndex, isRunway }
        const edgeMap = new Map();
        for (const path of taxiPaths) {
            const entry = { nameIndex: path.nameIndex, isRunway: path.isRunway };
            edgeMap.set(`${path.start}_${path.end}`, entry);
            edgeMap.set(`${path.end}_${path.start}`, entry);
        }

        this._cache.set(icao, { pts, taxiNames, edgeMap });
        logger.info(
            `[TaxiGraph] Graph cached for ${icao}: ` +
            `${pts.length} pts, ${taxiPaths.length} paths, ${taxiNames.length} names`
        );
    }

    /**
     * Resolve a cached graph against SI waypoints.
     *
     * Algorithm:
     *  1. Snap each SI {lat,lon} waypoint to the nearest TAXI_POINT (≤50 m)
     *  2. Walk the snapped sequence resolving taxiway names via the edge map
     *  3. Strip blanks, deduplicate consecutive identical names
     *  4. Iteratively collapse "sandwich interlopers": X A X → X
     *     (cross-taxiway junction nodes that briefly label a B-spine segment
     *      with a cross-taxiway name — e.g. B D B → B)
     */
    _resolveRoute(graph, siWaypoints) {
        const { pts, taxiNames, edgeMap } = graph;

        // Normalise SI waypoint structure: {heading, point:{lat,lon}} or bare {lat,lon}
        const waypoints = siWaypoints
            .map(w => w.point || w)
            .filter(p => p && p.lat != null && p.lon != null);

        if (waypoints.length === 0) return null;

        // Snap waypoints to nearest TAXI_POINT within threshold
        let _snapBestDist0 = Infinity;
        const snapped = waypoints.map((wp, wi) => {
            let best = null, bestDist = Infinity;
            for (const p of pts) {
                const d = haversine(wp.lat, wp.lon, p.lat, p.lon);
                if (d < bestDist) { bestDist = d; best = p; }
            }
            if (wi === 0) _snapBestDist0 = bestDist;
            return bestDist <= SNAP_THRESHOLD_M ? best.idx : null;
        });
        if (_snapBestDist0 > SNAP_THRESHOLD_M) {
            logger.warn(`[TaxiGraph] snap miss on wp[0]: bestDist=${_snapBestDist0.toFixed(1)}m — airport ref: ${pts[0]?.lat?.toFixed(6)},${pts[0]?.lon?.toFixed(6)}, wp: ${waypoints[0]?.lat?.toFixed(6)},${waypoints[0]?.lon?.toFixed(6)}`);
        }

        // Walk snapped sequence, resolve taxiway name for each consecutive edge
        const snapMisses = snapped.filter(idx => idx === null).length;
        const matched = snapped.filter(idx => idx !== null);
        const uniqueMatched = [...new Set(matched)];
        logger.debug(`[TaxiGraph] snap: ${waypoints.length} wps → ${matched.length} hits, ${snapMisses} misses, ${uniqueMatched.length} unique nodes: [${uniqueMatched.join(',')}]`);
        const segNames = [];
        for (let i = 0; i < matched.length - 1; i++) {
            const edge = edgeMap.get(`${matched[i]}_${matched[i + 1]}`);
            if (edge === undefined) continue;
            const name = taxiNames[edge.nameIndex]?.name || '';
            if (name) {
                segNames.push(name);
            } else if (edge.isRunway) {
                segNames.push('HOLD SHORT');
            }
        }
        logger.debug(`[TaxiGraph] segNames (pre-filter): ${JSON.stringify(segNames)}`);

        // Step 1 — strip blanks, dedup consecutive identical names
        let route = [];
        for (const n of segNames) {
            if (!n) continue;
            if (!route.length || route[route.length - 1] !== n) route.push(n);
        }

        // Step 2 — iteratively collapse sandwich interlopers until stable
        //   Pattern: [..., X, A, X, ...] where A ≠ X → remove A, then dedup
        //   This cleans up cross-taxiway junction labels in the Bravo spine:
        //   C B D B E B F B R B L34 B L32 B L31 B L28 N1B → C B L28 N1B
        let changed = true;
        while (changed) {
            changed = false;
            const next = [];
            for (let i = 0; i < route.length; i++) {
                if (
                    i > 0 && i < route.length - 1 &&
                    route[i - 1] === route[i + 1] &&
                    route[i] !== route[i - 1] &&
                    !route[i].startsWith('HOLD SHORT')
                ) {
                    changed = true; // drop the interloper
                } else {
                    next.push(route[i]);
                }
            }
            // Dedup consecutive after each collapse pass
            route = [];
            for (const n of next) {
                if (!route.length || route[route.length - 1] !== n) route.push(n);
            }
        }

        return route.length > 0 ? route : null;
    }
}

module.exports = new TaxiGraphService();
