/**
 * KahunaAir Dispatch - API Client Templates
 * 
 * This file provides template classes for interacting with both APIs.
 * Fill in discovered endpoints and test these before full implementation.
 * 
 * Usage:
 * - Copy this file when ready to start backend development
 * - Replace placeholder methods with discovered OnAir endpoints
 * - Use for testing before integrating into Express server
 */

const axios = require('axios');

/**
 * SayIntentions.AI API Client
 * (Complete - ready to use)
 */
class SayIntentionsAIClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://apipri.sayintentions.ai/sapi';
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
    });
  }

  /**
   * Get current radio frequencies
   */
  async getCurrentFrequencies() {
    try {
      const response = await this.client.get('/getCurrentFrequencies', {
        params: { api_key: this.apiKey },
      });
      return response.data;
    } catch (error) {
      throw new Error(`getCurrentFrequencies failed: ${error.message}`);
    }
  }

  /**
   * Get communication history
   */
  async getCommsHistory() {
    try {
      const response = await this.client.get('/getCommsHistory', {
        params: { api_key: this.apiKey },
      });
      return response.data;
    } catch (error) {
      throw new Error(`getCommsHistory failed: ${error.message}`);
    }
  }

  /**
   * Get weather for airports
   */
  async getWeather(icaoCodes, withComms = false) {
    try {
      const response = await this.client.get('/getWX', {
        params: {
          api_key: this.apiKey,
          icao: icaoCodes,
          with_comms: withComms ? 1 : 0,
        },
      });
      return response.data;
    } catch (error) {
      throw new Error(`getWeather failed: ${error.message}`);
    }
  }

  /**
   * Make entity speak a message
   */
  async sayAs(channel, message, rephrase = false) {
    try {
      const response = await this.client.get('/sayAs', {
        params: {
          api_key: this.apiKey,
          channel,
          message,
          rephrase: rephrase ? 1 : 0,
        },
      });
      return response.data;
    } catch (error) {
      throw new Error(`sayAs failed: ${error.message}`);
    }
  }

  /**
   * Set radio frequency
   */
  async setFrequency(freq, com = 1, mode = 'active') {
    try {
      const response = await this.client.get('/setFreq', {
        params: {
          api_key: this.apiKey,
          freq,
          com,
          mode,
        },
      });
      return response.data;
    } catch (error) {
      throw new Error(`setFrequency failed: ${error.message}`);
    }
  }

  /**
   * Assign gate at airport
   */
  async assignGate(gate, airport) {
    try {
      const response = await this.client.get('/assignGate', {
        params: {
          api_key: this.apiKey,
          gate,
          airport,
        },
      });
      return response.data;
    } catch (error) {
      throw new Error(`assignGate failed: ${error.message}`);
    }
  }

  /**
   * Import Virtual Airline data to customize AI behavior
   * CRITICAL ENDPOINT FOR KAHUNAAIR DISPATCH
   */
  async importVAData(vaApiKey, data = {}) {
    try {
      const payload = {
        va_api_key: vaApiKey,
        ...data,
      };

      const response = await this.client.post('/importVAData', null, {
        params: {
          api_key: this.apiKey,
          payload: JSON.stringify(payload),
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      return response.data;
    } catch (error) {
      throw new Error(
        `importVAData failed: ${error.message}\nPayload: ${JSON.stringify(data)}`
      );
    }
  }

  /**
   * Convenience method: Load flight with SI customization
   * Usage: customizeFlightForSI(vaApiKey, onairFlightData, uiPreferences)
   */
  async customizeFlightForSI(vaApiKey, onairFlight, preferences = {}) {
    const siData = this.transformOnAirToSI(onairFlight, preferences);
    return await this.importVAData(vaApiKey, siData);
  }

  /**
   * Transform OnAir flight data into SayIntentions.AI format
   * (Implementation will be filled in once OnAir data structure known)
   */
  transformOnAirToSI(onairFlight, preferences = {}) {
    // PLACEHOLDER: Will implement after OnAir probing
    return {
      crew_data: `${onairFlight.vaName} Flight ${onairFlight.flightNumber}`,
      dispatcher_data: `Route: ${onairFlight.departure} to ${onairFlight.arrival}`,
      copilot_data: `Aircraft: ${onairFlight.aircraft}`,
    };
  }
}

/**
 * OnAir API Client
 * (Implementation based on API probing March 4, 2026)
 * 
 * Key Discovery: Authentication uses custom 'oa-apikey' header
 * Response format: { Content: actualData }
 */
class OnAirClient {
  constructor(apiKey, baseUrl = 'https://server1.onair.company') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 10000,
      headers: {
        'oa-apikey': apiKey,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Get Virtual Airline profile
   * Returns VA details: name, code, callsign, description, stats
   */
  async getVAProfile(companyId) {
    try {
      const response = await this.client.get(`/api/v1/va/${companyId}`);
      return response.data.Content; // Extract from wrapper
    } catch (error) {
      throw new Error(`getVAProfile failed: ${error.message}`);
    }
  }

  /**
   * Get VA members (crew roster)
   * Critical: Returns SayIntentionsPilotKey for each member!
   */
  async getVAMembers(companyId) {
    try {
      const response = await this.client.get(`/api/v1/va/${companyId}/members`);
      return response.data.Content; // Returns array of members
    } catch (error) {
      throw new Error(`getVAMembers failed: ${error.message}`);
    }
  }

  /**
   * Get company details (same as VA profile)
   */
  async getCompanyDetails(companyId) {
    try {
      const response = await this.client.get(`/api/v1/company/${companyId}`);
      return response.data.Content;
    } catch (error) {
      throw new Error(`getCompanyDetails failed: ${error.message}`);
    }
  }

  /**
   * Check Twitch overlay - detects if flight is in progress
   * Returns error if no active flight
   */
  async getTwitchOverlay(companyId) {
    try {
      const response = await this.client.get(`/api/v1/twitchoverlay/${companyId}`);
      // If error field present, no active flight
      if (response.data.Error) {
        return { hasActiveFlight: false, error: response.data.Error };
      }
      return { hasActiveFlight: true, data: response.data.Content };
    } catch (error) {
      throw new Error(`getTwitchOverlay failed: ${error.message}`);
    }
  }

  /**
   * PLACEHOLDER: Get active flight details
   * Status: Not yet discovered - may require polling or different endpoint
   */
  async getActiveFlight(companyId) {
    // TODO: Discover correct endpoint after next probing phase
    // Potential candidates to test:
    // - GET /api/v1/va/{companyId}/active-flight
    // - GET /api/v1/flight/{flightId}
    // - Polling Twitch Overlay endpoint
    throw new Error('Active flight endpoint not yet discovered - check Twitch Overlay for status');
  }

  /**
   * Convenience method: Get complete VA data package
   * Returns: VA profile + crew roster
   */
  async getCompleteVAPackage(companyId) {
    try {
      const [vaProfile, members] = await Promise.all([
        this.getVAProfile(companyId),
        this.getVAMembers(companyId),
      ]);

      return {
        vaProfile,
        members,
      };
    } catch (error) {
      throw new Error(`getCompleteVAPackage failed: ${error.message}`);
    }
  }
}

/**
 * KahunaAir Dispatch Service
 * Orchestrates OnAir + SayIntentions.AI workflow
 * 
 * Supports both VA and Private Pilot account types with automatic detection
 */
class KahunaAirDispatchService {
  constructor(onAirClient, siClient, accountDetector = null) {
    this.onAir = onAirClient;
    this.si = siClient;
    this.accountDetector = accountDetector; // Optional: AccountDetectionService instance
  }

  /**
   * Load flight from OnAir into SayIntentions.AI
   * 
   * Workflow:
   * 1. Get complete VA package from OnAir (profile + crew roster)
   * 2. Transform to SI format
   * 3. Apply user preferences
   * 4. Send to SI via importVAData
   * 
   * Note: SayIntentionsPilotKey from crew member is used for SI authentication
   */
  async loadFlightToDispatch(companyId, siApiKey, preferences = {}) {
    try {
      // Step 1: Get complete VA package from OnAir
      // Logging disabled to reduce I/O overhead
      // console.log('📍 Fetching VA data from OnAir...');
      const vaPackage = await this.onAir.getCompleteVAPackage(companyId);

      // Extract SI VA API Key from first crew member (if available)
      const siVaApiKey = vaPackage.members && vaPackage.members[0]?.Company?.SayIntentionsPilotKey
        || 'SI_VA_API_KEY_NOT_FOUND';

      // Step 2: Transform to SI format with user preferences
      // Logging disabled to reduce I/O overhead
      // console.log('🔄 Transforming data for SayIntentions.AI...');
      const siData = this.transformFlightData(vaPackage, preferences);

      // Step 3: Load into SI
      // Logging disabled to reduce I/O overhead
      // console.log('📤 Loading flight into SayIntentions.AI...');
      const result = await this.si.customizeFlightForSI(siVaApiKey, siData);

      // Logging disabled to reduce I/O overhead
      // console.log('✅ Flight loaded successfully!');
      return {
        success: true,
        vaProfile: vaPackage.vaProfile,
        crewCount: vaPackage.members.length,
        siResponse: result,
      };
    } catch (error) {
      // Silent error handling
      // console.error('❌ Flight dispatch failed:', error.message);
      throw error;
    }
  }

  /**
   * Transform OnAir flight package + user preferences into SI format
   * Now uses real OnAir data structure discovered via API probing
   */
  transformFlightData(vaPackage, preferences = {}) {
    const { vaProfile, members } = vaPackage;

    // Extract user personality/preference selections
    const {
      crewPersonality = 'professional',
      dispatcherTone = 'formal',
      customCrewNotes = '',
      customDispatcherNotes = '',
    } = preferences;

    // Get captain (first member for now - in real system would select from roster)
    const captain = members && members.length > 0 ? members[0] : null;
    if (!captain) {
      throw new Error('No crew members found in VA');
    }

    // Build SI-formatted data from OnAir data
    const siData = {
      crew_data: this.buildCrewData(vaProfile, captain, crewPersonality, customCrewNotes),
      dispatcher_data: this.buildDispatcherData(vaProfile, captain, dispatcherTone, customDispatcherNotes),
      copilot_data: this.buildCopilotData(vaProfile, captain),
    };

    return siData;
  }

  buildCrewData(vaProfile, captain, personality, customNotes) {
    const companyName = vaProfile.Name;
    const callsign = vaProfile.Callsign;
    const description = vaProfile.Description || 'Professional air charter operator';

    return `
Virtual Airline: ${companyName}
Callsign: ${callsign}
Captain: ${captain.Company.Name} (${captain.Company.Level} experience level)
Reputation: ${(vaProfile.Reputation * 100).toFixed(1)}%

VA Profile:
${description}

Operational Style: ${personality}
${customNotes ? `Special Instructions: ${customNotes}` : ''}
    `.trim();
  }

  buildDispatcherData(vaProfile, captain, tone, customNotes) {
    const aircraft = captain.Aircrafts && captain.Aircrafts.length > 0
      ? `${captain.Aircrafts.length} aircraft available`
      : 'Aircraft assignment pending';

    return `
Dispatching for: ${vaProfile.Name}
Dispatch Authority: ${vaProfile.AirlineCode}
Aircraft Fleet: ${aircraft}
Total Company Flight Hours: ${vaProfile.ComputedNumberOfFlightHours30Days || 'TBD'} (30 days)
Bases of Operation: ${vaProfile.ComputedMostUsedAirports || 'KDEN, UALO, KJFK'}

Dispatcher Tone: ${tone}
Difficulty Setting: ${['Easy', 'Normal', 'Hard', 'Extreme', 'Ultra'][vaProfile.DifficultyLevel] || 'Standard'}
${customNotes ? `Operations Notes: ${customNotes}` : ''}
    `.trim();
  }

  buildCopilotData(vaProfile, captain) {
    return `
Operating for: ${vaProfile.Name}
Captain's Company: ${captain.Company.Name}
Captain Level: ${captain.Company.Level}
First Officer Flight Hours: ${captain.FlightHours ? captain.FlightHours.toFixed(1) : 'N/A'} hours
First Officer Total Flights: ${captain.NumberOfFlights || 0}

VA Callsign: ${vaProfile.Callsign}
Difficulty Level: ${vaProfile.DifficultyLevel}

Professional context: You are an experienced first officer supporting ${vaProfile.AirlineCode} operations.
Stay alert, follow procedures, and assist the captain with a professional demeanor.
    `.trim();
  }
}

// ============================================================
// TEST CODE - Uncomment when ready to test endpoints
// ============================================================

/*
async function testAPIs() {
  // Initialize clients
  const si = new SayIntentionsAIClient(process.env.SI_API_KEY);
  const onAir = new OnAirClient(process.env.ONAIR_API_KEY);
  const dispatch = new KahunaAirDispatchService(onAir, si);

  try {
    // Test SayIntentions.AI (should work immediately)
    console.log('\n🧪 Testing SayIntentions.AI...');
    const freqs = await si.getCurrentFrequencies();
    console.log('✅ SI getCurrentFrequencies:', freqs);

    // Test OnAir endpoints (needs discovery)
    console.log('\n🧪 Testing OnAir...');
    const vaProfile = await onAir.getVAProfile(process.env.ONAIR_VA_ID);
    console.log('✅ OnAir getVAProfile:', vaProfile);

    // Test full dispatch workflow
    console.log('\n🧪 Testing full dispatch workflow...');
    const result = await dispatch.loadFlightToDispatch(
      process.env.ONAIR_VA_ID,
      process.env.ONAIR_FLIGHT_ID,
      process.env.SI_VA_API_KEY,
      {
        crewPersonality: 'professional',
        dispatcherTone: 'formal',
      }
    );
    console.log('✅ Dispatch workflow:', result);
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run tests if this is main module
// if (require.main === module) {
//   testAPIs();
// }
*/

module.exports = {
  SayIntentionsAIClient,
  OnAirClient,
  KahunaAirDispatchService,
  AccountDetectionService: require('./accountDetection'),
};
