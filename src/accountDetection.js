/**
 * KahunaAir Account Detection Service
 * 
 * Automatically detects whether a user is flying as a VA pilot or private pilot
 * by checking both account credentials against the OnAir API.
 * 
 * Usage:
 * const detector = new AccountDetectionService();
 * const account = await detector.detectActiveAccount();
 * // Returns: { accountType: 'VA' | 'PRIVATE', companyId, apiKey, ... }
 */

const axios = require('axios');

class AccountDetectionService {
  constructor(config = {}) {
    this.baseUrl = config.baseUrl || 'https://server1.onair.company';

    // VA Credentials
    this.vaCompanyId = config.vaCompanyId || process.env.ONAIR_VA_COMPANY_ID;
    this.vaApiKey = config.vaApiKey || process.env.ONAIR_VA_API_KEY;

    // Private Pilot Credentials
    this.privateCompanyId = config.privateCompanyId || process.env.ONAIR_PRIVATE_COMPANY_ID;
    this.privateApiKey = config.privateApiKey || process.env.ONAIR_PRIVATE_API_KEY;

    console.log('[AccountDetection Constructor] Loaded credentials:');
    console.log('[AccountDetection Constructor]   VA Company ID:', this.vaCompanyId ? '✓' : '✗ MISSING');
    console.log('[AccountDetection Constructor]   VA API Key:', this.vaApiKey ? '✓' : '✗ MISSING');
    console.log('[AccountDetection Constructor]   Private Company ID:', this.privateCompanyId ? '✓' : '✗ MISSING');
    console.log('[AccountDetection Constructor]   Private API Key:', this.privateApiKey ? '✓' : '✗ MISSING');
  }

  /**
   * Check if an account has an active flight by querying the flights endpoint
   * @returns {Object} { hasActiveFlight, activeFlightId, flightData, ... }
   */
  async checkAccountFlight(companyId, apiKey, accountType) {
    console.log(`[AccountDetection] Checking ${accountType} account for active flights...`);
    const checkStart = Date.now();
    try {
      console.log(`[AccountDetection] ${accountType}: Sending API request...`);
      const response = await axios.get(
        `${this.baseUrl}/api/v1/company/${companyId}/flights`,
        {
          headers: { 'oa-apikey': apiKey },
          timeout: 3000  // REDUCED from 10s to 3s for faster startup
        }
      );

      const checkDuration = Date.now() - checkStart;
      const flights = response.data.Content || response.data.content || response.data;
      console.log(`[AccountDetection] ${accountType}: Got response in ${checkDuration}ms, flights type:`, typeof flights, 'is array:', Array.isArray(flights));

      if (!Array.isArray(flights)) {
        console.warn(`[AccountDetection] ${accountType}: Flights not an array, trying direct access`);
        return {
          accountType,
          isValid: true,
          flightActive: false,
          error: 'Flights not in expected array format',
          receivedType: typeof flights
        };
      }

      console.log(`[AccountDetection] ${accountType}: Found ${flights.length} flights`);

      // Find the active flight (one that's in progress, not registered)
      const activeFlight = flights.find(flight => {
        const isInProgress = flight.Registered !== true;
        const hasStarted = flight.AirborneTime || flight.EngineOnTime || flight.StartTime;
        if (isInProgress && hasStarted) {
          console.log(`[AccountDetection] ${accountType}: Found active flight! Keys:`, Object.keys(flight).join(', '));
          console.log(`[AccountDetection] ${accountType}: Key properties - Id: ${flight.Id || 'N/A'}, FlightId: ${flight.FlightId || 'N/A'}`);
        }
        return isInProgress && hasStarted;
      });

      if (!activeFlight) {
        console.log(`[AccountDetection] ${accountType}: No active flight found`);
        return {
          accountType,
          isValid: true,
          flightActive: false,
          totalFlights: flights.length
        };
      }

      console.log(`[AccountDetection] ${accountType}: ACTIVE FLIGHT!!`, activeFlight.Id);

      // Extract key flight details - use exact property names from API response
      const aircraftType = activeFlight.Aircraft?.AircraftType || activeFlight.Aircraft;
      const result = {
        accountType,
        isValid: true,
        flightActive: true,
        flightId: activeFlight.Id,  // Use 'Id' not 'FlightId'
        flightNumber: `${activeFlight.CompanyId}-${activeFlight.Id.substring(0, 8)}`,  // Generate flight number from company and ID
        departureAirport: activeFlight.DepartureAirport,
        arrivalAirport: activeFlight.ArrivalIntendedAirport,  // Use ArrivalIntendedAirport
        aircraft: aircraftType,  // Extract AircraftType from Aircraft object
        status: activeFlight.Registered ? 'COMPLETED' : 'IN_PROGRESS',
        startTime: activeFlight.StartTime,
        engineOnTime: activeFlight.EngineOnTime,
        airborneTime: activeFlight.AirborneTime,
        fullFlightData: activeFlight
      };
      const aircraftName = result.aircraft && result.aircraft.DisplayName ? result.aircraft.DisplayName : (result.aircraft ? 'object' : 'undefined');
      console.log(`[AccountDetection] ${accountType}: Extracted fields - flightId: ${result.flightId}, aircraft: ${aircraftName}`);
      return result;
    } catch (error) {
      const checkDuration = Date.now() - checkStart;
      console.error(`[AccountDetection] ${accountType} error after ${checkDuration}ms:`, error.message);
      return {
        accountType,
        isValid: false,
        error: error.message,
        flightActive: false,
        duration: checkDuration
      };
    }
  }

  /**
   * Detect which account (VA or Private) has an active flight
   * @returns {Object|null} Account config with active flight, or null if none
   */
  async detectActiveAccount() {
    console.log('[AccountDetection] Starting parallel account checks...');
    const detectStart = Date.now();

    // Check both accounts in parallel with timeout protection
    const [vaStatus, privateStatus] = await Promise.all([
      this.checkAccountFlight(this.vaCompanyId, this.vaApiKey, 'VA'),
      this.checkAccountFlight(this.privateCompanyId, this.privateApiKey, 'PRIVATE')
    ]);

    const detectDuration = Date.now() - detectStart;
    console.log(`[AccountDetection] Parallel checks completed in ${detectDuration}ms`);
    console.log('[AccountDetection] VA Status:', { flightActive: vaStatus.flightActive, isValid: vaStatus.isValid, duration: vaStatus.duration });
    console.log('[AccountDetection] PRIVATE Status:', { flightActive: privateStatus.flightActive, isValid: privateStatus.isValid, duration: privateStatus.duration });

    // Check for conflicts (both active)
    if (vaStatus.flightActive && privateStatus.flightActive) {
      console.warn('[AccountDetection] CONFLICT: Both accounts have active flights!');
      const conflictResult = {
        accountType: 'MULTIPLE_ACTIVE',
        error: 'Both VA and Private accounts have active flights',
        va: vaStatus,
        private: privateStatus
      };
      console.log('[AccountDetection] Returning conflict result:', Object.keys(conflictResult));
      return conflictResult;
    }

    // Return whichever is active
    if (vaStatus.flightActive) {
      console.log('[AccountDetection] VA account has active flight:', vaStatus.flightNumber);
      const result = {
        accountType: 'VA',
        companyId: this.vaCompanyId,
        apiKey: this.vaApiKey,
        flightId: vaStatus.flightId,
        flightNumber: vaStatus.flightNumber,
        departureAirport: vaStatus.departureAirport,
        arrivalAirport: vaStatus.arrivalAirport,
        aircraft: vaStatus.aircraft,
        fullFlightData: vaStatus.fullFlightData
      };
      console.log('[AccountDetection] Returning VA result with flightId:', result.flightId);
      return result;
    }

    if (privateStatus.flightActive) {
      console.log('[AccountDetection] PRIVATE account has active flight:', privateStatus.flightNumber);
      const result = {
        accountType: 'PRIVATE',
        companyId: this.privateCompanyId,
        apiKey: this.privateApiKey,
        flightId: privateStatus.flightId,
        flightNumber: privateStatus.flightNumber,
        departureAirport: privateStatus.departureAirport,
        arrivalAirport: privateStatus.arrivalAirport,
        aircraft: privateStatus.aircraft,
        fullFlightData: privateStatus.fullFlightData
      };
      console.log('[AccountDetection] Returning PRIVATE result with flightId:', result.flightId);
      return result;
    }

    // No active flight found
    console.log('[AccountDetection] No active flights detected in either account');
    return null;
  }

  /**
   * Get current operational context
   * Returns account info and suggests which credentials to use
   */
  async getAccountContext() {
    const vaStatus = await this.checkAccountFlight(this.vaCompanyId, this.vaApiKey, 'VA');
    const privateStatus = await this.checkAccountFlight(
      this.privateCompanyId,
      this.privateApiKey,
      'PRIVATE'
    );

    return {
      va: {
        isValid: vaStatus.isValid,
        idle: !vaStatus.flightActive,
        status: vaStatus.flightStatus,
        callsign: vaStatus.callsign,
        currentAirport: vaStatus.currentAirport
      },
      private: {
        isValid: privateStatus.isValid,
        idle: !privateStatus.flightActive,
        status: privateStatus.flightStatus,
        callsign: privateStatus.callsign,
        currentAirport: privateStatus.currentAirport
      },
      activeAccount: (vaStatus.flightActive ? 'VA' : null) || (privateStatus.flightActive ? 'PRIVATE' : null)
    };
  }
}

module.exports = AccountDetectionService;
