const axios = require('axios');
const xml2js = require('xml2js');

/**
 * SimBrief API Client
 * Fetches flight plan data (OFP - Operational Flight Plan) from SimBrief
 * 
 * API: https://www.simbrief.com/api/xml.fetcher.php (XML endpoint)
 * Pilot ID format: numeric string (from SimBrief account settings)
 */

class SimBriefClient {
  constructor(config = {}) {
    this.apiUrl = 'https://www.simbrief.com/api/xml.fetcher.php';
    this.timeout = config.timeout || 10000; // Increased to allow full XML fetch
    this.xmlParser = new xml2js.Parser({ explicitArray: false });
  }

  /**
   * Fetch latest OFP for a pilot via XML endpoint
   * @param {string} pilotId - SimBrief pilot ID (numeric)
   * @returns {Object} OFP data or null if not found
   */
  async getLatestOFP(pilotId) {
    if (!pilotId || String(pilotId).trim().length === 0) {
      throw new Error('SimBrief Pilot ID is required');
    }

    try {
      console.log(`[SimBrief] Fetching OFP for pilot ID: ${pilotId}`);
      const startTime = Date.now();

      const response = await axios.get(
        `${this.apiUrl}?userid=${pilotId}`,
        { timeout: this.timeout }
      );

      const duration = Date.now() - startTime;
      console.log(`[SimBrief] OFP fetch completed in ${duration}ms (${response.data.length} bytes)`);

      if (!response.data) {
        throw new Error('No data returned from SimBrief API');
      }

      // Parse XML response
      const parsedXml = await this.xmlParser.parseStringPromise(response.data);

      // Check if SimBrief returned an OFP
      if (!parsedXml.OFP) {
        throw new Error('No flight plan found for this pilot');
      }

      // Extract and parse the OFP data
      return this.parseOFP(parsedXml.OFP);
    } catch (error) {
      console.error(`[SimBrief] OFP fetch failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Parse and extract key fields from SimBrief OFP XML response
   * Handles XML structure with flexible field mapping
   */
  parseOFP(rawData) {
    try {
      // XML structure: rawData is the OFP object
      const rawDataKeys = Object.keys(rawData);
      console.log('[SimBrief] Top-level OFP keys:', rawDataKeys);
      // Log all available keys in each major section
      const general = rawData.general || rawData.General || [];
      const generalData = Array.isArray(general) ? general[0] : general;
      if (generalData) console.log('[SimBrief] General section keys:', Object.keys(generalData));

      const params = rawData.params || rawData.Params || [];
      const paramsData = Array.isArray(params) ? params[0] : params;
      if (paramsData) console.log('[SimBrief] Params section keys:', Object.keys(paramsData));

      // Access weights section
      const weights = rawData.weights || rawData.Weights || [];
      const weightsData = Array.isArray(weights) ? weights[0] : weights;
      if (weightsData) console.log('[SimBrief] Weights section keys:', Object.keys(weightsData));

      // Access fuel section
      const fuel = rawData.fuel || rawData.Fuel || [];
      const fuelData = Array.isArray(fuel) ? fuel[0] : fuel;
      if (fuelData) console.log('[SimBrief] Fuel section keys:', Object.keys(fuelData));

      // Access origin/departure
      const origin = rawData.origin || rawData.Origin || [];
      const originData = Array.isArray(origin) ? origin[0] : origin;
      if (originData) console.log('[SimBrief] Origin section keys:', Object.keys(originData));

      // Access destination/arrival
      const destination = rawData.destination || rawData.Destination || [];
      const destinationData = Array.isArray(destination) ? destination[0] : destination;
      if (destinationData) console.log('[SimBrief] Destination section keys:', Object.keys(destinationData));

      // Access alternate
      const alternate = rawData.alternate || rawData.Alternate || [];
      const alternateData = Array.isArray(alternate) ? alternate[0] : alternate;

      // Access navlog - first leg is departure, last is arrival
      // xml2js may return single object or array depending on XML structure
      const navlogRaw = rawData.navlog || rawData.Navlog || [];
      const navlog = Array.isArray(navlogRaw) ? navlogRaw : (navlogRaw && Object.keys(navlogRaw).length > 0 ? [navlogRaw] : []);

      // Extract fix array from navlog object
      let fixes = [];
      if (navlog.length > 0 && navlog[0].fix) {
        fixes = Array.isArray(navlog[0].fix) ? navlog[0].fix : [navlog[0].fix];
      }

      // Safe field accessor for deeply nested values and various naming conventions
      const getField = (obj, ...fieldNames) => {
        if (!obj) return null;
        for (const fieldName of fieldNames) {
          // Try exact match first
          if (obj[fieldName] !== undefined) return obj[fieldName];
          // Try lowercase variant
          if (obj[fieldName.toLowerCase()] !== undefined) return obj[fieldName.toLowerCase()];
          // Try snake_case to camelCase conversion
          const camelCase = fieldName.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
          if (obj[camelCase] !== undefined) return obj[camelCase];
        }
        return null;
      };

      // Extract procedure fields - SimBrief uses plan_rwy for planned runway
      const depRunway = getField(originData, 'plan_rwy', 'runway', 'dep_runway', 'departure_runway', 'runway_id') || '';
      const arrRunway = getField(destinationData, 'plan_rwy', 'runway', 'arr_runway', 'arrival_runway', 'runway_id') || '';

      // Extract SID/STAR from navlog waypoints
      // SID: via_airway from first CLB (climb) waypoint marked as SID/STAR (is_sid_star=1)
      // STAR: via_airway from first DSC (descent) waypoint marked as SID/STAR (is_sid_star=1)
      // If no marked CLB/DSC found, SID/STAR remain empty - this is valid (some flights may not have procedures)
      let depSID = '';
      let arrSTAR = '';

      if (fixes && fixes.length > 0) {
        // Find first CLB (climb) waypoint that's marked as part of SID/STAR
        const climbWaypoint = fixes.find(f => f.stage === 'CLB' && (f.is_sid_star === '1' || f.is_sid_star === 1));
        if (climbWaypoint && climbWaypoint.via_airway) {
          depSID = climbWaypoint.via_airway;
        }

        // Find first DSC (descent) waypoint that's marked as part of SID/STAR
        const descentWaypoint = fixes.find(f => f.stage === 'DSC' && (f.is_sid_star === '1' || f.is_sid_star === 1));
        if (descentWaypoint && descentWaypoint.via_airway) {
          arrSTAR = descentWaypoint.via_airway;
        }
      }

      console.log('[SimBrief Parsing] Extracted: DEP_RWY=%s%s, ARR_RWY=%s%s', depRunway, depSID ? ` SID=${depSID}` : ' (no SID)', arrRunway, arrSTAR ? ` STAR=${arrSTAR}` : ' (no STAR)');

      // Extract from origin (departure)
      const originICAO = getField(originData, 'icao_code', 'icaoCode', 'icao', 'code') || '';
      const originName = getField(originData, 'name', 'city') || '';
      const originIATA = getField(originData, 'iata_code', 'iataCode', 'iata') || '';

      // Extract from destination (arrival)
      const destRunwaysObj = destinationData?.runways?.[0] || destinationData?.runway?.[0] || destinationData;
      const destICAO = getField(destinationData, 'icao_code', 'icaoCode', 'icao', 'code') || '';
      const destName = getField(destinationData, 'name', 'city') || '';
      const destIATA = getField(destinationData, 'iata_code', 'iataCode', 'iata') || '';

      // Extract from alternate
      const altICAO = getField(alternateData, 'icao_code', 'icaoCode', 'icao', 'code') || '';
      const altName = getField(alternateData, 'name', 'city') || '';
      const altIATA = getField(alternateData, 'iata_code', 'iataCode', 'iata') || '';

      const ofp = {
        // Flight identifiers
        flightNumber: getField(generalData, 'flight_number', 'flightNumber', 'route', 'flight') || '',
        pilotId: getField(generalData, 'pilot_id', 'pilotId') || '',

        // Route information - using ICAO codes from XML
        departure: {
          ICAO: originICAO,
          name: originName,
          iata: originIATA,
          SID: depSID,
          runway: depRunway
        },
        arrival: {
          ICAO: destICAO,
          name: destName,
          iata: destIATA,
          STAR: arrSTAR,
          runway: arrRunway
        },
        alternate: {
          ICAO: altICAO,
          name: altName,
          iata: altIATA
        },

        // Flight plan details
        route: getField(rawData, 'route', 'route') || getField(generalData, 'route') || '',

        // Cruise information
        cruise: {
          level: parseInt(getField(generalData, 'cruise_fl', 'cruiseFl', 'initial_altitude', 'initialAltitude') || 0) || 0,
          speed: parseFloat(getField(generalData, 'cruise_mach', 'cruiseMach') || 0) || 0
        },

        // Weather and environment
        weather: {
          avgWindDir: parseInt(getField(generalData, 'avg_wind_dir', 'avgWindDir') || 0) || 0,
          avgWindSpd: parseInt(getField(generalData, 'avg_wind_spd', 'avgWindSpd') || 0) || 0,
          isaDeviation: parseInt(getField(generalData, 'avg_temp_dev', 'avgTempDev') || 0) || 0,
          notes: getField(generalData, 'notes', 'sys_rmk', 'sysRmk') || ''
        },

        // Weight and balance
        weights: {
          zeroFuelWeight: parseInt(getField(weightsData, 'est_zfw', 'zfw', 'zero_fuel_weight') || 0) || 0,
          takeoffWeight: parseInt(getField(weightsData, 'est_tow', 'tow', 'takeoff_weight') || 0) || 0,
          landingWeight: parseInt(getField(weightsData, 'est_ldw', 'llw', 'landing_weight') || 0) || 0,
          maxPayload: parseInt(getField(weightsData, 'max_payload', 'payload') || 0) || 0
        },

        // Fuel planning
        fuel: {
          plannedGallons: parseInt(getField(fuelData, 'plan_ramp') || 0) || 0,
          plannedLbs: parseInt(getField(fuelData, 'plan_ramp') || 0) || 0,
          contingency: parseInt(getField(fuelData, 'contingency') || 0) || 0,
          alternate: parseInt(getField(fuelData, 'alternate_burn') || 0) || 0,
          reserve: parseInt(getField(fuelData, 'reserve') || 0) || 0
        },

        // Capacity and payload
        payload: {
          passengers: parseInt(getField(rawData, 'params', 'pax') || 0) || 0,
          cargoWeight: parseInt(getField(rawData, 'params', 'cargo') || 0) || 0,
          deadHeadingCrew: parseInt(getField(rawData, 'params', 'dhc') || 0) || 0
        },

        // Flight times
        estimatedTime: parseInt(getField(generalData, 'flight_time', 'flightTime') || getField(generalData, 'total_minutes', 'totalMinutes') || 0) || 0,
        blockTime: parseInt(getField(generalData, 'block_time', 'blockTime') || 0) || 0,

        // Raw metadata
        downloadedAt: new Date().toISOString(),
        ofpId: getField(rawData, 'ofp_id', 'ofpId') || '',
        timestamp: getField(generalData, 'time_generated', 'timeGenerated') || ''
      };

      return ofp;
    } catch (error) {
      console.error(`[SimBrief] OFP parsing error: ${error.message}`);
      throw new Error(`Failed to parse OFP data: ${error.message}`);
    }
  }

  /**
   * Validate OFP has required fields for dispatch
   */
  validateOFP(ofp) {
    const required = [
      'departure.ICAO',
      'arrival.ICAO',
      'cruise.level',
      'estimatedTime'
    ];

    const missing = required.filter(field => {
      const value = field.split('.').reduce((obj, key) => obj?.[key], ofp);
      return !value;
    });

    if (missing.length > 0) {
      console.warn(`[SimBrief] OFP missing fields: ${missing.join(', ')}`);
    }

    return missing.length === 0;
  }
}

module.exports = SimBriefClient;
