/**
 * SayIntentions.AI Crew Settings Diagnostic
 * 
 * This utility helps diagnose and test what crew settings
 * are being sent to SI and how they're being processed
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class SICrewDiagnostic {
  constructor(siApiKey) {
    this.siApiKey = siApiKey;
    this.siBaseUrl = 'https://apipri.sayintentions.ai/sapi';
  }

  /**
   * Read SI's flight.json to see what's currently loaded
   */
  async readSIFlightJson() {
    try {
      const flightJsonPath = path.join(
        process.env.LOCALAPPDATA || process.env.HOME,
        'SayIntentionsAI',
        'flight.json'
      );

      if (fs.existsSync(flightJsonPath)) {
        const rawData = fs.readFileSync(flightJsonPath, 'utf-8');
        const data = JSON.parse(rawData);

        logger.info('[SI Diagnostic] flight.json found and parsed');
        return {
          success: true,
          path: flightJsonPath,
          data: data,
          timestamp: new Date().toISOString()
        };
      } else {
        return {
          success: false,
          error: 'flight.json not found at: ' + flightJsonPath,
          path: flightJsonPath
        };
      }
    } catch (error) {
      logger.error('[SI Diagnostic] Error reading flight.json: ' + error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Extract crew-related data from flight.json
   */
  extractCrewFromFlightJson(flightData) {
    if (!flightData || !flightData.data) {
      return null;
    }

    const flight = flightData.data;

    // Try to find crew data at various possible locations
    const crewInfo = {
      general: {
        pilot_name: flight.pilot_name,
        pilot_id: flight.pilot_id,
        va_name: flight.va_name,
        va_code: flight.va_code,
      },
      copilot: {
        copilot_name: flight.copilot_name,
        copilot_id: flight.copilot_id,
      },
      aircraft: {
        type: flight.aircraft_model,
        registration: flight.aircraft_registration,
        simulator: flight.simulator,
      },
      flight: {
        number: flight.flight_number,
        callsign: flight.callsign,
        departure: flight.departure_icao,
        arrival: flight.arrival_icao,
      },
      // Look for any personality or custom data
      customData: {}
    };

    // Look for personality info in the flight object
    Object.keys(flight).forEach(key => {
      if (key.includes('personality') ||
        key.includes('crew') ||
        key.includes('dispatcher') ||
        key.includes('copilot') ||
        key.includes('custom')) {
        crewInfo.customData[key] = flight[key];
      }
    });

    return crewInfo;
  }

  /**
   * Log what crew data we're about to send
   * Call this BEFORE dispatching to SI
   */
  logDispatchPayload(flight, preferences = {}) {
    const timestamp = new Date().toISOString();

    // Simulate the crew data building (from siDispatchService)
    const firstCrew = flight.FlightCrews?.[0] || {};
    const crewName = firstCrew.People?.Company?.Name || 'Captain';
    const crewLevel = firstCrew.People?.Company?.Level || 'Professional';

    const dispatchInfo = {
      timestamp,
      flight: {
        number: flight.FlightNumber,
        departure: flight.DepartureAirport,
        arrival: flight.ArrivalIntendedAirport,
        aircraft: flight.Aircraft?.AircraftType?.Name,
      },
      crew: {
        name: crewName,
        level: crewLevel,
        personality: preferences.crewPersonality || 'professional',
        customNotes: preferences.customCrewNotes || '(none)',
      },
      dispatcher: {
        tone: preferences.dispatcherTone || 'formal',
        flightConditions: preferences.flightConditions || 'VFR',
      },
      copilot: {
        personality: preferences.copilotPersonality || 'professional',
        customNotes: preferences.customCopilotNotes || '(none)',
      }
    };

    logger.info('[SI Diagnostic] Dispatch Payload:');
    logger.info(JSON.stringify(dispatchInfo, null, 2));

    return dispatchInfo;
  }

  /**
   * Create a detailed diagnostic report
   */
  async createDiagnosticReport() {
    logger.info('[SI Diagnostic] ='.repeat(40));
    logger.info('[SI Diagnostic] SI CREW SETTINGS DIAGNOSTIC REPORT');
    logger.info('[SI Diagnostic] ='.repeat(40));

    const report = {
      timestamp: new Date().toISOString(),
      flightJsonStatus: await this.readSIFlightJson(),
      apiKey: {
        provided: !!this.siApiKey,
        keyStart: this.siApiKey ? this.siApiKey.substring(0, 4) + '***' : 'NOT PROVIDED'
      }
    };

    // Extract crew info if flight.json exists
    if (report.flightJsonStatus.success && report.flightJsonStatus.data) {
      report.crewFromFlightJson = this.extractCrewFromFlightJson(report.flightJsonStatus);
    }

    logger.info('[SI Diagnostic] Report generated:');
    logger.info(JSON.stringify(report, null, 2));

    return report;
  }

  /**
   * Compare what we sent vs what's in SI
   */
  compareDispatchVsActual(dispatchPayload, siFlightJson) {
    const comparison = {
      match: {},
      mismatch: {},
      missing: {}
    };

    if (!siFlightJson || !siFlightJson.data) {
      return {
        status: 'NO_SI_DATA',
        error: 'Cannot read SI flight.json'
      };
    }

    const flight = siFlightJson.data;

    // Check crew info
    if (dispatchPayload.crew.name) {
      const siHasCrewName = flight.pilot_name || flight.crew_data?.includes(dispatchPayload.crew.name);
      comparison.match.crew_name = siHasCrewName;
    }

    // Check flight info
    if (dispatchPayload.flight.number && flight.flight_number) {
      comparison.match.flight_number = dispatchPayload.flight.number === flight.flight_number;
    }

    if (dispatchPayload.flight.departure && flight.departure_icao) {
      comparison.match.departure = dispatchPayload.flight.departure === flight.departure_icao;
    }

    if (dispatchPayload.flight.arrival && flight.arrival_icao) {
      comparison.match.arrival = dispatchPayload.flight.arrival === flight.arrival_icao;
    }

    return {
      status: 'COMPARED',
      comparison,
      dispatchedData: dispatchPayload,
      siData: this.extractCrewFromFlightJson(siFlightJson)
    };
  }
}

module.exports = SICrewDiagnostic;
