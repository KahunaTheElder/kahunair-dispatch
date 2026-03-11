const axios = require('axios');

/**
 * SayIntentions.AI Dispatch Service
 * Handles all SI integration including customization and API calls
 * 
 * Critical: Requires both:
 * - Global SI API Key (from environment)
 * - VA-specific SI API Key (from flight crew data)
 */
class SIDispatchService {
  constructor(globalSIKey) {
    this.globalSIKey = globalSIKey;
    this.siBaseUrl = 'https://apipri.sayintentions.ai/sapi';
    this.client = axios.create({
      baseURL: this.siBaseUrl,
      timeout: 15000,
    });
  }

  /**
   * Transform OnAir flight data into SI-compatible format
   * Includes crew data, dispatcher context, and customization
   */
  async transformFlightForSI(flight, preferences = {}) {
    try {
      // Extract flight crew info
      const firstCrew = flight.FlightCrews?.[0] || {};
      const crewName = firstCrew.People?.Company?.Name || 'Captain';
      const crewLevel = firstCrew.People?.Company?.Level || 'Professional';

      // Build crew data string for SI
      const crewData = this.buildCrewData(flight, crewName, crewLevel, preferences);

      // Build dispatcher context
      const dispatcherData = this.buildDispatcherData(flight, preferences);

      // Build copilot/additional crew data
      const copilotData = this.buildCopilotData(flight, preferences);

      return {
        crew_data: crewData,
        dispatcher_data: dispatcherData,
        copilot_data: copilotData,
      };
    } catch (error) {
      throw new Error(`Flight transformation failed: ${error.message}`);
    }
  }

  /**
   * Build crew data string with personality and operational style
   */
  buildCrewData(flight, crewName = 'Captain', crewLevel = 'Professional', preferences = {}) {
    const personality = preferences.crewPersonality || 'professional';
    const customNotes = preferences.customCrewNotes || '';

    // Handle airport data - could be string or object
    const departureAirport = typeof flight.DepartureAirport === 'string'
      ? flight.DepartureAirport
      : flight.DepartureAirport?.Code || flight.DepartureAirport?.ICAO || 'Departure';
    const arrivalAirport = typeof flight.ArrivalIntendedAirport === 'string'
      ? flight.ArrivalIntendedAirport
      : flight.ArrivalIntendedAirport?.Code || flight.ArrivalIntendedAirport?.ICAO || 'Arrival';

    const aircraft = flight.Aircraft?.AircraftType?.Name || 'Unknown Aircraft';
    const flightNumber = flight.FlightNumber || 'N/A';

    return `Captain: ${crewName}
Experience Level: ${crewLevel}
Operational Style: ${personality}
Aircraft Type: ${aircraft}
Flight Number: ${flightNumber}
Route: ${departureAirport} to ${arrivalAirport}

Personality: ${this.getPersonalityDescription(personality)}
Professionalism: High

${customNotes ? 'Special Notes: ' + customNotes : ''}`;
  }

  /**
   * Build dispatcher context and operational data
   */
  buildDispatcherData(flight, preferences = {}) {
    const dispatcherTone = preferences.dispatcherTone || 'formal';
    const flightConditions = preferences.flightConditions || 'VFR';

    // Handle airport data - could be string or object
    const departure = typeof flight.DepartureAirport === 'string'
      ? flight.DepartureAirport
      : flight.DepartureAirport?.Code || flight.DepartureAirport?.ICAO || 'Departure';
    const arrival = typeof flight.ArrivalIntendedAirport === 'string'
      ? flight.ArrivalIntendedAirport
      : flight.ArrivalIntendedAirport?.Code || flight.ArrivalIntendedAirport?.ICAO || 'Arrival';

    const aircraft = flight.Aircraft?.AircraftType?.Name || 'Aircraft';

    // Extract airport names if available
    const depAirportObj = flight.DepartureAirportObj || {};
    const arrAirportObj = flight.ArrivalIntendedAirportObj || {};
    const depName = typeof depAirportObj === 'object' ? (depAirportObj.Name || departure) : departure;
    const arrName = typeof arrAirportObj === 'object' ? (arrAirportObj.Name || arrival) : arrival;

    return `DISPATCH BRIEFING

Route: ${departure} (${depName}) to ${arrival} (${arrName})
Aircraft: ${aircraft}
Flight Conditions: ${flightConditions}

Dispatcher Tone: ${dispatcherTone}
Communication Style: ${this.getDispatcherStyle(dispatcherTone)}

Crew Count: ${flight.FlightCrews?.length || 1}
Passengers: ${flight.PassengerCount || 0}
Cargo: ${flight.CargoWeight ? flight.CargoWeight + ' lbs' : 'None'}

Standard Procedures:
- Pre-flight check complete
- Flight plan filed and confirmed
- Weather briefing available
- Clearance expected on initial contact
- Maintain standard separation and procedures`;
  }

  /**
   * Build copilot/first officer data
   */
  buildCopilotData(flight, preferences = {}) {
    const copilotPersonality = preferences.copilotPersonality || 'professional';
    const customCopilotNotes = preferences.customCopilotNotes || '';

    const secondCrew = flight.FlightCrews?.[1];
    const copilotName = secondCrew?.People?.Company?.Name || 'First Officer';

    return `First Officer: ${copilotName}
Supporting Role: Fully trained and experienced
Personality: ${copilotPersonality}

Communication Pattern: ${this.getCommunicationPattern(copilotPersonality)}
Callout Procedure: Standard
Support Level: Active assistance on request

${customCopilotNotes ? 'Notes: ' + customCopilotNotes : ''}`;
  }

  /**
   * Get personality description for crew
   */
  getPersonalityDescription(personality) {
    const personalities = {
      'professional': 'Formal, by-the-book, focused on procedures and safety',
      'casual': 'Relaxed approach, friendly communication, maintains safety',
      'humorous': 'Light-hearted banter, maintains professionalism, adds levity',
      'aggressive': 'Assertive communication, confident decision making, quick responses',
      'cautious': 'Deliberate, thorough, prioritizes safety over speed',
      'friendly': 'Warm and personable, collaborative approach, team-focused'
    };

    return personalities[personality] || personalities['professional'];
  }

  /**
   * Get dispatcher communication style
   */
  getDispatcherStyle(tone) {
    const styles = {
      'formal': 'Strict adherence to phraseology, professional tone, official language',
      'casual': 'Friendly but professional, conversational yet clear',
      'efficient': 'Concise, rapid-fire, gets to the point quickly',
      'supportive': 'Helpful, clarifying, patient tone',
      'strict': 'Demanding, rigid procedures, zero tolerance for deviations'
    };

    return styles[tone] || styles['formal'];
  }

  /**
   * Get communication pattern description
   */
  getCommunicationPattern(personality) {
    const patterns = {
      'professional': 'Standard phraseology, formal callouts',
      'casual': 'Conversational tone, natural callouts',
      'aggressive': 'Rapid, assertive, frequent updates',
      'cautious': 'Deliberate, thorough callouts, frequent confirmations',
      'friendly': 'Cooperative tone, collaborative communication',
      'humorous': 'Added humor in callouts, light jokes between procedures'
    };

    return patterns[personality] || patterns['professional'];
  }

  /**
   * Call SI importVAData endpoint with flight customization
   * This is the main integration point
   * 
   * NOTE: Uses global SI API key, not OnAir-extracted keys
   */
  async dispatchFlightToSI(vaApiKey, transformedData) {
    // vaApiKey parameter is for context/logging only
    // Always use the global SI key for authentication

    try {
      // Build the importVAData payload
      const payload = {
        crew_data: transformedData.crew_data,
        dispatcher_data: transformedData.dispatcher_data,
        copilot_data: transformedData.copilot_data,
      };

      // Call SI's importVAData endpoint
      // Using global SI API key (qtUU6YnAaea5Egxu) not OnAir-extracted key
      const response = await this.client.post('/importVAData', null, {
        params: {
          api_key: this.globalSIKey,
          payload: JSON.stringify(payload),
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      return {
        success: true,
        message: 'Flight dispatched to SayIntentions.AI',
        data: response.data,
      };
    } catch (error) {
      throw new Error(`SI dispatch failed: ${error.message}`);
    }
  }

  /**
   * Full dispatch workflow: transform + send to SI
   */
  async dispatchFlight(flight, vaApiKey, preferences = {}) {
    try {
      // Step 1: Transform flight data
      // Logging disabled to reduce I/O overhead
      // console.log('[SI] Transforming flight data...');
      const transformedData = await this.transformFlightForSI(flight, preferences);

      // Step 2: Send to SI
      // Logging disabled to reduce I/O overhead
      // console.log('[SI] Sending to SayIntentions.AI...');
      const result = await this.dispatchFlightToSI(vaApiKey, transformedData);

      return {
        success: true,
        message: 'Flight successfully dispatched to SayIntentions.AI',
        transformed: transformedData,
        siResponse: result,
      };
    } catch (error) {
      // Silent error handling - log only on critical failures
      // console.error('[SI] Dispatch error:', error.message);
      throw error;
    }
  }

  /**
   * Get personality options for UI selection
   */
  getPersonalityOptions() {
    return {
      crew: ['professional', 'casual', 'humorous', 'aggressive', 'cautious', 'friendly'],
      dispatcher: ['formal', 'casual', 'efficient', 'supportive', 'strict'],
    };
  }
}

module.exports = SIDispatchService;
